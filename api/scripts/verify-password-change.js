/**
 * Prove that changing a password actually changes the credential — against a
 * real MongoDB with the real unique index.
 *
 * The previous report claimed password change worked because every path went
 * through `createAuthPassword` and only one row ever existed. Neither fact
 * proves it: an upsert whose update is `$setOnInsert` reports success while
 * leaving the old password in place, and one whose update is `$set` silently
 * overwrites a concurrent caller's password and tells both of them it worked.
 * Only observing the login outcome afterwards settles it.
 *
 * Disposable database, dropped in `finally`. Development data is never touched.
 *
 * Usage:
 *   yarn build && node scripts/verify-password-change.js
 */
require('dotenv').config();
const crypto = require('crypto');
const mongoose = require('mongoose');

const { UserSchema } = require('../dist/schemas/identity/user/user.schema');
const { AuthSchema } = require('../dist/schemas/identity/auth/auth.schema');
const { AuthService } = require('../dist/services/identity/auth/auth.service');
const { PasswordHasherService } = require('../dist/services/identity/auth/password-hasher.service');
const { PasswordIncorrectException } = require('../dist/common/exceptions/auth/password-incorrect.exception');
const {
  CredentialAlreadyExistsException,
  CredentialNotFoundException
} = require('../dist/common/exceptions/auth/credential-conflict.exception');

const BASE_URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';
const DB_NAME = `douyin_clone_pwchange_${Date.now()}`;

/** The API receives a client-side SHA256 digest; that is what "plaintext" means here. */
const digest = (password) => crypto.createHash('sha256').update(password).digest('hex');
const PASSWORD_A = digest('password-A');
const PASSWORD_B = digest('password-B');
const PASSWORD_C = digest('password-C');

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

const request = { headers: { 'user-agent': 'verify-password-change' } };

