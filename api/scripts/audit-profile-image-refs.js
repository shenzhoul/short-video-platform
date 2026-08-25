/**
 * Audit (and optionally repair) `refItems` on avatar and cover files.
 *
 * `cleanup-unused-files.job.ts` decides what is abandoned purely from
 * `refItems`, so a profile image the user document points at but which carries
 * no reference is deleted within hours and the profile is left serving a URL
 * whose bytes are gone. `BaseUserService.attachProfileImageReference` now writes
 * that reference *before* the user document points at the file, which closes the
 * window going forward — but rows written before that ordering existed are not
 * re-checked by anything at runtime, and `cover` was only added to the sweeper
 * once the reference was guaranteed.
 *
 * Run this once before enabling the cover sweep on a deployment that predates
 * the fix, and after any incident that interrupted profile image updates.
 *
 * It looks in both directions:
 *
 *  - **missing** — a user points at an avatar or cover carrying no reference to
 *    that user. The sweeper will delete it. Repair adds the reference.
 *  - **stale** — an avatar or cover carries a `user` reference that no user
 *    document points at any more: the image a replacement displaced but could
 *    not delete, the file a crash claimed before the profile was repointed, or
 *    the avatar of a deleted account. Nothing will ever collect it, because the
 *    sweeper only looks at *unreferenced* files. Repair removes the reference,
 *    which hands the file back to the sweeper — it is deleted, with its
 *    derivatives and its bytes, on the next run of the unused-file job rather
 *    than by this script. Deletion stays in the one code path that knows how to
 *    do it properly.
 *  - **dangling** — a user points at a file id with no file record. Reported
 *    only: the image is already gone and this script cannot recover it.
 *  - **unusable** — a user points at a file whose processing failed or never
 *    finished. Reported only: the profile is serving a broken image and somebody
 *    has to upload a new one. Nothing can invent the missing picture.
 *
 * The users live in the API database and the files live in the file server's own
 * database, so both connection strings are needed.
 *
 * Usage:
 *   node scripts/audit-profile-image-refs.js                     # dry run (default)
 *   node scripts/audit-profile-image-refs.js --apply             # write repairs
 *   node scripts/audit-profile-image-refs.js --file-server-uri=mongodb://...
 *
 * `FILE_SERVER_MONGO_URI` in the environment is used when the flag is absent.
 * Mutation is never the default, and the script is deliberately not wired into
 * startup or any request path.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { MongoClient, ObjectId } = require('mongodb');

const APPLY = process.argv.includes('--apply');
const PROFILE_IMAGE_TYPES = ['avatar', 'cover'];
const USER_REF_TYPE = 'user';

/**
 * Whether a file is one a profile can actually serve.
 *
 * Mirrors the check the write path applies before attaching, so the audit and
 * the API agree on what "usable" means. `skipped` counts as finished: some
 * uploads legitimately need no processing.
 */
function isUsable(file) {
  if (file.status === 'error' || file.processingError) return false;
  if (file.processingStatus && !['completed', 'skipped'].includes(file.processingStatus)) return false;
  return true;
}

/** `--file-server-uri=<uri>` wins over the environment so one-off runs need no env edit. */
function resolveFileServerUri() {
  const flag = process.argv.find((arg) => arg.startsWith('--file-server-uri='));
  return flag ? flag.slice('--file-server-uri='.length) : process.env.FILE_SERVER_MONGO_URI;
}

/**
 * Which user each avatar and cover currently belongs to.
 *
 * Keyed by file id; the value is the owning user id. A user has at most one of
 * each, so a file id appearing under two users would mean two profiles share an
 * image — reported rather than silently resolved in favour of one of them.
 */
