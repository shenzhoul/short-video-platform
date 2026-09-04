/**
 * Repoint stored post cover URLs that were written against the private S3
 * endpoint instead of the public media origin.
 *
 * WHY THESE ROWS ARE WRONG
 *
 * `PostCrudService.create` persists the cover URLs rather than resolving them
 * per request, and it takes them from the file server:
 *
 *   generatedCover = normalizeThumbnailUrls(mainFile.thumbnails)[0]
 *   cover4x3Url    = uploaded cover/poster url, else generatedCover
 *   cover3x4Url    = uploaded cover3x4 url,     else generatedCover, else cover4x3Url
 *
 * `FileDto.getThumbnails` signed those thumbnail URLs whenever the file was
 * `public-read` — the inverse of its own comment, and the inverse of what
 * `getUrl()` does for the very same file. On the disk engine the result still
 * served, so it went unnoticed. On a bucket it is a presigned URL against
 * `<account>.r2.cloudflarestorage.com`, which is not the public origin: it dies
 * within the hour, and the demo seeder — which strips the query before storing,
 * correct on disk — persisted an unsigned request to a private endpoint that R2
 * answers `400 InvalidArgument`.
 *
 * Measured in production before this ran: 160 of 160 `cover3x4Url` and the 16
 * photo posts' `cover4x3Url` on the S3 host, every one of them dead. The 144
 * video posts' `cover4x3Url` was already correct — it comes from an uploaded
 * poster file's `getUrl()`, which was never inverted.
 *
 * WHAT THIS DOES
 *
 * Nothing to the objects. The bytes are healthy — the same key fetched from the
 * public origin answers `206 image/webp`. Only the origin recorded in the row is
 * wrong, so this asks the file server for each post's main file and writes back
 * the URL it reports today, which is what `PostCrudService.create` would store
 * for the same post now that `getThumbnails` is fixed.
 *
 * The file server is the only thing that builds a media URL. This script never
 * assembles one from a bucket name, a key prefix or an endpoint — duplicating
 * that logic here is how the two would drift.
 *
 * SAFETY
 *
 *  - Dry run by default. `--apply` is required to write.
 *  - Only a URL on the private S3 endpoint is replaced. A cover already on the
 *    public origin, or pointing anywhere else (a creator's own uploaded cover
 *    file), is reported and left alone. That makes the script idempotent and
 *    unable to damage a correct row.
 *  - It refuses to run if the file server still returns signed thumbnail URLs,
 *    which means the code fix is not deployed yet — otherwise it would
 *    faithfully write the same broken URLs back.
 *  - `--report <path>` records every change as {_id, field, from, to}, and
 *    `--rollback <path>` restores exactly those values.
 *
 * USAGE
 *
 *   node scripts/backfill-post-cover-urls.js                      # dry run
 *   node scripts/backfill-post-cover-urls.js --report /out/r.json # dry run + plan
 *   node scripts/backfill-post-cover-urls.js --apply --report /out/r.json
 *   node scripts/backfill-post-cover-urls.js --rollback /out/r.json --apply
 *
 * Reads FILE_SERVER_BASE_URL, FILE_SERVER_API_KEY and INTERNAL_API_KEY from the
 * environment, the same three the API itself uses to reach the file server.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const flag = (name) => {
  const withEquals = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (withEquals) return withEquals.slice(name.length + 3);
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 ? process.argv[index + 1] : undefined;
};
const REPORT_PATH = flag('report');
const ROLLBACK_PATH = flag('rollback');
const BATCH_SIZE = 50;

/** The private S3 API endpoint. A stored cover pointing here is broken. */
const PRIVATE_ENDPOINT = /^[a-z0-9-]+\.r2\.cloudflarestorage\.com$/i;
const SIGNED = /[?&](X-Amz-Signature|hash)=/i;