(async () => {
  console.log(`disposable database: ${DB_NAME}`);
  const connection = await mongoose.createConnection(disposableUri()).asPromise();
  let exitCode = 0;

  try {
    const UserModel = connection.model('User', UserSchema);
    const AuthModel = connection.model('Auth', AuthSchema);
    await UserModel.syncIndexes();
    await AuthModel.syncIndexes();

    const hasher = new PasswordHasherService();
    let currentUser = null;
    const baseUserService = {
      findById: async () => currentUser,
      findByUsernameOrEmail: async () => (currentUser
        ? { ...currentUser, toResponse: () => ({ _id: currentUser._id }) }
        : null)
    };
    const tokenService = { generateToken: async () => 'token' };
    const service = new AuthService(AuthModel, baseUserService, tokenService, {}, hasher);

    const rows = (userId) => AuthModel.collection.find({ userId }).toArray();
    const canLogin = async (password) => {
      try {
        await service.login({ username: 'someone', password }, request);
        return true;
      } catch (error) {
        if (error instanceof PasswordIncorrectException) return false;
        throw error;
      }
    };

    async function freshAccount(username) {
      const user = await UserModel.create({
        email: `${username}@example.com`, username, name: username, status: 'active', isAdmin: false
      });
      currentUser = {
        _id: user._id, email: user.email, username, status: 'active'
      };
      return user;
    }

    // ================= self password change =================
    console.log('\n--- self password change ---');
    const selfUser = await freshAccount('selfchange');
    await service.createAuthPassword({
      userId: selfUser._id, type: 'password', key: selfUser.email, value: PASSWORD_A
    });

    check('1. login with password A succeeds', await canLogin(PASSWORD_A));

    await service.setAuthPassword({
      userId: selfUser._id, type: 'password', key: selfUser.email, value: PASSWORD_B
    });

    check('2. password A now FAILS', (await canLogin(PASSWORD_A)) === false);
    check('3. password B succeeds', await canLogin(PASSWORD_B));

    let selfRows = await rows(selfUser._id);
    check('4. exactly one auth row remains', selfRows.length === 1, `count=${selfRows.length}`);
    check('5. the credential is scrypt', String(selfRows[0].value).startsWith('scrypt$v=1$'));
    check('6. no legacy salt column', selfRows[0].salt === undefined);

    // The DTO is what a controller returns; it must carry no credential material.
    const dto = await service.setAuthPassword({
      userId: selfUser._id, type: 'password', key: selfUser.email, value: PASSWORD_B
    });
    const serialised = JSON.stringify(dto);
    check('7. the returned DTO leaks no hash, salt or plaintext',
      !serialised.includes('scrypt$') && !/"salt"/.test(serialised) && !serialised.includes(PASSWORD_B),
      serialised.slice(0, 120));

    // ================= admin password change =================
    console.log('\n--- admin password change ---');
    const adminTarget = await freshAccount('adminchange');
    await UserModel.updateOne({ _id: adminTarget._id }, { $set: { status: 'under-review' } });
    currentUser.status = 'under-review';
    await service.createAuthPassword({
      userId: adminTarget._id, type: 'password', key: adminTarget.email, value: PASSWORD_A
    });

    // `updateAuthPassword` is the admin route's entry point.
    await service.updateAuthPassword({
      userId: adminTarget._id, type: 'password', value: PASSWORD_B
    });

    check('8. admin change: password A FAILS', (await canLogin(PASSWORD_A)) === false);
    // The account is under-review, which still permits login (only `inactive` does not).
    check('9. admin change: password B succeeds', await canLogin(PASSWORD_B));

    const adminRows = await rows(adminTarget._id);
    check('10. exactly one auth row remains', adminRows.length === 1, `count=${adminRows.length}`);

    const untouched = await UserModel.collection.findOne({ _id: adminTarget._id });
    check('11. the account profile is otherwise untouched',
      untouched.status === 'under-review' && untouched.isAdmin === false && untouched.username === 'adminchange',
      `status=${untouched.status} isAdmin=${untouched.isAdmin}`);

    // ================= create semantics =================
    console.log('\n--- create must not overwrite ---');
    const createUser = await freshAccount('createsemantics');
    await service.createAuthPassword({
      userId: createUser._id, type: 'password', key: createUser.email, value: PASSWORD_A
    });

    let conflict = null;
    try {
      await service.createAuthPassword({
        userId: createUser._id, type: 'password', key: createUser.email, value: PASSWORD_B
      });
    } catch (error) {
      conflict = error;
    }
    check('12. creating over an existing DIFFERENT password is a typed 409',
      conflict instanceof CredentialAlreadyExistsException && conflict.getStatus() === 409,
      conflict?.constructor?.name);
    check('13. the original password still works', await canLogin(PASSWORD_A));
    check('14. the rejected password does NOT work', (await canLogin(PASSWORD_B)) === false);

    const idempotent = await service.createAuthPassword({
      userId: createUser._id, type: 'password', key: createUser.email, value: PASSWORD_A
    });
    check('15. creating with the SAME password is idempotent, not a conflict', !!idempotent);
    check('16. still exactly one row', (await rows(createUser._id)).length === 1);

    // ================= replace semantics =================
    console.log('\n--- replace must not create ---');
    const noCredentialUser = await freshAccount('nocredential');
    let notFound = null;
    try {
      await service.replaceAuthPassword({
        userId: noCredentialUser._id, type: 'password', key: noCredentialUser.email, value: PASSWORD_A
      });
    } catch (error) {
      notFound = error;
    }
    check('17. replacing a credential that does not exist is a typed 404',
      notFound instanceof CredentialNotFoundException && notFound.getStatus() === 404,
      notFound?.constructor?.name);
    check('18. and it created nothing', (await rows(noCredentialUser._id)).length === 0);

    // ================= concurrent creates, DIFFERENT plaintexts =================
    console.log('\n--- concurrent creates, different passwords ---');
    const raceUser = await freshAccount('raceduser');
    const raceResults = await Promise.allSettled([
      service.createAuthPassword({
        userId: raceUser._id, type: 'password', key: raceUser.email, value: PASSWORD_A
      }),
      service.createAuthPassword({
        userId: raceUser._id, type: 'password', key: raceUser.email, value: PASSWORD_B
      })
    ]);
    raceResults.forEach((r, i) => console.log(`  call ${i + 1}: ${r.status}${r.status === 'rejected' ? ` (${r.reason?.constructor?.name})` : ''}`));

    const fulfilled = raceResults.filter((r) => r.status === 'fulfilled');
    const rejected = raceResults.filter((r) => r.status === 'rejected');

    check('19. exactly one create succeeded', fulfilled.length === 1,
      `fulfilled=${fulfilled.length} rejected=${rejected.length}`);
    check('20. the loser got a typed 409, not a false success',
      rejected.length === 1 && rejected[0].reason instanceof CredentialAlreadyExistsException,
      rejected[0]?.reason?.constructor?.name);
    check('21. no raw E11000 escaped', !rejected.some((r) => r.reason?.code === 11000));
    check('22. exactly one auth row', (await rows(raceUser._id)).length === 1);

    // Which password won is observable, and the winner is the one that logs in.
    const aWorks = await canLogin(PASSWORD_A);
    const bWorks = await canLogin(PASSWORD_B);
    check('23. exactly one of the two passwords is the effective credential',
      aWorks !== bWorks, `A=${aWorks} B=${bWorks}`);
    console.log(`  winner: ${aWorks ? 'password A' : 'password B'}`);

    // ================= concurrent creates, SAME plaintext =================
    console.log('\n--- concurrent creates, same password ---');
    const sameUser = await freshAccount('samepassword');
    const sameResults = await Promise.allSettled([
      service.createAuthPassword({
        userId: sameUser._id, type: 'password', key: sameUser.email, value: PASSWORD_C
      }),
      service.createAuthPassword({
        userId: sameUser._id, type: 'password', key: sameUser.email, value: PASSWORD_C
      })
    ]);
    check('24. both calls succeed — the same effective credential is idempotent',
      sameResults.every((r) => r.status === 'fulfilled'),
      sameResults.map((r) => r.status).join(', '));
    check('25. exactly one auth row', (await rows(sameUser._id)).length === 1);
    check('26. that password logs in', await canLogin(PASSWORD_C));

    // ================= concurrent replaces =================
    console.log('\n--- concurrent password changes ---');
    const changeUser = await freshAccount('concurrentchange');
    await service.createAuthPassword({
      userId: changeUser._id, type: 'password', key: changeUser.email, value: PASSWORD_A
    });

    const changeResults = await Promise.allSettled([
      service.replaceAuthPassword({
        userId: changeUser._id, type: 'password', key: changeUser.email, value: PASSWORD_B
      }),
      service.replaceAuthPassword({
        userId: changeUser._id, type: 'password', key: changeUser.email, value: PASSWORD_C
      })
    ]);
    changeResults.forEach((r, i) => console.log(`  call ${i + 1}: ${r.status}`));

    check('27. no duplicate row was created', (await rows(changeUser._id)).length === 1);
    check('28. no raw Mongo error escaped',
      !changeResults.some((r) => r.reason?.code === 11000 || /E11000/.test(String(r.reason?.message || ''))));
    check('29. the old password no longer works', (await canLogin(PASSWORD_A)) === false);

    // Last write wins, and the outcome is observable: exactly one of the two new
    // passwords is the effective credential, and it is the one the surviving row
    // holds.
    const bWins = await canLogin(PASSWORD_B);
    const cWins = await canLogin(PASSWORD_C);
    check('30. exactly one of the two new passwords is effective (last write wins, observable)',
      bWins !== cWins, `B=${bWins} C=${cWins}`);
    console.log(`  winner: ${bWins ? 'password B' : 'password C'}`);

    const finalRow = (await rows(changeUser._id))[0];
    const winnerMatches = await hasher.verify(bWins ? PASSWORD_B : PASSWORD_C, finalRow);
    check('31. the stored row is exactly the winning password', winnerMatches.valid);

    // ================= cleanup =================
    await AuthModel.deleteMany({});
    await UserModel.deleteMany({});
    check('32. all probe accounts and credentials removed',
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
