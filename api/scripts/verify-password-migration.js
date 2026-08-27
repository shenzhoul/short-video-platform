/**
 * End-to-end proof that a pre-migration account keeps working and quietly moves
 * to scrypt — against a real MongoDB, with a credential written by the actual
 * legacy algorithm.
 *
 * This is the scenario nothing else can cover: the unit suite mocks the model,
 * so it can show the *intent* to upgrade but not that the write lands, survives a
 * re-read, and leaves exactly one row behind.
 *
 * Everything runs in a database created for this run and dropped in `finally`.
 * Development data is never touched.
 *
 * Usage:
 *   yarn build && node scripts/verify-password-migration.js
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');

const { UserSchema } = require('../dist/schemas/identity/user/user.schema');
const { AuthSchema } = require('../dist/schemas/identity/auth/auth.schema');
const { AuthService } = require('../dist/services/identity/auth/auth.service');
const { PasswordHasherService } = require('../dist/services/identity/auth/password-hasher.service');
const { PasswordIncorrectException } = require('../dist/common/exceptions/auth/password-incorrect.exception');

const BASE_URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';
const DB_NAME = `douyin_clone_pwmigrate_${Date.now()}`;
const PASSWORD = 'legacy-account-password';

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

/** The pre-migration scheme, reproduced exactly as it was written. */
function legacyHash(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex');
}

const request = { headers: { 'user-agent': 'verify-password-migration' } };

(async () => {
  console.log(`disposable database: ${DB_NAME}`);
  const connection = await mongoose.createConnection(disposableUri()).asPromise();
  let exitCode = 0;

  try {
    const UserModel = connection.model('User', UserSchema);
    const AuthModel = connection.model('Auth', AuthSchema);
    await UserModel.syncIndexes();
    await AuthModel.syncIndexes();

    // --- a disposable account whose credential is genuinely legacy ------------
    const user = await UserModel.create({
      email: 'legacy.qa@example.com',
      username: 'legacyqa',
      name: 'Legacy QA',
      status: 'active',
      isAdmin: false
    });

    const salt = crypto.randomBytes(16).toString('base64');
    await AuthModel.create({
      userId: user._id,
      type: 'password',
      key: 'legacy.qa@example.com',
      salt,
      value: legacyHash(PASSWORD, salt)
    });

    const stored = () => AuthModel.collection.findOne({ userId: user._id, type: 'password' });

    const before = await stored();
    check('the account starts on the legacy scheme',
      !!before.salt && /^[0-9a-f]{64}$/.test(before.value),
      `salt=${!!before.salt} value=${String(before.value).slice(0, 12)}…`);

    // --- the real login path --------------------------------------------------
    const hasher = new PasswordHasherService();
    const baseUserService = {
      findByUsernameOrEmail: async () => {
        const found = await UserModel.findById(user._id).lean();
        return { ...found, toResponse: () => ({ _id: found._id }) };
      }
    };
    const tokenService = { generateToken: async () => 'token-for-probe' };
    const service = new AuthService(AuthModel, baseUserService, tokenService, {}, hasher);

    // 1. login succeeds on the legacy credential
    const first = await service.login({ username: 'legacyqa', password: PASSWORD }, request);
    check('a legacy account still logs in', first?.token === 'token-for-probe');

    // 2. the stored credential is now scrypt
    const afterLogin = await stored();
    check('the credential was rewritten as scrypt',
      typeof afterLogin.value === 'string' && afterLogin.value.startsWith('scrypt$v=1$'),
      String(afterLogin.value).slice(0, 24));
    check('the legacy salt column was removed', afterLogin.salt === undefined);
    check('the stored value never contains the plaintext',
      !String(afterLogin.value).includes(PASSWORD));

    // 3. a second login succeeds, now through the scrypt path, and rewrites nothing
    const second = await service.login({ username: 'legacyqa', password: PASSWORD }, request);
    check('a second login succeeds on the new scheme', second?.token === 'token-for-probe');

    const afterSecond = await stored();
    check('the second login did not rewrite the credential again',
      afterSecond.value === afterLogin.value);

    // 4. a wrong password is still a normalised failure
    let wrongPasswordError = null;
    try {
      await service.login({ username: 'legacyqa', password: 'not-the-password' }, request);
    } catch (error) {
      wrongPasswordError = error;
    }
    check('a wrong password is refused with the normalised error',
      wrongPasswordError instanceof PasswordIncorrectException,
      wrongPasswordError?.constructor?.name);
    check('a failed attempt did not change the credential',
      (await stored()).value === afterLogin.value);

    // 5. exactly one credential row throughout
    const rows = await AuthModel.collection.find({ userId: user._id }).toArray();
    check('exactly one auth record exists for the account', rows.length === 1, `count=${rows.length}`);

    const allRows = await AuthModel.collection.countDocuments();
    check('no stray auth records were created anywhere', allRows === 1, `count=${allRows}`);

    // 6. and the uniqueness constraint really is in place
    const indexes = await AuthModel.collection.listIndexes().toArray();
    console.log('\n--- indexes on `auth` ---');
    indexes.forEach((i) => console.log(`  ${i.name} ${JSON.stringify(i.key)}${i.unique ? ' UNIQUE' : ''}`));
    check('the credential uniqueness index is present',
      indexes.some((i) => i.name === 'idx_userId_type_unique_credential' && i.unique));

    // --- cleanup of the account itself, before the database goes -------------
    await AuthModel.deleteMany({ userId: user._id });
    await UserModel.deleteOne({ _id: user._id });
    check('the disposable account and its credential were removed',
      (await UserModel.countDocuments()) === 0 && (await AuthModel.countDocuments()) === 0);
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