async function loadProfileImageOwners(db) {
  const users = await db.collection('users')
    .find({ $or: [{ avatarId: { $ne: null } }, { coverId: { $ne: null } }] })
    .project({ _id: 1, avatarId: 1, coverId: 1 })
    .toArray();

  const owners = new Map();
  const shared = [];
  for (const user of users) {
    for (const fileId of [user.avatarId, user.coverId]) {
      if (!fileId) continue;
      const key = fileId.toString();
      const existing = owners.get(key);
      if (existing && existing !== user._id.toString()) {
        shared.push({ fileId: key, users: [existing, user._id.toString()] });
        continue;
      }
      owners.set(key, user._id.toString());
    }
  }

  return { owners, shared, scanned: users.length };
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
    const { owners, shared, scanned } = await loadProfileImageOwners(mongoose.connection.db);
    const filesCollection = fileServerClient.db().collection('files');

    const files = await filesCollection
      .find({ type: { $in: PROFILE_IMAGE_TYPES } })
      .project({
        _id: 1,
        type: 1,
        refItems: 1,
        createdAt: 1,
        status: 1,
        processingStatus: 1,
        processingError: 1
      })
      .toArray();

    const seenFileIds = new Set(files.map((file) => file._id.toString()));
    const missing = [];
    const stale = [];
    const unusable = [];

    for (const file of files) {
      const fileId = file._id.toString();
      const ownerId = owners.get(fileId);
      const userRefs = (file.refItems || []).filter((ref) => ref.itemType === USER_REF_TYPE);

      if (ownerId && !userRefs.some((ref) => ref.itemId && ref.itemId.toString() === ownerId)) {
        missing.push({ fileId, type: file.type, ownerId });
      }

      // A profile pointing at an image that was never produced. The write path
      // refuses these now; anything found here predates that check, and only a
      // fresh upload fixes it.
      if (ownerId && !isUsable(file)) {
        unusable.push({
          fileId,
          type: file.type,
          ownerId,
          reason: file.processingError ? 'processing error' : `status ${file.status}/${file.processingStatus}`
        });
      }

      // Any `user` reference pointing somewhere other than the current owner is
      // dead weight: that profile has moved on, and while the reference stands
      // the file is invisible to the sweeper.
      const deadRefs = userRefs
        .map((ref) => (ref.itemId ? ref.itemId.toString() : null))
        .filter((refUserId) => refUserId && refUserId !== ownerId);
      if (deadRefs.length) {
        stale.push({ fileId, type: file.type, deadRefs });
      }
    }

    const dangling = [...owners.entries()]
      .filter(([fileId]) => !seenFileIds.has(fileId))
      .map(([fileId, ownerId]) => ({ fileId, ownerId }));

    console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
    console.log(`users with a profile image: ${scanned}`);
    console.log(`avatar/cover files scanned: ${files.length}`);
    console.log(`missing reference:          ${missing.length}`);
    console.log(`stale reference:            ${stale.length}`);
    console.log(`dangling pointer:           ${dangling.length}`);
    console.log(`unusable image:             ${unusable.length}`);
    console.log(`shared between users:       ${shared.length}`);

    // Ids only — no filenames, urls or user data.
    if (missing.length) {
      console.log('\nmissing reference (sweeper would delete these):');
      missing.forEach((m) => console.log(`  ${m.fileId}  ${m.type.padEnd(6)}  owner ${m.ownerId}`));
    }
    if (stale.length) {
      console.log('\nstale reference (never collected; repair hands these to the sweeper):');
      stale.forEach((s) => console.log(`  ${s.fileId}  ${s.type.padEnd(6)}  refs ${s.deadRefs.join(', ')}`));
    }
    if (unusable.length) {
      console.log('\nunusable image (profile is serving a broken picture, needs a new upload):');
      unusable.forEach((u) => console.log(`  ${u.fileId}  ${u.type.padEnd(6)}  owner ${u.ownerId}  ${u.reason}`));
    }
    if (dangling.length) {
      console.log('\ndangling pointer (image already gone, not repairable here):');
      dangling.forEach((d) => console.log(`  user ${d.ownerId} -> ${d.fileId}`));
    }
    if (shared.length) {
      console.log('\nsame file on more than one profile (left untouched):');
      shared.forEach((s) => console.log(`  ${s.fileId}  users ${s.users.join(', ')}`));
    }

    if (!APPLY) {
      if (missing.length || stale.length) {
        console.log('\ndry run — nothing written. Re-run with --apply to correct these.');
      }
      return;
    }

    // Idempotent: `$addToSet` will not duplicate a reference and the pull matches
    // nothing on a second run, so re-running finds no work.
    let attached = 0;
    for (const m of missing) {
      // Sequential on purpose: a maintenance pass is not worth hammering the
      // database in parallel for.
      // eslint-disable-next-line no-await-in-loop
      const result = await filesCollection.updateOne(
        { _id: new ObjectId(m.fileId) },
        { $addToSet: { refItems: { itemId: new ObjectId(m.ownerId), itemType: USER_REF_TYPE } } }
      );
      if (result.modifiedCount) attached += 1;
    }

    let detached = 0;
    for (const s of stale) {
      // eslint-disable-next-line no-await-in-loop
      const result = await filesCollection.updateOne(
        { _id: new ObjectId(s.fileId) },
        {
          $pull: {
            refItems: {
              itemType: USER_REF_TYPE,
              itemId: { $in: s.deadRefs.map((id) => new ObjectId(id)) }
            }
          }
        }
      );
      if (result.modifiedCount) detached += 1;
    }

    console.log(`\nreferences attached: ${attached}`);
    console.log(`references detached: ${detached}`);
    if (detached) {
      console.log('detached files become collectable by the unused-file job on its next run.');
    }
  } finally {
    await fileServerClient.close();
    await mongoose.disconnect();
  }

  process.exit(0);
})().catch((error) => {
  console.error('audit failed:', error.message);
  process.exit(1);
});
