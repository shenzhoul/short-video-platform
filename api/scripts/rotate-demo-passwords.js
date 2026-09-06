/**
 * Rotate the credentials of the already-seeded production demo accounts.
 *
 * ## Why
 *
 * `api/demo/demo.config.js` carries a shared demo password in plaintext, in a
 * public repository, and its comment claims production "never runs this
 * script" — but production *was* seeded from it. So a published string is a
 * live credential for sixteen ordinary (non-admin) accounts, each of which can
 * delete its own posts, rewrite its captions, replace its avatar and change its
 * own password.
 *
 * Changing the constant fixes nothing: `seedAccounts` hashes it **at seed
 * time** into the `auth` collection, so the committed value only ever affects a
 * future seed. The already-seeded accounts need their stored credential
 * rewritten, which is what this does.
 *
 * ## What it will not do
 *
 * It creates nothing, deletes nothing and reseeds nothing. It writes to exactly
 * one collection — `auth` — and only to rows belonging to the sixteen accounts
 * the seed manifest declares. Posts, media, R2 objects, the ledger and the
 * recommendation data are never touched, and neither is the superadmin.
 *
 * ## How the intended set is established
 *
 * Three independent conditions must all agree, and the count must be exact:
 *
 *   1. `username` is one of the accounts declared in `demo.config.js` themes;
 *   2. `metadata.demo.isDemo === true` — written by the seeder, server-side;
 *   3. `metadata.demo.namespace` matches the configured seed namespace.
 *
 * Matching on the `@demo.invalid` domain alone was rejected: it is a convention,
 * not a guarantee, and a future account could adopt it. If the exact expected
 * set cannot be established — a missing account, an unexpected extra, an
 * `isAdmin` row, a missing credential — this refuses to mutate anything rather
 * than rotating a partial set.
 *
 * ## Usage (inside the api container)
 *
 *   Rotate:  node scripts/rotate-demo-passwords.js
 *   Verify:  node scripts/rotate-demo-passwords.js --verify
 *
 * `--verify` proves, offline against the stored hashes, that the **committed**
 * password no longer authenticates and the current `DEMO_ACCOUNT_PASSWORD`
 * does. It loads the old value from `demo.config.js` itself, so neither
 * password ever reaches a shell, an argument list or a log.
 *
 * Idempotent: running it twice leaves the same end state (a fresh random salt
 * each time, which is expected — scrypt carries its salt inside the value).
 */
/* eslint-disable no-console */
const crypto = require('crypto');

const mongoose = require('mongoose');

const demoConfig = require('../demo/demo.config');
const { hashPassword } = require('../demo/lib/seed-accounts');

const MIN_LENGTH = 12;

function refuse(message) {
  console.error(`Refusing: ${message}`);
  process.exit(2);
}

/** The accounts the seed manifest declares — the authoritative expected set. */
function expectedUsernames() {
  const names = (demoConfig.themes || []).flatMap((theme) => (theme.accounts || []).map((a) => a.username));
  return [...new Set(names)].filter(Boolean);
}

/** What the browser sends: the plaintext, SHA-256'd. Mirrors the login path. */
const clientHash = (plain) => crypto.createHash('sha256').update(plain).digest('hex');

/**
 * Verify a plaintext against a stored `scrypt$v=1$N=..,r=..,p=..$salt$key`
 * credential, the same way the API's password hasher does.
 */
async function verifyAgainstStored(plain, stored) {
  if (typeof stored !== 'string' || !stored.startsWith('scrypt$')) return false;
  const parts = stored.split('$');
  if (parts.length !== 5) return false;

  const params = Object.fromEntries(parts[2].split(',').map((kv) => {
    const [k, v] = kv.split('=');
    return [k, Number(v)];
  }));
  const salt = Buffer.from(parts[3], 'base64');
  const expected = Buffer.from(parts[4], 'base64');

  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(
      clientHash(plain),
      salt,
      expected.length,
      {
        N: params.N, r: params.r, p: params.p, maxmem: 64 * 1024 * 1024
      },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });

  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

function resolveNewPassword() {
  const value = (process.env.DEMO_ACCOUNT_PASSWORD || '').trim();
  if (!value) {
    refuse('DEMO_ACCOUNT_PASSWORD is empty. Set it in deploy/.env and recreate the api container.');
  }
  if (value === demoConfig.seed.password) {
    refuse('DEMO_ACCOUNT_PASSWORD is the value committed in api/demo/demo.config.js, which is public.');
  }
  if (value.length < MIN_LENGTH) {
    refuse(`DEMO_ACCOUNT_PASSWORD is shorter than ${MIN_LENGTH} characters.`);
  }
  return value;
}

