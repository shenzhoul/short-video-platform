/**
 * Re-shape the upload-limit settings so the admin screen can split them into a
 * section per upload type.
 *
 * ## Why a second migration rather than editing the first
 *
 * `1787500000000-upload-limit-settings.js` already ran everywhere, and the
 * migration runner will not run it again. Editing its data file alone would
 * change what a *fresh* database gets while leaving every existing install on
 * the old labels — the two would drift apart silently. This re-runs the same
 * upsert against the updated definitions so both end up identical.
 *
 * ## What actually changes
 *
 * Presentation only:
 * - `name` loses the `Comment photo · ` prefix, because the section heading now
 *   carries the upload type.
 * - `description` loses the two sentences that were repeated verbatim on all
 *   fifty-seven rows; they move to `meta.sectionNote`, shown once per section.
 * - `meta` gains `section`, `sectionLabel`, `sectionGroup` and `sectionNote`.
 *
 * No limit changes. `value` is read back from the stored document and written
 * unchanged, so a number an operator tuned survives — the same rule the first
 * migration established.
 */
const { DB, COLLECTION, upsertSetting } = require('./lib');
const uploadLimitSettings = require('./data/upload-limit-settings');

module.exports.up = async function up(next) {
  const settings = DB.collection(COLLECTION.SETTING);

  await uploadLimitSettings.reduce(async (previous, { newData }) => {
    await previous;

    const existing = await settings.findOne({ key: newData.key });
    // The stored value wins, exactly as in the original seed. This migration is
    // about labels; it must never move a limit an operator has already set.
    const value = existing?.value !== undefined ? existing.value : newData.value;

    await upsertSetting({ ...newData, value });
    return Promise.resolve();
  }, Promise.resolve());

  next();
};

module.exports.down = async function down(next) {
  // There is nothing to undo that matters: the fields this rewrote are labels
  // and grouping hints. Rolling back would only restore wordier text while the
  // limits — the part that changes behaviour — were never touched either way.
  // Leaving the rows as they are keeps the admin screen working on both sides of
  // a rollback, which a partial revert of `meta` would not.
  next();
};
