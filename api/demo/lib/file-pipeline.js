/**
 * The file server client — the real upload pipeline, not a shortcut around it.
 *
 * Every avatar, cover, post photo, post video and video thumbnail in the demo
 * dataset goes through exactly the sequence a browser would:
 *
 *   1. ask the file server for a signed upload target (`direct-upload-link`),
 *      which creates a `pending` file record and issues a scoped token;
 *   2. POST the bytes to `/files/upload` with that token, which is where the
 *      server sniffs the format, decodes the image or probes the video, applies
 *      the `@douyin-clone/upload-policy` limits, and re-encodes;
 *   3. wait for processing to finish — videos are queued, not immediate;
 *   4. attach the reference once the owning row exists.
 *
 * Nothing writes to the `files` collection directly. That collection lives in
 * the file server's own database, and reaching into it would skip every
 * validation step above — which would let the seeder produce rows the product
 * itself would have refused, and hide a genuine pipeline break behind a dataset
 * that looks fine.
 *
 * The `type` passed at step 1 is the durable upload identity the policy is
 * resolved from, and it is chosen here from the manifest's `purpose`, never from
 * anything a file claims about itself.
 */

const fs = require('fs');
const path = require('path');

const logger = require('./logger');

/** Upload options per purpose, mirroring what the API's own controllers send. */
const UPLOAD_PROFILES = Object.freeze({
  avatar: {
    type: 'avatar',
    mediaType: 'image',
    acl: 'public-read',
    // Matches identity-file.controller.ts.
    processingOptions: {
      generateThumbnail: false,
      generateBlurImage: false,
      resizeWidth: 450,
      imageFormat: 'webp',
      immediateProcess: true
    }
  },
  cover: {
    type: 'cover',
    mediaType: 'image',
    acl: 'public-read',
    processingOptions: {
      generateThumbnail: false,
      generateBlurImage: false,
      resizeWidth: 1200,
      imageFormat: 'webp',
      immediateProcess: true
    }
  },
  'post-photo': {
    type: 'post-photo',
    mediaType: 'image',
    acl: 'public-read',
    // Matches content-file.controller.ts.
    processingOptions: {
      generateThumbnail: true,
      generateBlurImage: true,
      quality: 90,
      imageFormat: 'webp',
      immediateProcess: true
    }
  },
  'post-thumbnail': {
    type: 'post-thumbnail',
    mediaType: 'image',
    acl: 'public-read',
    processingOptions: {
      generateThumbnail: false,
      generateBlurImage: true,
      quality: 90,
      imageFormat: 'webp',
      immediateProcess: true
    }
  },
  'post-video': {
    type: 'post-video',
    mediaType: 'video',
    acl: 'public-read',
    processingOptions: {
      generateThumbnail: true,
      generateBlurImage: true,
      // Videos are transcoded on the queue, exactly as a real upload is.
      immediateProcess: false
    }
  }
});

