/**
 * Backfill `PostMedia.durationMs` for video rows written before that field
 * existed.
 *
 * `PostMediaService.createMultiplePostMedia` now populates `durationMs` from
 * file-server's ffprobe-derived `File.duration` at creation time, but every
 * video `PostMedia` row written before that change has `durationMs: null`.
 * `RecommendationEventService`'s watch-ratio clamping and completion
 * classification trust only this field — a video stuck at `null` stays on
 * the "no canonical duration" legacy fallback path forever (clamped raw
 * watch time only, no completion signal) until this backfill runs.
 *
 * The videos live in the API database (`post_media`) and their durations
 * live in the file server's own database (`files`), so both connection
 * strings are needed — same pattern as `audit-profile-image-refs.js`.
 *
 * Usage:
 *   node scripts/backfill-post-media-duration.js                 # dry run (default)
 *   node scripts/backfill-post-media-duration.js --apply         # write durations
 *   node scripts/backfill-post-media-duration.js --file-server-uri=mongodb://...
 *
 * `FILE_SERVER_MONGO_URI` in the environment is used when the flag is absent.
 * Mutation is never the default, and this is deliberately not wired into
 * startup, a migration, or any request path — a batch of large historical
 * videos this cannot recover a duration for (deleted file record, failed
 * processing) is reported, not guessed at.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const BATCH_SIZE = 500;

function resolveFileServerUri() {
  const flag = process.argv.find((arg) => arg.startsWith('--file-server-uri='));
  return flag ? flag.slice('--file-server-uri='.length) : process.env.FILE_SERVER_MONGO_URI;
}

(async () => {
  const fileServerUri = resolveFileServerUri();
  if (!fileServerUri) {
    console.error(
      'file server database is not configured.\n'
      + 'Set FILE_SERVER_MONGO_URI, or pass --file-server-uri=mongodb://host/douyin-clone-file-server'
    );
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const fileServerClient = await MongoClient.connect(fileServerUri, { serverSelectionTimeoutMS: 10000 });

  try {
    const postMedia = mongoose.connection.db.collection('post_media');
    const files = fileServerClient.db().collection('files');

    let scanned = 0;
    let filled = 0;
    let noDuration = 0;
    let missingFile = 0;
    const sampleMissing = [];
    // `_id`-cursor pagination, not offset/`$exists` re-querying: a dry run
    // never mutates the filter's matching set, so re-running the same
    // `{ durationMs: { $exists: false } }` query would return the identical
    // batch forever and double-count every row.
    let lastId = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await postMedia
        .find({
          mediaType: 'VIDEO',
          durationMs: { $exists: false },
          ...(lastId ? { _id: { $gt: lastId } } : {})
        })
        .project({ _id: 1, fileId: 1 })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .toArray();
      if (!batch.length) break;
      lastId = batch[batch.length - 1]._id;

      const fileIds = batch.map((row) => row.fileId);
      const fileRows = await files
        .find({ _id: { $in: fileIds } })
        .project({ _id: 1, duration: 1 })
        .toArray();
      const durationByFileId = new Map(fileRows.map((row) => [row._id.toString(), row.duration]));

      const ops = [];
      batch.forEach((row) => {
        scanned += 1;
        const durationSeconds = durationByFileId.get(row.fileId.toString());
        if (durationSeconds === undefined) {
          missingFile += 1;
          if (sampleMissing.length < 10) sampleMissing.push(row._id.toString());
          return;
        }
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          noDuration += 1;
          return;
        }
        filled += 1;
        ops.push({
          updateOne: {
            filter: { _id: row._id },
            update: { $set: { durationMs: Math.round(durationSeconds * 1000) } }
          }
        });
      });

      if (APPLY && ops.length) await postMedia.bulkWrite(ops, { ordered: false });
    }

    console.log(`Scanned:        ${scanned}`);
    console.log(`Filled:         ${filled}${APPLY ? '' : ' (dry run — not written)'}`);
    console.log(`No duration:    ${noDuration} (file record exists but reports no usable duration)`);
    console.log(`Missing file:   ${missingFile} (no matching file-server record)`);
    if (sampleMissing.length) console.log(`Sample missing PostMedia ids: ${sampleMissing.join(', ')}`);

    if (!APPLY) {
      console.log('\nDry run only. Re-run with --apply to write durationMs.');
    }
  } finally {
    await mongoose.disconnect();
    await fileServerClient.close();
  }
})();
