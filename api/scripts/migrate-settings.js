/* eslint-disable no-console */
const { DB, COLLECTION, upsertSetting } = require('../migrations/lib');
const siteSettings = require('../migrations/data/site-settings');

async function migrateSettings() {
  console.log('Starting site settings migration...');
  const settings = DB.collection(COLLECTION.SETTING);

  await siteSettings.reduce(async (previous, migration) => {
    await previous;

    const { oldKey, newData } = migration;
    const trimKey = oldKey.trim();
    const existingSetting = await settings.findOne({
      key: {
        $in: [oldKey, trimKey, newData.key]
      }
    });

    const value = existingSetting?.value !== undefined ? existingSetting.value : newData.value;

    if (existingSetting && existingSetting.key !== newData.key) {
      await settings.deleteOne({ _id: existingSetting._id });
    }

    await upsertSetting({
      ...newData,
      value
    });

    return Promise.resolve();
  }, Promise.resolve());
}

module.exports = migrateSettings;
