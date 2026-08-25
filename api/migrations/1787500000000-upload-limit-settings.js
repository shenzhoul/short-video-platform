/**
 * Seed the adjustable upload limits into the settings collection.
 *
 * Idempotent: `upsertSetting` leaves an existing value alone, so re-running this
 * never resets a limit an operator has already tuned. It only ever adds the rows
 * that are missing — which is what makes it safe to run against a database that
 * already has some of them, and what lets a later upload type be added by
 * re-running rather than by writing another migration.
 */
const { DB, COLLECTION, upsertSetting } = require('./lib');
const uploadLimitSettings = require('./data/upload-limit-settings');

module.exports.up = async function up(next) {
  const settings = DB.collection(COLLECTION.SETTING);

  await uploadLimitSettings.reduce(async (previous, { newData }) => {
    await previous;

    const existing = await settings.findOne({ key: newData.key });
    // The stored value wins. An operator who raised the avatar limit last month
    // must not have it silently put back on the next deploy.
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
