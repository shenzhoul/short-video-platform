/**
 * Prove the two maintenance scripts on a real MongoDB: the incomplete-account
 * audit, and the `auth_tokens` TTL index repair.
 *
 * Both are dry-run by default and both are supposed to be idempotent, which is
 * exactly the kind of claim that is easy to make and easy to get wrong. This
 * runs each one through **dry-run → apply → re-run** against a disposable
 * database seeded with the states they are meant to find, and reads the result
 * back from MongoDB rather than trusting the script's own output.
 *
 * Development data is never touched: everything happens in a database created
 * for this run and dropped in `finally`.
 *
 * Usage:
 *   yarn build && node scripts/verify-account-repair.js
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

const { AuthTokenSchema } = require('../dist/schemas/identity/auth/auth-token.schema');

const BASE_URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';
const DB_NAME = `douyin_clone_repair_${Date.now()}`;

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

/** Run a maintenance script against the disposable database. */
function run(script, args = []) {
  try {
    return {
      code: 0,
      out: execFileSync(process.execPath, [path.join(__dirname, script), ...args], {
        env: { ...process.env, MONGO_URI: disposableUri() },
        encoding: 'utf8'
      })
    };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

(async () => {
  console.log(`disposable database: ${DB_NAME}`);
  const connection = await mongoose.createConnection(disposableUri()).asPromise();
  let exitCode = 0;

  try {
    const users = connection.db.collection('users');
    const auth = connection.db.collection('auth');

    // ------------------------------------------------------------- seed
    const healthy = new mongoose.Types.ObjectId();
    const strandedUser = new mongoose.Types.ObjectId();
    const vanishedUser = new mongoose.Types.ObjectId();

    await users.insertMany([
      {
        _id: healthy, username: 'healthy', email: 'healthy@example.com', status: 'active'
      },
      // The bad state compensation exists to prevent: registered, unusable.
      {
        _id: strandedUser, username: 'stranded', email: 'stranded@example.com', status: 'active'
      }
    ]);
    await auth.insertMany([
      { userId: healthy, type: 'password', value: 'scrypt$…' },
      // The harmless leftover: a credential whose user is gone. It holds no
      // email and no username, so it blocks nothing.
      { userId: vanishedUser, type: 'password', value: 'scrypt$…' }
    ]);

    // ------------------------------------------- audit: dry run finds both
    const dry = run('audit-incomplete-accounts.js');
    check('the audit reports the user with no credential', /stranded@example\.com/.test(dry.out));
    check('the audit reports the orphan credential', /orphan credentials \(userId no longer exists\): 1/.test(dry.out));
    check('the audit exits non-zero when it finds something', dry.code !== 0, `exit ${dry.code}`);
    check(
      'the dry run changes nothing',
      (await auth.countDocuments({})) === 2 && (await users.countDocuments({})) === 2
    );

    // ------------------------------------------------------ audit: apply
    const applied = run('audit-incomplete-accounts.js', ['--apply']);
    check('applying removes the orphan credential', (await auth.countDocuments({ userId: vanishedUser })) === 0);
    check('applying keeps the healthy credential', (await auth.countDocuments({ userId: healthy })) === 1);
    // A user row with no credential is indistinguishable from an account an
    // administrator created without a password, so the script refuses to guess.
    check('applying does NOT delete the user with no credential', (await users.countDocuments({ _id: strandedUser })) === 1);
    check('...and says so, with a non-zero exit', applied.code !== 0 && /left alone on purpose/.test(applied.out));

    // Remove the ambiguous row by hand, as a human would, then re-run.
    await users.deleteOne({ _id: strandedUser });
    const rerun = run('audit-incomplete-accounts.js', ['--apply']);
    check('a re-run on a clean database is a no-op and exits 0',
      rerun.code === 0 && /no incomplete accounts found/.test(rerun.out), `exit ${rerun.code}`);

    // ------------------------------------------- TTL repair: wrong options
    const AuthTokenModel = connection.model('AuthToken', AuthTokenSchema);
    await AuthTokenModel.syncIndexes();
    const tokens = AuthTokenModel.collection;

    // Put the collection into the state an already-migrated database is in.
    await tokens.dropIndex('idx_auth_token_expiry_cleanup');
    await tokens.createIndex({ expiresAt: 1 }, {
      name: 'idx_auth_token_expiry_cleanup',
      expireAfterSeconds: 7 * 24 * 60 * 60
    });

    const ttlDry = run('repair-auth-token-ttl-index.js');
    check('the TTL repair notices the wrong expiry', /expected 0/.test(ttlDry.out));
    const stillWrong = (await tokens.indexes()).find((i) => i.name === 'idx_auth_token_expiry_cleanup');
    check('the TTL dry run changes nothing', stillWrong.expireAfterSeconds === 604800);

    const ttlApply = run('repair-auth-token-ttl-index.js', ['--apply']);
    const repaired = (await tokens.indexes()).find((i) => i.name === 'idx_auth_token_expiry_cleanup');
    check('applying sets expireAfterSeconds to 0',
      repaired.expireAfterSeconds === 0, String(repaired.expireAfterSeconds));
    check('applying keeps the key it had', JSON.stringify(repaired.key) === JSON.stringify({ expiresAt: 1 }));
    check('the TTL repair exits 0 on success', ttlApply.code === 0, `exit ${ttlApply.code}`);

    const names = (await tokens.indexes()).map((i) => i.name);
    check('the other two indexes are untouched',
      names.includes('idx_auth_token_hash_unique') && names.includes('idx_auth_token_user_type_status'),
      names.join(', '));

    const ttlRerun = run('repair-auth-token-ttl-index.js', ['--apply']);
    check('a second apply is a no-op',
      ttlRerun.code === 0 && /already \{ expiresAt: 1 \} with expireAfterSeconds=0/.test(ttlRerun.out));
  } catch (error) {
    console.error('\nverification aborted:', error);
    exitCode = 1;
  } finally {
    await connection.dropDatabase();
    await connection.close();
    console.log(`dropped ${DB_NAME}`);
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  if (exitCode) process.exit(exitCode);
  console.log('\nall checks passed');
})();
