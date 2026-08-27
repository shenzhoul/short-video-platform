/**
 * Prove one credential per user per type — against a real MongoDB with the real
 * index, and prove the repair script actually repairs.
 *
 * Kept out of `testRegex` for the same reason as
 * `verify-registration-concurrency.js`: `yarn test` must run without a database,
 * and a mocked `E11000` proves only that the handler is right, not that the
 * constraint exists.
 *
 * Everything runs in a database created for this run and dropped in `finally`;
 * development data is never touched.
 *
 * Usage:
 *   yarn build && node scripts/verify-auth-credential-uniqueness.js
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

const { AuthSchema } = require('../dist/schemas/identity/auth/auth.schema');
const { AuthService } = require('../dist/services/identity/auth/auth.service');
const { PasswordHasherService } = require('../dist/services/identity/auth/password-hasher.service');
const { CredentialWriteConflictException } = require('../dist/common/exceptions/auth/credential-write-conflict.exception');
const { CredentialAlreadyExistsException } = require('../dist/common/exceptions/auth/credential-conflict.exception');

const BASE_URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';
const DB_NAME = `douyin_clone_authuniq_${Date.now()}`;
const NEW_INDEX = 'idx_userId_type_unique_credential';
const OLD_INDEX = 'idx_userId_type_management';

const failures = [];
function check(name, ok, detail = '') {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

function disposableUri() {
  const url = new URL(BASE_URI.replace('mongodb://', 'http://').replace('mongodb+srv://', 'https://'));
  url.pathname = `/${DB_NAME}`;
  return url.toString().replace('http://', 'mongodb://').replace('https://', 'mongodb+srv://');
}

/** Run the repair script against the disposable database. */
function runRepair(args) {
  return execFileSync(
    process.execPath,
    [path.join(__dirname, 'repair-auth-credential-duplicates.js'), ...args],
    { env: { ...process.env, MONGO_URI: disposableUri() }, encoding: 'utf8' }
  );
}