const hostOf = (url) => {
  try { return new URL(String(url)).hostname; } catch { return null; }
};
const isPrivateEndpoint = (url) => {
  const host = hostOf(url);
  return !!host && PRIVATE_ENDPOINT.test(host);
};

/** `FileServerInfoDto.normalizeThumbnailUrls`, for a plain script. */
const normalizeThumbnailUrls = (thumbnails) => (thumbnails || [])
  .map((t) => (typeof t === 'string' ? t : t?.url || t?.path))
  .filter(Boolean);

function fileServerClient() {
  const baseUrl = (process.env.FILE_SERVER_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = process.env.FILE_SERVER_API_KEY;
  const internalApiKey = process.env.INTERNAL_API_KEY;
  const missing = Object.entries({ FILE_SERVER_BASE_URL: baseUrl, FILE_SERVER_API_KEY: apiKey, INTERNAL_API_KEY: internalApiKey })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`missing ${missing.join(', ')}`);

  return async function findByIds(ids) {
    const response = await fetch(`${baseUrl}/internal/files/find-by-ids`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
        'X-Internal-API-Key': internalApiKey
      },
      body: JSON.stringify({ fileIds: ids.map(String), returnAsObject: true })
    });
    if (!response.ok) throw new Error(`find-by-ids answered HTTP ${response.status}`);
    const body = await response.json();
    if (!body?.success && !body?.data) throw new Error(`find-by-ids failed: ${body?.error || 'unknown'}`);
    return body.data || {};
  };
}

