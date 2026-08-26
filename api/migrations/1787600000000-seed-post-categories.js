/**
 * Seed the post category catalogue.
 *
 * ## Why this is the only bootstrap path
 *
 * `yarn migrate` is step 5 of the documented local setup in the repository
 * README, and it already has to run before anything works — it is what creates
 * the `superadmin` account and seeds system settings. Putting the catalogue here
 * means there is exactly one place the default categories are defined, and it is
 * the same place every other piece of default data lives. There is deliberately
 * no second seed at application boot: two bootstrap sources for one collection
 * is how they drift.
 *
 * ## Idempotent
 *
 * `$setOnInsert` only writes on insert, so re-running never resets a name an
 * admin has edited, a category they have disabled, or an ordering they have
 * rearranged. Running this against a database that already has some of the
 * categories adds only the missing ones.
 *
 * ## No post is touched
 *
 * Posts already store these keys in `topicKey`. This migration gives those keys
 * a record to resolve against; it does not read or write the `posts` collection
 * at all. Nine of nine existing posts on a development database carry a key from
 * this list, so nothing needs backfilling.
 *
 * ## Index before data
 *
 * The unique index is created first so a concurrent or repeated run collides at
 * the database rather than producing two records for one key. The definition
 * matches `CategorySchema` exactly (same name, same key, same options), so
 * Mongoose's `autoIndex` at boot finds it already present and does nothing.
 */
const { DB, COLLECTION } = require('./lib');
const postCategories = require('./data/post-categories');

const KEY_INDEX_NAME = 'idx_category_key_unique';
const LISTING_INDEX_NAME = 'idx_category_status_ordering_name';

module.exports.up = async function up(next) {
  const categories = DB.collection(COLLECTION.CATEGORY);

  await categories.createIndex({ key: 1 }, { name: KEY_INDEX_NAME, unique: true });
  await categories.createIndex(
    { status: 1, ordering: 1, name: 1 },
    { name: LISTING_INDEX_NAME }
  );

  const now = new Date();
  await postCategories.reduce(async (previous, category) => {
    await previous;

    await categories.updateOne(
      { key: category.key },
      {
        $setOnInsert: {
          ...category,
          createdAt: now,
          updatedAt: now
        }
      },
      { upsert: true }
    );

    return Promise.resolve();
  }, Promise.resolve());

  next();
};

module.exports.down = async function down(next) {
  const categories = DB.collection(COLLECTION.CATEGORY);
  const posts = DB.collection(COLLECTION.POST);

  // Only remove a seeded category that nothing points at. A post whose topicKey
  // no longer resolves would render without its category and could not be saved
  // again without picking a new one, so a rollback must not create that state.
  await postCategories.reduce(async (previous, category) => {
    await previous;

    const references = await posts.countDocuments({ topicKey: category.key });
    if (references === 0) {
      await categories.deleteOne({ key: category.key });
    }

    return Promise.resolve();
  }, Promise.resolve());

  next();
};
