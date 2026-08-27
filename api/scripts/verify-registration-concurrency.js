/**
 * Prove that two simultaneous registrations for the same identity can create at
 * most one account — against a real MongoDB with the real indexes, not a mock.
 *
 * Why this is a script and not a `.spec.ts`:
 *
 * The unit suite mocks MongoDB, which is the right default: `yarn test` must run
 * on a machine with no database. But a mocked `E11000` proves only that the
 * *handler* is correct; it says nothing about whether the index that raises it
 * actually exists, or whether Mongoose's `autoIndex` ever created it. This
 * script closes that gap, and is deliberately kept out of `testRegex` so it
 * cannot make the default suite depend on a live server.
 *
 * It also bypasses the HTTP layer on purpose. The live probe through
 * `POST /auth/register` could not reach the race at all: the throttler
 * (5 requests / 5 minutes) rejected the second request before it touched the
 * database, so the "only one account" result was produced by the rate limiter
 * rather than by the unique index. Going straight at the service is the only way
 * to observe the index doing its job.
 *
 * Everything runs in a database created for this run and dropped at the end;
 * nothing touches development data.
 *
 * Usage:
 *   yarn build && node scripts/verify-registration-concurrency.js
 *
 * Exit code 0 = every assertion held. Non-zero = a real finding; read the
 * output, it names the state that was observed.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const { UserSchema } = require('../dist/schemas/identity/user/user.schema');
const { AuthSchema } = require('../dist/schemas/identity/auth/auth.schema');
const { AuthService } = require('../dist/services/identity/auth/auth.service');
const { PasswordHasherService } = require('../dist/services/identity/auth/password-hasher.service');
const { UserAccountManagementService } = require('../dist/services/identity/user/user.service');

const BASE_URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';
const DB_NAME = `douyin_clone_regconc_${Date.now()}`;

const failures = [];
function check(name, ok, detail = '') {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

/** Point the connection at a throwaway database rather than the dev one. */
function disposableUri() {
  const url = new URL(BASE_URI.replace('mongodb://', 'http://').replace('mongodb+srv://', 'https://'));
  url.pathname = `/${DB_NAME}`;
  return url.toString().replace('http://', 'mongodb://').replace('https://', 'mongodb+srv://');
}

function buildService(connection) {
  const UserModel = connection.model('User', UserSchema);
  const AuthModel = connection.model('Auth', AuthSchema);

  // Only the collaborators the registration path actually uses are real. The
  // rest are never reached, and passing stubs keeps the script from booting the
  // whole Nest container for a two-call test.
  // The hasher is a real one: registration stores a real scrypt credential, and
  // a stub would hide a failure in the write path this probe is meant to observe.
  const authService = new AuthService(AuthModel, null, null, null, new PasswordHasherService());
  const published = [];
  const service = new UserAccountManagementService(
    UserModel,
    { publish: async (channel, message) => { published.push({ channel, message }); } },
    authService,
    null,
    null,
    null,
    null
  );

  return {
    service, UserModel, AuthModel, published
  };
}

function registration(overrides = {}) {
  return {
    email: 'Race@Example.com',
    username: 'RaceCandidate',
    name: 'Race Candidate',
    firstName: 'Race',
    lastName: 'Candidate',
    gender: 'female',
    // Already SHA256-hashed by the client, exactly as the web app sends it.
    password: 'c'.repeat(64),
    ...overrides
  };
}