async function rollback(posts) {
  const entries = JSON.parse(fs.readFileSync(ROLLBACK_PATH, 'utf8'));
  console.log(`rollback plan: ${entries.length} field(s) from ${ROLLBACK_PATH}`);
  if (!APPLY) {
    entries.slice(0, 5).forEach((e) => console.log(`  ${e._id} ${e.field}: restore ${e.from}`));
    console.log('\nDRY RUN — add --apply to restore.');
    return;
  }
  let restored = 0;
  for (const entry of entries) {
    // eslint-disable-next-line no-await-in-loop
    const result = await posts.updateOne(
      { _id: new mongoose.Types.ObjectId(entry._id), [entry.field]: entry.to },
      { $set: { [entry.field]: entry.from } }
    );
    restored += result.modifiedCount;
  }
  console.log(`restored ${restored} of ${entries.length} field(s).`);
  console.log('A field already changed since the report was written is left alone.');
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const posts = mongoose.connection.db.collection('posts');

  try {
    if (ROLLBACK_PATH) return await rollback(posts);

    const findByIds = fileServerClient();

    const rows = await posts
      .find({}, { projection: { cover3x4Url: 1, cover4x3Url: 1, fileIds: 1, thumbnailId: 1, type: 1 } })
      .sort({ _id: 1 })
      .toArray();
    console.log(`posts scanned: ${rows.length}`);

    // One batched lookup per chunk rather than a call per post.
    const wantedIds = new Set();
    for (const row of rows) {
      if (row.fileIds?.[0]) wantedIds.add(String(row.fileIds[0]));
      if (row.thumbnailId) wantedIds.add(String(row.thumbnailId));
    }
    const ids = [...wantedIds];
    const filesById = {};
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      // eslint-disable-next-line no-await-in-loop
      Object.assign(filesById, await findByIds(ids.slice(i, i + BATCH_SIZE)));
    }
    console.log(`file records fetched: ${Object.keys(filesById).length} of ${ids.length}`);

    /*
     * Refuse to write if the fix is not live. Without this the script would
     * read the same broken URLs the rows already hold and write them back,
     * reporting success.
     */
    const stillBroken = Object.values(filesById).filter((file) => {
      const [thumb] = normalizeThumbnailUrls(file.thumbnails);
      return thumb && (isPrivateEndpoint(thumb) || SIGNED.test(thumb));
    });
    if (stillBroken.length) {
      const [sample] = normalizeThumbnailUrls(stillBroken[0].thumbnails);
      console.error(
        `\nABORT: the file server still returns private or signed thumbnail URLs `
        + `(${stillBroken.length} of ${Object.keys(filesById).length} files).\n`
        + `  e.g. ${String(sample).split('?')[0]}\n`
        + 'Deploy the FileDto.getThumbnails fix first, then re-run. Nothing was changed.'
      );
      process.exitCode = 1;
      return;
    }

    const changes = [];
    const counts = {
      cover3x4Repaired: 0,
      cover4x3Repaired: 0,
      alreadyCorrect: 0,
      leftAlone: 0,
      noThumbnail: 0,
      missingFile: 0
    };
    const byType = {};

    for (const row of rows) {
      const main = filesById[String(row.fileIds?.[0] || '')];
      if (!main) { counts.missingFile += 1; continue; }

      const generatedCover = normalizeThumbnailUrls(main.thumbnails)[0] || null;
      if (!generatedCover) { counts.noThumbnail += 1; continue; }

      // Exactly PostCrudService.create's resolution, with the uploaded poster
      // standing in for `preValidatedFiles.thumbnail`.
      const poster = row.thumbnailId ? filesById[String(row.thumbnailId)] : null;
      const desired = {
        cover4x3Url: poster?.url || generatedCover,
        cover3x4Url: generatedCover
      };

      for (const field of ['cover3x4Url', 'cover4x3Url']) {
        const current = row[field];
        const next = desired[field];
        if (!next) continue;
        if (current === next) { counts.alreadyCorrect += 1; continue; }
        // The narrow predicate: repair only what is demonstrably broken.
        if (!isPrivateEndpoint(current)) { counts.leftAlone += 1; continue; }

        changes.push({
          _id: String(row._id), field, from: current, to: next
        });
        counts[field === 'cover3x4Url' ? 'cover3x4Repaired' : 'cover4x3Repaired'] += 1;
        const key = `${row.type} ${field}`;
        byType[key] = (byType[key] || 0) + 1;
      }
    }

    console.log('\nplan:');
    console.log(`  cover3x4Url to repair : ${counts.cover3x4Repaired}`);
    console.log(`  cover4x3Url to repair : ${counts.cover4x3Repaired}`);
    console.log(`  already correct       : ${counts.alreadyCorrect}`);
    console.log(`  left alone (not on the private endpoint): ${counts.leftAlone}`);
    console.log(`  main file has no thumbnail: ${counts.noThumbnail}`);
    console.log(`  main file not found       : ${counts.missingFile}`);
    console.log('  by post type:');
    Object.keys(byType).sort().forEach((k) => console.log(`    ${k}: ${byType[k]}`));

    console.log('\nsamples:');
    changes.slice(0, 3).forEach((c) => {
      console.log(`  post ${c._id} ${c.field}`);
      console.log(`    from ${c.from}`);
      console.log(`    to   ${c.to}`);
    });

    if (REPORT_PATH) {
      fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
      fs.writeFileSync(REPORT_PATH, JSON.stringify(changes, null, 2));
      console.log(`\nreport written: ${REPORT_PATH} (${changes.length} field change(s))`);
    }

    if (!APPLY) {
      console.log('\nDRY RUN — nothing was written. Add --apply to write these changes.');
      return;
    }

    let updated = 0;
    for (const change of changes) {
      // Guarded by the current value: a row edited since the plan was built is
      // skipped rather than overwritten.
      // eslint-disable-next-line no-await-in-loop
      const result = await posts.updateOne(
        { _id: new mongoose.Types.ObjectId(change._id), [change.field]: change.from },
        { $set: { [change.field]: change.to, updatedAt: new Date() } }
      );
      updated += result.modifiedCount;
    }
    console.log(`\napplied: ${updated} of ${changes.length} field change(s).`);
    if (updated !== changes.length) {
      console.log('A row whose value changed since the plan was built was skipped. Re-run to pick it up.');
    }
  } finally {
    await mongoose.disconnect();
  }
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
