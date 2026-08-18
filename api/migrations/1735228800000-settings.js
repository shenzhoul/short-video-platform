const migrateSettings = require('../scripts/migrate-settings');

module.exports.up = async function up(next) {
  await migrateSettings();
  next();
};

module.exports.down = function down(next) {
  next();
};
