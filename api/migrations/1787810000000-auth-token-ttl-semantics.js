/**
 * Repair the `auth_tokens` TTL index on databases that already ran
 * `1787800000000-auth-token-indexes.js` when it declared `expireAfterSeconds:
 * 604800`.
 *
 * `expiresAt` is an absolute instant, so the correct option is `0` — delete once
 * that instant has passed. `604800` meant "delete a week *after* the token
 * expired". No retention was ever asked for, and `createIndex` cannot change an
 * existing index's options, so this drops and recreates that one index.
 *
 * Delegates to `scripts/repair-auth-token-ttl-index.js`, which is the same code
 * an operator runs by hand: it reads the live options first, does nothing when
 * they already match, never touches the other two indexes, and reads the result
 * back from MongoDB before reporting success. Running this migration twice, or
 * running it on a fresh database the updated `1787800000000` already got right,
 * changes nothing.
 */
const { execFileSync } = require('child_process');
const path = require('path');

module.exports.up = function up(next) {
  try {
    const output = execFileSync(
      process.execPath,
      [path.join(__dirname, '..', 'scripts', 'repair-auth-token-ttl-index.js'), '--apply'],
      { encoding: 'utf8', env: process.env }
    );
    output.split('\n').filter(Boolean).forEach((line) => console.log(`  ${line}`));
    return next();
  } catch (error) {
    return next(new Error(`auth_tokens TTL repair failed: ${error.stdout || error.message}`));
  }
};

module.exports.down = function down(next) {
  // Deliberately empty. Reverting would mean reinstating a seven-day retention
  // that was never a requirement, and dropping the index outright would remove
  // housekeeping the collection still wants.
  next();
};