function createFilePipeline({
  baseUrl, apiKey, internalApiKey, timeoutMs = 300000
}) {
  const internalHeaders = {
    'Content-Type': 'application/json',
    // Both are required by InternalApiGuard and are compared in constant time.
    'X-API-Key': apiKey,
    'X-Internal-API-Key': internalApiKey
  };

  async function internalPost(route, body) {
    const response = await fetchWithTimeout(`${baseUrl}/internal/files${route}`, {
      method: 'POST',
      headers: internalHeaders,
      body: JSON.stringify(body)
    }, timeoutMs);
    return unwrap(response, `POST ${route}`);
  }

  async function internalGet(route) {
    const response = await fetchWithTimeout(`${baseUrl}/internal/files${route}`, {
      method: 'GET',
      headers: internalHeaders
    }, timeoutMs);
    return unwrap(response, `GET ${route}`);
  }

  /** Is the file server up and answering as itself? */
  async function ping() {
    try {
      const response = await fetchWithTimeout(`${baseUrl}/internal/files/find-by-ids`, {
        method: 'POST',
        headers: internalHeaders,
        body: JSON.stringify({ ids: [] })
      }, 10000);
      // A 401/403 means it is up but the keys are wrong, which is worth saying
      // precisely rather than reporting as "not running".
      if (response.status === 401 || response.status === 403) {
        return { ok: false, reason: 'file server rejected the internal API keys (check FILE_SERVER_API_KEY and INTERNAL_API_KEY)' };
      }
      if (!response.ok) return { ok: false, reason: `file server answered HTTP ${response.status}` };
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `file server unreachable at ${baseUrl} (${logger.redact(error.message)})` };
    }
  }

  /**
   * Upload one local file under a given purpose and owner.
   *
   * @returns the file server's record for the finished file.
   */
  async function upload({
    filePath, purpose, mimeType, createdBy, metadata = {}
  }) {
    const profile = UPLOAD_PROFILES[purpose];
    if (!profile) throw new Error(`no upload profile for purpose '${purpose}'`);
    if (!fs.existsSync(filePath)) throw new Error(`missing local file: ${filePath}`);

    const filename = path.basename(filePath);

    const target = await internalPost('/direct-upload-link', {
      mediaType: profile.mediaType,
      type: profile.type,
      filename,
      acl: profile.acl,
      contentType: mimeType,
      processingOptions: profile.processingOptions,
      metadata: { ...metadata, uploadedBy: createdBy },
      createdBy,
      updatedBy: createdBy
    });

    if (!target?.fileId || !target?.token) {
      throw new Error('file server did not return an upload target');
    }

    // The id exists now, so the caller can record it before the bytes are sent.
    return { fileId: target.fileId, uploadUrl: target.uploadUrl, token: target.token };
  }

  /** Send the bytes for a target obtained from `upload()`. */
  async function sendBytes({
    uploadUrl, token, filePath, mimeType
  }) {
    const form = new FormData();
    form.append('token', token);
    form.append(
      'file',
      new Blob([fs.readFileSync(filePath)], { type: mimeType }),
      path.basename(filePath)
    );

    const response = await fetchWithTimeout(uploadUrl, { method: 'POST', body: form }, timeoutMs);
    if (!response.ok) {
      // The server's message names the policy that refused the file, which is
      // exactly what a caller needs; it contains no credential.
      const detail = await safeText(response);
      throw new Error(`upload rejected (HTTP ${response.status}): ${truncate(detail, 300)}`);
    }
    const body = await response.json();
    if (!body?.success) throw new Error(`upload rejected: ${truncate(body?.error || 'unknown reason', 300)}`);
    return body.data;
  }

  const getFile = (fileId) => internalGet(`/${fileId}`);

  /**
   * Wait until processing finishes.
   *
   * Images with `immediateProcess: true` are usually done by the time the upload
   * response returns; videos are queued and take as long as a transcode takes.
   * A file left in `failed` is a real failure and is reported as one — attaching
   * it would produce a post pointing at a video that was never produced.
   */
  async function waitForProcessing(fileId, { timeoutMs: waitMs = 600000, intervalMs = 2000 } = {}) {
    const deadline = Date.now() + waitMs;
    let last = null;

    while (Date.now() < deadline) {
      const file = await getFile(fileId);
      last = file?.processingStatus || null;
      if (last === 'completed') return { ok: true, file };
      if (last === 'failed') return { ok: false, reason: 'file server reported processing failed', file };
      await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
    }

    return { ok: false, reason: `processing did not finish within ${Math.round(waitMs / 1000)}s (last status: ${last})` };
  }

  /**
   * Attach a reference and confirm it landed.
   *
   * `updated: 0` means the file does not exist, and a row published pointing at
   * an unreferenced file is what the unused-file sweeper collects out from under
   * it. Failing here is recoverable; publishing is not.
   */
  async function attachReference({
    fileIds, createdBy, itemId, itemType
  }) {
    if (!fileIds.length) return { updated: 0 };
    const result = await internalPost('/update-ownership', {
      fileIds: [...new Set(fileIds.map(String))],
      createdBy: String(createdBy),
      updatedBy: String(createdBy),
      ref: { itemId: String(itemId), itemType }
    });

    const expected = new Set(fileIds.map(String)).size;
    if (!result || result.updated !== expected) {
      throw new Error(
        `file reference did not land: ${result?.updated ?? 0}/${expected} updated`
        + `${result?.errors?.length ? ` — ${truncate(JSON.stringify(result.errors), 200)}` : ''}`
      );
    }
    return result;
  }

  /** Detach a reference. Idempotent: removing an absent one is a no-op. */
  async function removeReference(fileId, itemId, itemType) {
    return internalPost(`/${fileId}/remove-ref`, { itemId: String(itemId), itemType });
  }

  /** Delete files and their bytes. Used only by `demo:clean`. */
  /**
   * Which of these ids the file server still knows about.
   *
   * Used to *check* a deletion rather than believe its own count. The bytes and
   * the record are removed together by `FileService.deleteMany`, so a record
   * that has gone is the observable proof that its files went with it; a record
   * still present means the delete did not happen, whatever the count said.
   */
  async function findExistingFileIds(fileIds) {
    const found = [];
    for (let i = 0; i < fileIds.length; i += 100) {
      const chunk = fileIds.slice(i, i + 100);
      // eslint-disable-next-line no-await-in-loop
      const result = await internalPost('/find-by-ids', { fileIds: chunk });
      const rows = Array.isArray(result) ? result : (result?.files || result?.data || []);
      for (const row of rows) {
        const id = String(row?._id || row?.id || '');
        if (id) found.push(id);
      }
    }
    return found;
  }

  async function deleteFiles(fileIds) {
    if (!fileIds.length) return { deleted: 0, remaining: [], errors: [] };
    // The endpoint caps a batch; chunk rather than sending 300 ids at once.
    let deleted = 0;
    const errors = [];
    for (let i = 0; i < fileIds.length; i += 50) {
      const chunk = fileIds.slice(i, i + 50).map(String);
      const result = await internalPost('/batch-delete', { fileIds: chunk });
      deleted += Number(result?.deleted ?? result?.deletedCount ?? chunk.length) || 0;
      for (const failure of result?.errors || []) errors.push(failure);
    }
    // Never trust the count on its own: ask again which ids survive.
    const remaining = await findExistingFileIds(fileIds);
    return { deleted, remaining, errors };
  }

  return {
    ping,
    upload,
    sendBytes,
    getFile,
    waitForProcessing,
    attachReference,
    removeReference,
    deleteFiles,
    findExistingFileIds,
    UPLOAD_PROFILES
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Unwrap the file server's `DataResponse` envelope, or throw with its reason. */
async function unwrap(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed (HTTP ${response.status}): ${truncate(await safeText(response), 300)}`);
  }
  const body = await response.json();
  if (body?.success === false) {
    throw new Error(`${label} failed: ${truncate(body.error || 'unknown reason', 300)}`);
  }
  return body?.data ?? body;
}

const safeText = async (response) => {
  try { return await response.text(); } catch { return ''; }
};

const truncate = (text, n) => (String(text).length > n ? `${String(text).slice(0, n)}…` : String(text));

module.exports = { createFilePipeline, UPLOAD_PROFILES };
