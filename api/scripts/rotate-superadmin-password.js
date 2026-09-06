/**
 * Rotate the production superadmin password, in place.
 *
 * ## Why this exists rather than `yarn migrate`
 *
 * The superadmin is created by migration `1756258634605-create-admin-account`,
 * which delegates to `reset-admin-pw.js`. That migration is **recorded as
 * applied** in the `migrations` collection, so it never runs again — which
 * means setting `SUPERADMIN_PASSWORD` in `deploy/.env` after the first
 * deployment changes nothing at all about the account that already exists.
 * Nothing else in the codebase reads that variable at runtime.
 *
 * So rotation needs a deliberate, one-off invocation. This is it.
 *
 * ## What it does and does not do
 *
 * It calls the same `reset-admin-pw` routine the migration uses, which finds
 * the existing `superadmin` user and rewrites its credential **in place**:
 * same `_id`, same username, same email, same `isAdmin`. No second
 * administrator is created and no permission changes.
 *
 * It does not touch sessions. Redis-backed tokens issued before the rotation
 * stay valid until they expire, so rotating cannot log you out of the browser
 * tab you are running this from.
 *
 * ## Safety
 *
 * Four refusals, because the failure this guards against is silently writing a
 * publicly-known password onto a publicly-reachable admin panel:
 *
 *   1. refuses unless NODE_ENV=production, so it cannot be aimed at production
 *      from a shell that would take the development fallback instead;
 *   2. refuses without SUPERADMIN_PASSWORD;
 *   3. refuses a password equal to the committed development fallback;
 *   4. refuses a password under 12 characters.
 *
 * It prints no password, no hash and no connection string — this runs inside a
 * container whose stdout the Docker logging driver writes to disk, where
 * anything printed outlives the command.
 *
 * ## Usage (inside the api container, which already has MONGO_URI and NODE_ENV)
 *
 *   1. Put the new value in deploy/.env as SUPERADMIN_PASSWORD (use an editor,
 *      so it never reaches shell history).
 *   2. docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
 *        exec api node scripts/rotate-superadmin-password.js
 *
 * The container reads deploy/.env through `env_file`, so the new value is
 * already in its environment and never appears on a command line.
 */
/* eslint-disable no-console */
const mongoose = require('mongoose');

const resetAdminPassword = require('./reset-admin-pw');

/** Committed to a public repository; must never become a production credential. */
const PUBLICLY_KNOWN_FALLBACK = 'adminadmin';
const MIN_LENGTH = 12;

function refuse(message) {
  console.error(`Refusing to rotate: ${message}`);
  process.exit(2);
}

async function main() {
  if (process.env.NODE_ENV !== 'production') {
    refuse(
      'NODE_ENV is not "production". Run this inside the api container, where '
      + 'the production guard in reset-admin-pw.js is active — outside it, a '
      + 'missing password silently falls back to the committed default.'
    );
  }

  const password = (process.env.SUPERADMIN_PASSWORD || '').trim();
  if (!password) {
    refuse('SUPERADMIN_PASSWORD is empty. Set it in deploy/.env and try again.');
  }
  if (password === PUBLICLY_KNOWN_FALLBACK) {
    refuse('SUPERADMIN_PASSWORD is the development default, which is committed to this public repository.');
  }
  if (password.length < MIN_LENGTH) {
    refuse(`SUPERADMIN_PASSWORD is shorter than ${MIN_LENGTH} characters.`);
  }

  const uri = process.env.MONGO_URI;
  if (!uri) refuse('MONGO_URI is not set.');

  await mongoose.connect(uri);

  const users = mongoose.connection.collection('users');
  const before = await users.findOne({ username: 'superadmin' });
  if (!before) {
    await mongoose.disconnect();
    refuse(
      'No account with username "superadmin" exists. This script rotates an '
      + 'existing administrator and deliberately will not create one — run the '
      + 'migration instead if the account is genuinely missing.'
    );
  }

  // Identity is echoed so the operator can see *which* account moved, without
  // any credential material.
  console.log(`Rotating credential for superadmin (id ${before._id}, isAdmin=${before.isAdmin}).`);

  await resetAdminPassword();

  const after = await users.findOne({ username: 'superadmin' });
  const preserved = String(after._id) === String(before._id)
    && after.username === before.username
    && after.email === before.email
    && after.isAdmin === true;

  const auth = await mongoose.connection.collection('auth')
    .findOne({ type: 'password', userId: after._id });

  await mongoose.disconnect();

  if (!preserved) {
    console.error('Account identity changed unexpectedly. Investigate before signing out anywhere.');
    process.exit(1);
  }
  if (!auth || !auth.value || !auth.salt) {
    console.error('No usable password credential after the rotation. Investigate immediately.');
    process.exit(1);
  }

  console.log('Rotation complete. Same account, same permissions, new credential.');
  console.log('Existing sessions are unaffected; sign in from a private window to verify.');
}

main().catch((error) => {
  console.error(`Rotation failed: ${error.message}`);
  process.exit(1);
});
