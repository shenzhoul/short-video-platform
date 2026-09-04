#!/usr/bin/env node
/**
 * End-to-end verification of the bucket-backed storage engine against a real
 * Cloudflare R2 bucket.
 *
 * ```
 * cd file-server
 * yarn build
 * yarn verify:r2
 * ```
 *
 * ## Why this is a script and not a `.spec`
 *
 * Same reason as `verify-upload-policies.js`: `file-server` has no test runner,
 * and a `.spec.ts` nothing executes looks like coverage while proving nothing.
 * More importantly this one *cannot* be a unit test — it is only meaningful
 * against a real bucket over the network, because the properties it checks
 * (`Range` answering `206`, `Content-Type` surviving the round trip,
 * `Cache-Control` arriving on the object, a delete actually removing bytes) are
 * answered by R2, not by our code. A mocked S3 would assert that we called the
 * SDK the way we call the SDK.
 *
 * ## Safety
 *
 * Every object it writes goes under a per-run prefix that contains a timestamp
 * and random suffix, nested inside `R2_KEY_PREFIX`. It deletes by exact key,
 * then lists the run prefix to prove nothing is left. It never lists, touches,
 * or deletes anything outside that prefix, so it is safe to point at a bucket
 * that already holds real media — though a dedicated staging bucket is still
 * the right thing to use.
 *
 * Exits 0 when every check passes, non-zero on the first hard failure.
 */

/**
 * Environment loading — happens before ANY other require, deliberately.
 *
 * `src/config/storage.ts` reads `process.env` in a plain object literal that is
 * evaluated at module load. So `../dist/services/file/s3-storage.service` must
 * not be required until the right variables are in place, or the compiled
 * config captures whatever was there first and the run silently targets the
 * wrong bucket.
 *
 * ## Why a separate file rather than `.env`
 *
 * `file-server/.env` is the LOCAL DEVELOPMENT config — disk storage, local
 * Mongo. Putting staging R2 credentials in it would change what `yarn dev`
 * does on this machine. Worse, it is the file most likely to end up holding a
 * production token later, and this script must never be one careless edit away
 * from writing to a production bucket.
 *
 * So `--env-file <path>` loads that file and **`.env` is not loaded at all**.
 * The isolation is the point: nothing leaks in from the ambient config.
 *
 * ## Why the path is an argument but the secrets are not
 *
 * A path is not a credential. Passing `R2_SECRET_ACCESS_KEY=...` on the command
 * line would put it in shell history, in the process table (`ps` shows argv to
 * other users), and in any shell transcript. A file read at startup avoids all
 * three.
 */
function loadEnvironment() {
  // eslint-disable-next-line global-require
  const dotenv = require('dotenv');
  // eslint-disable-next-line global-require
  const { existsSync: fileExists } = require('fs');
  // eslint-disable-next-line global-require
  const { resolve: resolvePath } = require('path');

  const flagIndex = process.argv.indexOf('--env-file');
  const fromFlag = flagIndex !== -1 ? process.argv[flagIndex + 1] : undefined;
  const requested = fromFlag || process.env.R2_VERIFY_ENV_FILE;

  if (!requested) {
    dotenv.config();
    return 'file-server/.env (default)';
  }

  const absolute = resolvePath(requested);
  if (!fileExists(absolute)) {
    console.error(`Environment file not found: ${requested}`);
    console.error('Create it from the template and fill in the staging credentials.');
    process.exit(2);
  }

  // `override: true` so the file is authoritative over anything already
  // exported in the shell — otherwise a stale export decides the target bucket
  // and the file that looks like the source of truth is not.
  const result = dotenv.config({ path: absolute, override: true });
  if (result.error) {
    console.error(`Could not read ${requested}: ${result.error.message}`);
    process.exit(2);
  }

  return requested;
}

const ENV_SOURCE = loadEnvironment();

const crypto = require('crypto');
const { execFileSync } = require('child_process');
const { existsSync, readFileSync, unlinkSync } = require('fs');
const { join } = require('path');
const { tmpdir } = require('os');