/** One race, reported in full. */
async function race(label, service, UserModel, AuthModel, payloadA, payloadB, expectedException) {
  const results = await Promise.allSettled([
    service.registerNewUser(payloadA),
    service.registerNewUser(payloadB)
  ]);

  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  const rejected = results.filter((r) => r.status === 'rejected');

  console.log(`\n--- ${label} ---`);
  check(`${label}: exactly one call succeeded`, fulfilled.length === 1,
    `fulfilled=${fulfilled.length} rejected=${rejected.length}`);

  // The message reads as a raw key (`errors.email_taken`) here and only here:
  // this script never boots Nest, so `TranslationService` was never installed
  // and `__t` falls through to the key. Served by the running API the same
  // exception renders "That email address is already registered." What matters
  // for the race is the exception *type* and the status, which are asserted.
  const reason = rejected[0]?.reason;
  check(`${label}: the loser got a normalised duplicate error`,
    reason?.constructor?.name === expectedException,
    `${reason?.constructor?.name} status=${typeof reason?.getStatus === 'function' ? reason.getStatus() : 'n/a'} message=${JSON.stringify(reason?.message)}`);
  check(`${label}: the loser got HTTP 400, not a raw driver 500`,
    typeof reason?.getStatus === 'function' && reason.getStatus() === 400);

  const users = await UserModel.find({}).lean();
  const auths = await AuthModel.find({}).lean();

  check(`${label}: exactly one user document`, users.length === 1, `count=${users.length}`);
  check(`${label}: exactly one auth document`, auths.length === 1, `count=${auths.length}`);

  // Orphans are the two states nothing else would notice: a user who can never
  // log in, and a credential belonging to nobody.
  const userIds = users.map((u) => String(u._id));
  const orphanAuths = auths.filter((a) => !userIds.includes(String(a.userId)));
  const authUserIds = auths.map((a) => String(a.userId));
  const orphanUsers = users.filter((u) => !authUserIds.includes(String(u._id)));

  check(`${label}: no orphan auth record`, orphanAuths.length === 0, `orphans=${orphanAuths.length}`);
  check(`${label}: no user left without a credential`, orphanUsers.length === 0, `orphans=${orphanUsers.length}`);

  if (users.length === 1) {
    const [user] = users;
    check(`${label}: the surviving account is an ordinary active one`,
      user.isAdmin === false && user.status === 'active' && user.verifiedEmail === false,
      `isAdmin=${user.isAdmin} status=${user.status} verifiedEmail=${user.verifiedEmail}`);
  }

  // Clear for the next scenario.
  await UserModel.deleteMany({});
  await AuthModel.deleteMany({});
}

(async () => {
  const uri = disposableUri();
  console.log(`disposable database: ${DB_NAME}`);
  const connection = await mongoose.createConnection(uri).asPromise();

  try {
    const {
      service, UserModel, AuthModel
    } = buildService(connection);

    // Build the indexes for real, then read them back. `syncIndexes` is what
    // makes this a test of the constraint rather than of the error handler.
    await UserModel.syncIndexes();
    await AuthModel.syncIndexes();

    const userIndexes = await UserModel.collection.listIndexes().toArray();
    const byName = Object.fromEntries(userIndexes.map((i) => [i.name, i]));

    console.log(`\n--- indexes actually present on ${DB_NAME}.users ---`);
    userIndexes.forEach((i) => console.log(`  ${i.name} ${JSON.stringify(i.key)}${i.unique ? ' UNIQUE' : ''}`));

    check('email uniqueness index exists and is unique',
      !!byName.idx_email_unique_auth?.unique,
      JSON.stringify(byName.idx_email_unique_auth || null));
    check('username uniqueness index exists and is unique',
      !!byName.idx_username_unique_profile?.unique,
      JSON.stringify(byName.idx_username_unique_profile || null));

    // Same email, different username -> the email index must decide.
    await race('same email', service, UserModel, AuthModel,
      registration(),
      registration({ username: 'RaceOther' }),
      'EmailHasBeenTakenException');

    // Same username, different email -> the username index must decide.
    await race('same username', service, UserModel, AuthModel,
      registration(),
      registration({ email: 'other@example.com' }),
      'UsernameTakenException');

    // Identical in both -> whichever index is hit first, still one account.
    await race('identical payloads', service, UserModel, AuthModel,
      registration(),
      registration(),
      'EmailHasBeenTakenException');

    console.log('\n--- auth index coverage (reported, not asserted) ---');
    const authIndexes = await AuthModel.collection.listIndexes().toArray();
    authIndexes.forEach((i) => console.log(`  ${i.name} ${JSON.stringify(i.key)}${i.unique ? ' UNIQUE' : ''}`));
    const uniqueAuthIndex = authIndexes.find((i) => i.unique);
    console.log(uniqueAuthIndex
      ? `  -> a unique constraint exists: ${uniqueAuthIndex.name}`
      : '  -> NOTE: no unique index on `auth`. Registration is unaffected (each winner is a distinct user), but nothing at the database level stops two password rows for one user.');
  } finally {
    await connection.dropDatabase();
    await connection.close();
    console.log(`\ndropped database: ${DB_NAME}`);
  }

  if (failures.length) {
    console.log(`\n${failures.length} FAILED: ${failures.join(' | ')}`);
    process.exit(1);
  }
  console.log('\nall assertions held');
})().catch((error) => {
  console.error('probe error:', error);
  process.exit(2);
});