(async () => {
  console.log(`disposable database: ${DB_NAME}`);
  const connection = await mongoose.createConnection(disposableUri()).asPromise();
  let exitCode = 0;

  try {
    const AuthModel = connection.model('Auth', AuthSchema);
    const collection = AuthModel.collection;

    // --- 1. build the indexes through the real flow ---------------------------
    await AuthModel.syncIndexes();

    const indexes = await collection.listIndexes().toArray();
    console.log('\n--- indexes actually present on `auth` ---');
    indexes.forEach((i) => console.log(`  ${i.name} ${JSON.stringify(i.key)}${i.unique ? ' UNIQUE' : ''}`));

    const unique = indexes.find((i) => i.name === NEW_INDEX);
    check('the credential uniqueness index exists and is unique',
      !!unique?.unique, JSON.stringify(unique || null));
    check('the index covers the logical credential key { userId, type }',
      JSON.stringify(unique?.key) === JSON.stringify({ userId: 1, type: 1 }),
      JSON.stringify(unique?.key));
    check('the superseded non-unique index is gone',
      !indexes.some((i) => i.name === OLD_INDEX));

    // --- 2. MongoDB itself refuses a direct duplicate -------------------------
    const userId = new mongoose.Types.ObjectId();
    await collection.insertOne({ userId, type: 'password', value: 'scrypt$v=1$x$y$z' });

    let rawDuplicateRejected = false;
    let rawError = null;
    try {
      await collection.insertOne({ userId, type: 'password', value: 'scrypt$v=1$a$b$c' });
    } catch (error) {
      rawDuplicateRejected = error?.code === 11000;
      rawError = error;
    }
    check('MongoDB rejects a second credential for the same user and type',
      rawDuplicateRejected, `code=${rawError?.code}`);
    await collection.deleteMany({});

    // --- 3. concurrent createAuthPassword ------------------------------------
    const service = new AuthService(AuthModel, null, null, null, new PasswordHasherService());
    const raceUserId = new mongoose.Types.ObjectId();

    const results = await Promise.allSettled([
      service.createAuthPassword({
        userId: raceUserId, type: 'password', key: 'a@b.com', value: 'first-password'
      }),
      service.createAuthPassword({
        userId: raceUserId, type: 'password', key: 'a@b.com', value: 'second-password'
      })
    ]);

    const rejected = results.filter((r) => r.status === 'rejected');
    console.log('\n--- concurrent createAuthPassword ---');
    results.forEach((r, i) => console.log(`  call ${i + 1}: ${r.status}${r.status === 'rejected' ? ` (${r.reason?.constructor?.name})` : ''}`));

    const rows = await collection.find({ userId: raceUserId }).toArray();
    check('exactly one credential row exists after the race', rows.length === 1, `count=${rows.length}`);

    // Create is create-only since 2026-08-26: the two calls carry different
    // passwords, so exactly one may succeed and the loser must be told it did
    // not — a false success is the failure mode this replaced.
    // `verify-password-change.js` covers these semantics in full.
    const rawLeak = rejected.filter((r) => r.reason?.code === 11000);
    check('no raw E11000 escaped to the caller', rawLeak.length === 0,
      rawLeak.map((r) => r.reason?.message).join(' | '));
    check('exactly one create succeeded', results.filter((r) => r.status === 'fulfilled').length === 1,
      `fulfilled=${results.filter((r) => r.status === 'fulfilled').length}`);
    check('any rejection is a typed domain exception',
      rejected.every((r) => r.reason instanceof CredentialAlreadyExistsException
        || r.reason instanceof CredentialWriteConflictException),
      rejected.map((r) => r.reason?.constructor?.name).join(', '));

    check('the surviving credential is scrypt, not legacy',
      typeof rows[0]?.value === 'string' && rows[0].value.startsWith('scrypt$v=1$'),
      String(rows[0]?.value).slice(0, 16));
    check('the legacy salt column is not left behind', rows[0]?.salt === undefined);

    // --- 4. a password change updates in place -------------------------------
    // `replaceAuthPassword`, not create: changing a password is a different
    // operation and must never insert a second row.
    await service.replaceAuthPassword({
      userId: raceUserId, type: 'password', key: 'a@b.com', value: 'changed-password'
    });
    const afterChange = await collection.find({ userId: raceUserId }).toArray();
    check('changing a password updates the existing row rather than adding one',
      afterChange.length === 1, `count=${afterChange.length}`);
    check('the changed password verifies',
      (await new PasswordHasherService().verify('changed-password', afterChange[0])).valid);
    check('neither original password still verifies',
      !(await new PasswordHasherService().verify('first-password', afterChange[0])).valid
      && !(await new PasswordHasherService().verify('second-password', afterChange[0])).valid);

    await collection.deleteMany({});

    // --- 5. the repair script, on a database that has duplicates --------------
    // Drop the constraint so duplicates can be planted, exactly as they exist in
    // a database written before it.
    await collection.dropIndex(NEW_INDEX);
    const dupUserId = new mongoose.Types.ObjectId();
    const older = {
      userId: dupUserId, type: 'password', value: 'scrypt$v=1$old', key: 'a@b.com', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-01-01')
    };
    const newer = {
      userId: dupUserId, type: 'password', value: 'scrypt$v=1$new', key: 'a@b.com', createdAt: new Date('2026-01-01'), updatedAt: new Date('2026-06-01')
    };
    const unrelatedUserId = new mongoose.Types.ObjectId();
    const unrelated = { userId: unrelatedUserId, type: 'password', value: 'scrypt$v=1$other', key: 'c@d.com' };
    await collection.insertMany([older, newer, unrelated]);

    console.log('\n--- repair: dry run ---');
    const dryRun = runRepair([]);
    console.log(dryRun.split('\n').filter((l) => l.trim()).map((l) => `  ${l}`).join('\n'));
    check('dry run reports the duplicate group', /duplicate \{userId, type\} groups: 1/.test(dryRun));
    check('dry run keeps the most recently updated record',
      new RegExp(`keep\\s+${newer._id}`).test(dryRun), String(newer._id));
    check('dry run wrote nothing', (await collection.countDocuments()) === 3);

    console.log('\n--- repair: apply ---');
    const applied = runRepair(['--apply']);
    console.log(applied.split('\n').filter((l) => l.trim()).map((l) => `  ${l}`).join('\n'));

    const remaining = await collection.find({ userId: dupUserId }).toArray();
    check('apply collapsed the group to one record', remaining.length === 1, `count=${remaining.length}`);
    check('apply kept the newest record', String(remaining[0]?._id) === String(newer._id));
    check('apply left the unrelated user untouched',
      (await collection.countDocuments({ userId: unrelatedUserId })) === 1);

    const repairedIndexes = await collection.listIndexes().toArray();
    check('apply created the uniqueness index',
      repairedIndexes.some((i) => i.name === NEW_INDEX && i.unique));

    console.log('\n--- repair: second dry run (idempotence) ---');
    const secondDryRun = runRepair([]);
    check('a second dry run reports nothing left to fix',
      /duplicate \{userId, type\} groups: 0/.test(secondDryRun)
      && /uniqueness index present: yes/.test(secondDryRun)
      && /0 fix\(es\) would be applied/.test(secondDryRun));

    console.log('\n--- repair: second apply (idempotence) ---');
    const secondApply = runRepair(['--apply']);
    check('a second apply changes nothing', /removed 0 duplicate record\(s\)/.test(secondApply)
      && new RegExp(`${NEW_INDEX} already present`).test(secondApply));
  } catch (error) {
    console.error('\nprobe error:', error?.message || error);
    exitCode = 2;
  } finally {
    await connection.dropDatabase();
    await connection.close();
    console.log(`\ndropped database: ${DB_NAME}`);
  }

  if (failures.length) {
    console.log(`\n${failures.length} FAILED: ${failures.join(' | ')}`);
    process.exit(1);
  }
  if (exitCode !== 0) process.exit(exitCode);
  console.log('\nall assertions held');
})();
