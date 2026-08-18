const resetAdminPw = require('../scripts/reset-admin-pw');

module.exports.up = async function (next) {
  await resetAdminPw();
  next();
};

module.exports.down = function (next) {
  next();
};
