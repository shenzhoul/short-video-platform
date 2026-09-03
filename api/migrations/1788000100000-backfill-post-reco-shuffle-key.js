/**
 * Backfill `recoShuffleKey` on posts written before this field existed.
 *
 * `Post.recoShuffleKey` has a schema `default: () => Math.random()`, but a
 * Mongoose default only applies on `save()` — an already-persisted document
 * has no such field until something writes to it. Left unbackfilled, every
 * pre-existing post would be silently invisible to the shuffle-key range scan
 * (`recoShuffleKey: { $gte: anchor }`) that the fresh/diverse-discovery
 * candidate sources depend on (see `RecommendationCandidateService`), because
 * a missing field never satisfies a `$gte` comparison.
 *
 * Batched rather than one giant `updateMany`, so this stays safe to run
 * against a database with a large `posts` collection without holding a single
 * huge write lock or materializing every id in memory at once.
 */
const { DB, COLLECTION } = require('./lib');

const BATCH_SIZE = 1000;

module.exports.up = async function up(next) {
  try {
    const posts = DB.collection(COLLECTION.POST);
    let migrated = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const batch = await posts
        .find({ recoShuffleKey: { $exists: false } })
        .project({ _id: 1 })
        .limit(BATCH_SIZE)
        .toArray();

      if (!batch.length) break;

      const ops = batch.map((doc) => ({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { recoShuffleKey: Math.random() } }
        }
      }));
      await posts.bulkWrite(ops, { ordered: false });
      migrated += batch.length;
    }

    console.log(`  Backfilled recoShuffleKey on ${migrated} posts`);
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports.down = function down(next) {
  // Deliberately empty: removing the field would only reopen the gap this
  // migration exists to close, with no compensating benefit.
  next();
};
