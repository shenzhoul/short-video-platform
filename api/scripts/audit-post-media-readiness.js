/**
 * Read-only audit: active posts whose media is not actually servable.
 *
 * `assertPostMediaReady` stops new posts from being published with missing,
 * pending or failed media, but it cannot speak for rows written before it
 * existed — or for a file whose status changed *after* the post went live.
 * This reports both, and changes nothing.
 *
 * Usage:
 *   node scripts/audit-post-media-readiness.js
 *   node scripts/audit-post-media-readiness.js --file-server-uri=mongodb://localhost/douyin-clone-file-server
 */

const { MongoClient } = require('mongodb');

const MONGO = (process.argv.find((a) => a.startsWith('--mongo=')) || '--mongo=mongodb://localhost/douyin-clone').split('=')[1];
const FILE_SERVER = (process.argv.find((a) => a.startsWith('--file-server-uri='))
  || '--file-server-uri=mongodb://localhost/douyin-clone-file-server').split('=')[1];

/** The states a published post's media may legitimately be in. */
const PUBLISHABLE = ['completed', 'skipped'];

async function main() {
  const api = new MongoClient(MONGO);
  const fs = new MongoClient(FILE_SERVER);
  await Promise.all([api.connect(), fs.connect()]);

  try {
    const db = api.db();
    const fileDb = fs.db();

    const posts = await db.collection('posts')
      .find({ status: 'active' })
      .project({ _id: 1, fileIds: 1, userId: 1, type: 1 })
      .toArray();
    console.log(`active posts: ${posts.length}`);

    const allFileIds = [...new Set(posts.flatMap((p) => (p.fileIds || []).map(String)))];
    console.log(`distinct referenced files: ${allFileIds.length}`);

    const { ObjectId } = require('mongodb');
    const files = await fileDb.collection('files')
      .find({ _id: { $in: allFileIds.map((id) => new ObjectId(id)) } })
      .project({ _id: 1, processingStatus: 1, status: 1 })
      .toArray();
    const byId = new Map(files.map((f) => [f._id.toString(), f]));
    console.log(`file records found: ${files.length}`);

    const missing = [];
    const notReady = [];
    const failed = [];
    const noMedia = [];

    posts.forEach((post) => {
      const ids = (post.fileIds || []).map(String);
      if (!ids.length) {
        // A text post legitimately has none; a media post must not.
        if (post.type && post.type !== 'text') noMedia.push(post._id.toString());
        return;
      }
      ids.forEach((id) => {
        const file = byId.get(id);
        if (!file) {
          missing.push({ post: post._id.toString(), file: id });
          return;
        }
        const state = file.processingStatus;
        if (state === 'failed') failed.push({ post: post._id.toString(), file: id });
        else if (state && !PUBLISHABLE.includes(state)) {
          notReady.push({ post: post._id.toString(), file: id, state });
        }
      });
    });

    console.log('\n=== Findings ===');
    console.log(`  active posts referencing a file with no record:   ${missing.length}`);
    console.log(`  active posts whose media processing failed:       ${failed.length}`);
    console.log(`  active posts whose media is still pending:        ${notReady.length}`);
    console.log(`  active media posts with no file reference at all: ${noMedia.length}`);

    const total = missing.length + failed.length + notReady.length + noMedia.length;
    if (total === 0) {
      console.log('\n  0 — every active post references media that exists and finished processing.');
      return;
    }

    console.log('\n  Nothing was changed. Remediation, per class:');
    if (missing.length) {
      console.log(`  - ${missing.length} dangling reference(s): the post points at a file the file `
        + 'server does not have. Do not delete the post blindly — confirm whether the file was '
        + 'swept as unreferenced (recoverable by re-uploading) or the reference is simply stale.');
      console.log(`    e.g. ${JSON.stringify(missing.slice(0, 3))}`);
    }
    if (failed.length) {
      console.log(`  - ${failed.length} failed processing: the bytes will never be servable. `
        + 'Ask the author to re-upload, or deactivate the post; it is currently listed and unplayable.');
      console.log(`    e.g. ${JSON.stringify(failed.slice(0, 3))}`);
    }
    if (notReady.length) {
      console.log(`  - ${notReady.length} still processing: may resolve on its own. Re-run this `
        + 'audit before acting — a post that has been pending for hours is stuck, one pending for '
        + 'seconds is simply new.');
      console.log(`    e.g. ${JSON.stringify(notReady.slice(0, 3))}`);
    }
    if (noMedia.length) {
      console.log(`  - ${noMedia.length} media post(s) with no file reference: these predate the `
        + 'publish-time gate and cannot render.');
      console.log(`    e.g. ${JSON.stringify(noMedia.slice(0, 3))}`);
    }
    process.exitCode = 1;
  } finally {
    await Promise.all([api.close(), fs.close()]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
