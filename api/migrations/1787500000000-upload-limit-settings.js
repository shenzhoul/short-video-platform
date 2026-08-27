/**
 * Seed the adjustable upload limits into the settings collection.
 *
 * ## One migration, not two
 *
 * This used to be a pair: this file seeded the rows, and
 * `1787700000000-split-upload-limit-settings.js` re-ran the identical upsert
 * afterwards to pick up re-shaped labels (`meta.section`, shorter `name`,
 * `meta.sectionNote`). That split existed for exactly one reason — the first
 * migration had already run on live databases and the runner will not run a
 * migration twice, so the only way to update those rows was a second file.
 *
 * The definitions live in `data/upload-limit-settings.js`, which both files read,
 * so the two `up` bodies were byte-for-byte identical. Once the database is
 * dropped and rebuilt there is no "already ran" case left to serve: this file
 * runs once against an empty collection and writes the final shape directly.
 * They were merged on 2026-08-26.
 *
 * ⚠️ If a database that already ran the old pair is ever brought forward instead
 * of rebuilt, it has both entries in its `migrations` collection and this file is
 * already recorded as applied — which is correct, because the rows it would
 * write are the ones already there.
 *
 * ## Idempotent
 *
 * `upsertSetting` leaves an existing value alone, so re-running never resets a
 * limit an operator has already tuned. It only ever adds the rows that are
 * missing — which is what makes it safe against a partially seeded database, and
 * what lets a later upload type be added by re-running rather than by writing
 * another migration.
 */
const { DB, COLLECTION, upsertSetting } = require('./lib');
const uploadLimitSettings = require('./data/upload-limit-settings');

module.exports.up = async function up(next) {
  const settings = DB.collection(COLLECTION.SETTING);

  await uploadLimitSettings.reduce(async (previous, { newData }) => {
    await previous;

    const existing = await settings.findOne({ key: newData.key });
    // The stored value wins. An operator who raised the avatar limit last month
    // must not have it silently put back on the next deploy. Labels and grouping
    // metadata are always taken from the definitions, because those are
    // presentation and the code is their source of truth.
    const value = existing?.value !== undefined ? existing.value : newData.value;

    await upsertSetting({ ...newData, value });
    return Promise.resolve();
  }, Promise.resolve());

  next();
};

module.exports.down = async function down(next) {
  // Removing the rows returns the system to its code defaults rather than to a
  // broken state, because every read falls back to them when a setting is
  // absent. So a rollback is genuinely safe.
  const settings = DB.collection(COLLECTION.SETTING);
  await settings.deleteMany({ key: { $in: uploadLimitSettings.map(({ newData }) => newData.key) } });
  next();
};