/** Load the exact intended accounts, refusing on any discrepancy. */
async function loadDemoAccounts(db) {
  const usernames = expectedUsernames();
  const namespace = demoConfig.seed.namespace;

  const users = await db.collection('users').find({
    username: { $in: usernames },
    'metadata.demo.isDemo': true,
    'metadata.demo.namespace': namespace
  }).toArray();

  console.log(`Seed manifest declares ${usernames.length} demo accounts; matched ${users.length} in the database.`);

  if (users.length !== usernames.length) {
    const found = new Set(users.map((u) => u.username));
    const missing = usernames.filter((u) => !found.has(u));
    refuse(
      `expected exactly ${usernames.length} demo accounts, found ${users.length}. `
      + `Missing or not marked as demo: ${missing.join(', ') || '(none — an unexpected extra matched)'}. `
      + 'The exact intended set could not be established, so nothing was changed.'
    );
  }

  const admins = users.filter((u) => u.isAdmin === true);
  if (admins.length) {
    refuse(`${admins.length} matched account(s) have isAdmin=true. This script never touches administrators.`);
  }

  return users;
}

async function main() {
  const verifyOnly = process.argv.includes('--verify');

  if (process.env.NODE_ENV !== 'production') {
    refuse('NODE_ENV is not "production". Run this inside the api container.');
  }
  const newPassword = resolveNewPassword();

  const uri = process.env.MONGO_URI;
  if (!uri) refuse('MONGO_URI is not set.');

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  const auth = db.collection('auth');

  const users = await loadDemoAccounts(db);
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const credentials = await auth.find({
    type: 'password',
    userId: { $in: users.map((u) => u._id) }
  }).toArray();

  const withCredential = new Set(credentials.map((c) => String(c.userId)));
  const missingCredential = users.filter((u) => !withCredential.has(String(u._id)));
  if (missingCredential.length) {
    await mongoose.disconnect();
    refuse(
      `${missingCredential.length} demo account(s) have no password credential: `
      + `${missingCredential.map((u) => u.username).join(', ')}. `
      + 'This script rotates existing credentials and will not create one.'
    );
  }

  // ---------------------------------------------------------------- verify
  if (verifyOnly) {
    const sample = credentials[0];
    const sampleUser = byId.get(String(sample.userId));

    // The committed password is read from the config, never from a shell.
    const oldAccepted = await verifyAgainstStored(demoConfig.seed.password, sample.value);
    const newAccepted = await verifyAgainstStored(newPassword, sample.value);
    const allScrypt = credentials.every((c) => String(c.value || '').startsWith('scrypt$'));

    await mongoose.disconnect();

    console.log('');
    console.log(`accounts with a credential   : ${credentials.length} / ${users.length}`);
    console.log(`all in current scrypt format : ${allScrypt ? 'yes' : 'NO'}`);
    console.log(`sample account               : ${sampleUser.username}`);
    console.log(`committed password accepted  : ${oldAccepted ? 'YES — ROTATION DID NOT TAKE' : 'no (expected)'}`);
    console.log(`DEMO_ACCOUNT_PASSWORD accepted: ${newAccepted ? 'yes (expected)' : 'NO — something is wrong'}`);
    console.log('');

    const ok = !oldAccepted && newAccepted && allScrypt && credentials.length === users.length;
    console.log(ok ? 'VERIFY PASS' : 'VERIFY FAIL');
    process.exit(ok ? 0 : 1);
  }

  // ---------------------------------------------------------------- rotate
  console.log(`Rotating ${users.length} demo credentials in place. No account is created or deleted.`);

  let rotated = 0;
  for (const user of users) {
    // Each account gets its own scrypt salt, so sixteen accounts sharing one
    // password do not share a stored value.
    // eslint-disable-next-line no-await-in-loop
    const value = await hashPassword(newPassword);
    // eslint-disable-next-line no-await-in-loop
    const result = await auth.updateOne(
      { type: 'password', userId: user._id },
      {
        // No `salt` column: scrypt carries its own salt inside the value, and
        // the legacy verifier keys off that field's presence.
        $set: { value, updatedAt: new Date() },
        $unset: { salt: '' }
      }
    );
    if (result.matchedCount === 1) rotated += 1;
  }

  const after = await auth.find({
    type: 'password',
    userId: { $in: users.map((u) => u._id) }
  }).toArray();
  const usable = after.filter((c) => String(c.value || '').startsWith('scrypt$') && !c.salt);

  await mongoose.disconnect();

  console.log(`rotated            : ${rotated} / ${users.length}`);
  console.log(`usable credentials : ${usable.length} / ${users.length}`);
  console.log(`accounts           : ${users.map((u) => u.username).join(', ')}`);

  if (rotated !== users.length || usable.length !== users.length) {
    console.error('Not every demo credential rotated cleanly. Investigate before relying on this.');
    process.exit(1);
  }
  console.log('');
  console.log('Done. Re-run with --verify to confirm the committed password no longer authenticates.');
}

main().catch((error) => {
  console.error(`Failed: ${error.message}`);
  process.exit(1);
});