const {
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { GetObjectCommand } = require('@aws-sdk/client-s3');

const { S3StorageService } = require('../dist/services/file/s3-storage.service');
const { normalizeObjectKey, buildPublicObjectUrl } = require('../dist/services/file/object-key');

let failures = 0;
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  PASS  ${label}`);
    return true;
  }
  failures += 1;
  console.log(`  FAIL  ${label}`);
  if (detail) console.log(`        ${detail}`);
  return false;
}

function heading(text) {
  console.log(`\n${text}`);
}

/**
 * Never print a signed URL whole. The query string carries the signature, which
 * is a bearer credential for the object until it expires — in a terminal
 * scrollback, a CI log, or a pasted bug report.
 */
function redact(url) {
  try {
    const parsed = new URL(url);
    return parsed.search ? `${parsed.origin}${parsed.pathname}?<signature redacted>` : url;
  } catch {
    return '<unparseable url>';
  }
}

/**
 * The account id is the subdomain of the S3 endpoint. It is not a credential,
 * but it identifies the Cloudflare account and there is no reason for it to sit
 * in a terminal transcript that gets pasted into a chat or an issue. The shape
 * is what matters for the check below, and the shape survives redaction.
 */
function redactEndpoint(endpoint) {
  return String(endpoint || '').replace(
    /^https:\/\/[^.]+\.r2\.cloudflarestorage\.com/,
    'https://<account-id>.r2.cloudflarestorage.com'
  );
}

function requireEnv() {
  const required = ['R2_ENDPOINT', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = required.filter((name) => !process.env[name]);

  if (missing.length) {
    console.error('Object storage is not configured. Missing:');
    missing.forEach((name) => console.error(`  - ${name}`));
    console.error(`
Environment source: ${ENV_SOURCE}`);
    console.error('Fill them in that file, then re-run.');
    console.error('Template: file-server/.env.r2-staging.local.example');
    process.exit(2);
  }

  /*
   * This script WRITES and DELETES. It is a verification tool for a staging
   * bucket, and pointing it at production — by editing the wrong file, or by a
   * stale shell export — must not be a thing that merely happens to be
   * survivable. It is refused.
   *
   * Name-based, because the bucket name is the only thing here that says what
   * the bucket is for. The escape hatch exists so the refusal is a speed bump
   * for a deliberate act rather than a wall, but it has to be typed.
   */
  const bucket = process.env.R2_BUCKET_NAME;
  if (/prod/i.test(bucket) && !process.env.R2_VERIFY_ALLOW_PRODUCTION_BUCKET) {
    console.error(`Refusing to run against a production-looking bucket: ${bucket}`);
    console.error(`Environment source: ${ENV_SOURCE}`);
    console.error('');
    console.error('This script uploads and deletes objects. Point it at the staging bucket.');
    console.error('If this really is intended, set R2_VERIFY_ALLOW_PRODUCTION_BUCKET=1.');
    process.exit(2);
  }

  if (!/^https:\/\/[^/]+\.r2\.cloudflarestorage\.com\/?$/.test(process.env.R2_ENDPOINT)
      && !process.env.R2_ALLOW_NON_R2_ENDPOINT) {
    console.error(`R2_ENDPOINT does not look like an account S3 endpoint: ${redactEndpoint(process.env.R2_ENDPOINT)}`);
    console.error('Expected https://<account id>.r2.cloudflarestorage.com');
    console.error('Set R2_ALLOW_NON_R2_ENDPOINT=1 to verify against another S3-compatible provider.');
    process.exit(2);
  }
}

/** A real PNG, produced by the same libvips the upload pipeline uses. */
async function makeImage() {
  // eslint-disable-next-line global-require
  const sharp = require('sharp');
  return sharp({
    create: {
      width: 64, height: 48, channels: 3, background: { r: 20, g: 120, b: 200 }
    }
  }).png().toBuffer();
}

/**
 * A real MP4 if FFmpeg is on the path, because a synthetic blob would not prove
 * that `Content-Type` and byte-range seeking work for the thing that actually
 * needs them. Falls back to random bytes and says so — `Range` is
 * content-agnostic, so the 206 check stays meaningful either way.
 */
function makeVideo() {
  const out = join(tmpdir(), `r2-verify-${crypto.randomUUID()}.mp4`);
  try {
    execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      out
    ], { stdio: 'pipe' });
    const buffer = readFileSync(out);
    unlinkSync(out);
    return { buffer, real: true };
  } catch (error) {
    if (existsSync(out)) { try { unlinkSync(out); } catch { /* best effort */ } }
    return { buffer: crypto.randomBytes(512 * 1024), real: false };
  }
}

async function main() {
  requireEnv();

  const bucket = process.env.R2_BUCKET_NAME;
  const basePrefix = process.env.R2_KEY_PREFIX || '';
  const runId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  // Nested under the deployment prefix so a shared bucket stays partitioned.
  const runPrefix = `_verify/${runId}`;

  console.log('Cloudflare R2 storage verification');
  console.log(`  bucket        ${bucket}`);
  console.log(`  endpoint      ${redactEndpoint(process.env.R2_ENDPOINT)}`);
  console.log(`  env source    ${ENV_SOURCE}`);
  console.log(`  key prefix    ${basePrefix || '(none)'}`);
  console.log(`  run prefix    ${normalizeObjectKey(runPrefix, basePrefix)}`);
  console.log(`  public base   ${process.env.R2_PUBLIC_BASE_URL || '(not set — will use presigned GETs)'}`);

  const client = new S3Client({
    region: process.env.R2_REGION || 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    },
    forcePathStyle: true
  });

  const storage = new S3StorageService();
  const writtenKeys = [];

  const imageKey = `${runPrefix}/photos/sample.png`;
  const videoKey = `${runPrefix}/videos/sample.mp4`;

  try {
    // ---------------------------------------------------------------- upload
    heading('1. Upload an image and a video through S3StorageService');
    const imageBuffer = await makeImage();
    const video = makeVideo();
    if (!video.real) {
      console.log('  NOTE  FFmpeg not available — video body is random bytes.');
      console.log('        Range/206 is still verified; container handling is not.');
    }

    const uploadedImage = await storage.writeFile({
      body: imageBuffer, key: imageKey, contentType: 'image/png', acl: 'public-read'
    });
    writtenKeys.push(uploadedImage.key);
    check('image upload returns the normalised object key',
      uploadedImage.key === normalizeObjectKey(imageKey, basePrefix),
      `got ${uploadedImage.key}`);
    check('image upload records storageType s3', uploadedImage.storageType === 's3', `got ${uploadedImage.storageType}`);

    const uploadedVideo = await storage.writeFile({
      body: video.buffer, key: videoKey, contentType: 'video/mp4', acl: 'public-read'
    });
    writtenKeys.push(uploadedVideo.key);
    check('video upload returns the normalised object key',
      uploadedVideo.key === normalizeObjectKey(videoKey, basePrefix));

    // ------------------------------------------------------------------ HEAD
    heading('2. HEAD the stored objects (metadata written correctly)');
    const imageHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: uploadedImage.key }));
    check('image Content-Type is image/png', imageHead.ContentType === 'image/png', `got ${imageHead.ContentType}`);
    check('image byte length matches what was uploaded',
      Number(imageHead.ContentLength) === imageBuffer.length,
      `bucket ${imageHead.ContentLength} vs local ${imageBuffer.length}`);
    check('image carries an immutable Cache-Control',
      /max-age=\d+/.test(imageHead.CacheControl || '') && /immutable/.test(imageHead.CacheControl || ''),
      `got ${imageHead.CacheControl}`);

    const videoHead = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: uploadedVideo.key }));
    check('video Content-Type is video/mp4', videoHead.ContentType === 'video/mp4', `got ${videoHead.ContentType}`);
    check('video byte length matches', Number(videoHead.ContentLength) === video.buffer.length);

    // ------------------------------------------------------------------- GET
    heading('3. Fetch over HTTP');
    const publicBase = process.env.R2_PUBLIC_BASE_URL;
    const imageUrl = publicBase
      ? buildPublicObjectUrl(publicBase, uploadedImage.key)
      : await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: uploadedImage.key }), { expiresIn: 300 });
    const videoUrl = publicBase
      ? buildPublicObjectUrl(publicBase, uploadedVideo.key)
      : await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: uploadedVideo.key }), { expiresIn: 300 });

    /*
     * A SEPARATE URL for the HEAD probe, and this is not incidental.
     *
     * An S3 signature covers the HTTP method, so a HEAD against a URL presigned
     * for GET is rejected at signature validation — R2 answers 403 and the
     * response carries no `Accept-Ranges` at all. Reusing `videoUrl` here
     * therefore reported "R2 does not advertise byte ranges", which is untrue
     * and would have sent somebody looking for a fault in the bucket
     * configuration. Measured: HEAD on a GET-presigned URL -> 403 with no
     * headers; HEAD on a HEAD-presigned URL -> 200 with `Accept-Ranges: bytes`.
     *
     * On the public path (a Worker or a custom domain) no signature is involved
     * and one URL serves both methods, which is why this only bites when
     * R2_PUBLIC_BASE_URL is unset.
     */
    const videoHeadUrl = publicBase
      ? videoUrl
      : await getSignedUrl(client, new HeadObjectCommand({ Bucket: bucket, Key: uploadedVideo.key }), { expiresIn: 300 });

    if (publicBase) {
      check('public image URL carries no credential or signature',
        !/[?&](X-Amz-|Signature|AWSAccessKeyId)/i.test(imageUrl), redact(imageUrl));
      check('public image URL is https', imageUrl.startsWith('https://'), redact(imageUrl));
      check('public URL is not the rate-limited r2.dev development origin',
        !/\.r2\.dev/i.test(imageUrl),
        'Bind an R2 custom domain and set R2_PUBLIC_BASE_URL to it for production.');
    }

    const imageResponse = await fetch(imageUrl);
    check('image GET answers 200', imageResponse.status === 200, `got ${imageResponse.status}`);
    const fetched = Buffer.from(await imageResponse.arrayBuffer());
    check('image bytes round-trip byte-for-byte', fetched.equals(imageBuffer),
      `got ${fetched.length} bytes, expected ${imageBuffer.length}`);
    check('image response Content-Type survived',
      (imageResponse.headers.get('content-type') || '').startsWith('image/png'),
      `got ${imageResponse.headers.get('content-type')}`);

    // ----------------------------------------------------------------- Range
    heading('4. Range request on the video (what makes seeking work)');
    const full = await fetch(videoHeadUrl, { method: 'HEAD' });
    check('video HEAD advertises Accept-Ranges: bytes',
      (full.headers.get('accept-ranges') || '').toLowerCase() === 'bytes',
      `HTTP ${full.status}, accept-ranges=${full.headers.get('accept-ranges')}`);

    const rangeResponse = await fetch(videoUrl, { headers: { Range: 'bytes=100-199' } });
    check('ranged GET answers 206', rangeResponse.status === 206, `got ${rangeResponse.status}`);
    check('ranged GET returns Content-Range',
      /^bytes 100-199\/\d+$/.test(rangeResponse.headers.get('content-range') || ''),
      `got ${rangeResponse.headers.get('content-range')}`);
    const rangeBody = Buffer.from(await rangeResponse.arrayBuffer());
    check('ranged GET returns exactly the requested 100 bytes', rangeBody.length === 100, `got ${rangeBody.length}`);
    check('ranged bytes match the source at that offset',
      rangeBody.equals(video.buffer.subarray(100, 200)));

    // A seek near the end is the case a truncated upload breaks.
    const tailStart = Math.max(0, video.buffer.length - 50);
    const tailResponse = await fetch(videoUrl, { headers: { Range: `bytes=${tailStart}-` } });
    check('ranged GET near the end answers 206', tailResponse.status === 206, `got ${tailResponse.status}`);
    const tailBody = Buffer.from(await tailResponse.arrayBuffer());
    check('trailing bytes match the source', tailBody.equals(video.buffer.subarray(tailStart)));

    // ---------------------------------------------------------------- delete
    heading('5. Delete removes the actual objects');
    const deleteResult = await storage.deleteFiles([imageKey, videoKey]);
    check('delete reports success', deleteResult.success === true, JSON.stringify(deleteResult.errors));
    check('delete counted both objects', deleteResult.deletedCount === 2, `got ${deleteResult.deletedCount}`);

    check('image object is gone', (await storage.objectExists(imageKey)) === false);
    check('video object is gone', (await storage.objectExists(videoKey)) === false);

    const afterDelete = await fetch(imageUrl);
    check('image URL no longer resolves', afterDelete.status === 404 || afterDelete.status === 403,
      `got ${afterDelete.status}`);

    // A delete of something already gone must be a no-op, not an error: the
    // sweeper retries, and a retry that fails would strand the record.
    const repeat = await storage.deleteFiles([imageKey]);
    check('deleting an already-deleted key is idempotent', repeat.success === true);
  } finally {
    // ------------------------------------------------------------- cleanup
    heading('6. Cleanup — nothing left under the run prefix');
    const listed = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: normalizeObjectKey(runPrefix, basePrefix)
    }));

    const leftovers = (listed.Contents || []).map((entry) => entry.Key);
    if (leftovers.length) {
      console.log(`  removing ${leftovers.length} leftover object(s) by exact key`);
      await client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: leftovers.map((Key) => ({ Key })), Quiet: true }
      }));
    }

    const recheck = await client.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: normalizeObjectKey(runPrefix, basePrefix)
    }));
    check('run prefix is empty', (recheck.Contents || []).length === 0,
      `still holds ${(recheck.Contents || []).length} object(s)`);

    client.destroy();
  }

  console.log(`\n${checks - failures}/${checks} checks passed`);
  if (failures) {
    console.log('\nR2 storage verification FAILED.');
    process.exit(1);
  }
  console.log('\nR2 storage verification passed.');
}

main().catch((error) => {
  console.error('\nVerification aborted:', error.message);
  process.exit(1);
});
