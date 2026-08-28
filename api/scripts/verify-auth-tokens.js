/**
 * Prove the verification / reset token contract against a real MongoDB.
 *
 * Kept out of `testRegex` for the same reason as
 * `verify-registration-concurrency.js` and `verify-auth-credential-uniqueness.js`:
 * `yarn test` must run without a database, and a fake `findOneAndUpdate` proves
 * only that the service calls it correctly — not that the *database* serialises
 * concurrent claims, which is the property the whole single-use guarantee rests
 * on.
 *
 * What it establishes, none of which a unit test can:
 *  - the declared indexes exist with the declared options, read back from Mongo;
 *  - the raw token appears in no stored field;
 *  - N genuinely concurrent claims of one token produce exactly one winner;
 *  - an expired row is refused by the claim even while the TTL monitor has not
 *    collected it — the case where "expiry" and "cleanup" visibly differ;
 *  - a released claim becomes usable again, and a superseded one does not;
 *  - the full password-reset sequence leaves one scrypt credential with no
 *    legacy salt, the old password refused and the new one accepted.
 *
 * Everything runs in a database created for this run and dropped in `finally`;
 * development data is never touched, and no email is ever sent.
 *
 * Usage:
 *   yarn build && node scripts/verify-auth-tokens.js
 */
require('dotenv').config();
const mongoose = require('mongoose');

const { AuthSchema } = require('../dist/schemas/identity/auth/auth.schema');
const {
  AuthTokenSchema, AUTH_TOKEN_TYPE, AUTH_TOKEN_STATUS
} = require('../dist/schemas/identity/auth/auth-token.schema');
const { AuthTokenService } = require('../dist/services/identity/auth/auth-token.service');
const { AuthService } = require('../dist/services/identity/auth/auth.service');
const { PasswordHasherService } = require('../dist/services/identity/auth/password-hasher.service');
const { PasswordRecoveryService } = require('../dist/services/identity/auth/password-recovery.service');
const { ResetTokenInvalidException } = require('../dist/common/exceptions/auth/auth-token-invalid.exception');

const BASE_URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';
const DB_NAME = `douyin_clone_authtokens_${Date.now()}`;

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

(async () => {
  console.log(`disposable database: ${DB_NAME}`);
  const connection = await mongoose.createConnection(disposableUri()).asPromise();
  let exitCode = 0;

  try {
    const AuthTokenModel = connection.model('AuthToken', AuthTokenSchema);
    const AuthModel = connection.model('Auth', AuthSchema);
    await AuthTokenModel.syncIndexes();
    await AuthModel.syncIndexes();

    const tokens = new AuthTokenService(AuthTokenModel);
    const userId = new mongoose.Types.ObjectId();

    // ---------------------------------------------------------------- indexes
    const indexes = await AuthTokenModel.collection.indexes();
    const byName = Object.fromEntries(indexes.map((i) => [i.name, i]));

    check(
      'the token-hash index exists and is unique',
      !!byName.idx_auth_token_hash_unique && byName.idx_auth_token_hash_unique.unique === true,
      JSON.stringify(byName.idx_auth_token_hash_unique)
    );
    check(
      'the per-user management index exists with the declared key',
      JSON.stringify(byName.idx_auth_token_user_type_status?.key)
        === JSON.stringify({
          userId: 1, type: 1, status: 1, createdAt: -1
        }),
      JSON.stringify(byName.idx_auth_token_user_type_status?.key)
    );
    // `expiresAt` is an absolute instant, so 0 means "delete once it has
    // passed". 604800 would have meant "delete a week *after* the token
    // expired", retaining spent tokens nobody asked to keep.
    check(
      'the TTL index expires on the instant, not a week later',
      byName.idx_auth_token_expiry_cleanup?.expireAfterSeconds === 0,
      String(byName.idx_auth_token_expiry_cleanup?.expireAfterSeconds)
    );

    // ------------------------------------------------------------- token shape
    const issued = await tokens.issue({
      userId,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      email: 'Visitor@Example.com',
      ttlMinutes: 60
    });

    const stored = await AuthTokenModel.collection.findOne({ _id: issued.tokenId });
    const rawAppears = Object.values(stored).some((value) => String(value).includes(issued.rawToken));
    check('the raw token appears in no stored field', !rawAppears);
    check('the address is stored normalised', stored.email === 'visitor@example.com', stored.email);
    check('the token starts active', stored.status === AUTH_TOKEN_STATUS.ACTIVE, stored.status);
    check('the token is 43 url-safe characters', /^[A-Za-z0-9_-]{43}$/.test(issued.rawToken), issued.rawToken.length + ' chars');

    // A hash-only search must find nothing usable: this is what a database read
    // buys an attacker.
    const byRaw = await AuthTokenModel.collection.findOne({ tokenHash: issued.rawToken });
    check('the raw token cannot be looked up as a hash', byRaw === null);

    // ------------------------------------------------------- concurrent claims
    const CLAIMS = 25;
    const raced = await Promise.all(
      Array.from({ length: CLAIMS }, () => tokens.claim(issued.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION))
    );
    const winners = raced.filter(Boolean);
    check(
      `exactly one of ${CLAIMS} concurrent claims wins`,
      winners.length === 1,
      `${winners.length} winners`
    );
    check(
      'the losing claims are indistinguishable from an unknown token',
      raced.filter((r) => r === null).length === CLAIMS - 1
    );

    // -------------------------------------------------------------- expiration
    const expiring = await tokens.issue({
      userId,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      email: 'visitor@example.com',
      ttlMinutes: 60
    });
    // Backdate the row without deleting it. The TTL monitor runs about once a
    // minute and has no ordering guarantee, so this state — expired but present
    // — is real and common. Expiry has to be enforced by the claim itself.
    await AuthTokenModel.collection.updateOne(
      { _id: expiring.tokenId },
      { $set: { expiresAt: new Date(Date.now() - 1000) } }
    );
    const expiredClaim = await tokens.claim(expiring.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    const stillPresent = await AuthTokenModel.collection.countDocuments({ _id: expiring.tokenId });
    check('an expired token is refused', expiredClaim === null);
    // The point of the pair: correctness does not wait for the TTL monitor. The
    // row is still there — MongoDB sweeps about once a minute with no ordering
    // guarantee — and the claim refuses it anyway, because expiry is a predicate
    // inside the same statement that consumes the token.
    check('...while the row is demonstrably still in the collection', stillPresent === 1);

    // ------------------------------------------------------- release / supersede
    const releasable = await tokens.issue({
      userId,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      email: 'visitor@example.com',
      ttlMinutes: 60
    });
    const claimedForRelease = await tokens.claim(releasable.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    await tokens.release(claimedForRelease.tokenId);
    const afterRelease = await tokens.claim(releasable.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    check('a released claim makes the token usable again', afterRelease !== null);

    const siblingA = await tokens.issue({
      userId, type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION, email: 'visitor@example.com', ttlMinutes: 60
    });
    const siblingB = await tokens.issue({
      userId, type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION, email: 'visitor@example.com', ttlMinutes: 60
    });
    // Both live at once, which is the point: overwriting one row would send two
    // emails of which only the newer link worked.
    const claimedA = await tokens.claim(siblingA.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    check('an earlier token still works after a later one is issued', claimedA !== null);
    await tokens.supersedeSiblings({
      userId,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      exceptTokenId: claimedA.tokenId
    });
    check(
      'using one token invalidates the rest',
      (await tokens.claim(siblingB.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)) === null
    );
    check(
      'a superseded token cannot be released back to life',
      await (async () => {
        await tokens.release(siblingB.tokenId);
        return (await tokens.claim(siblingB.rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION)) === null;
      })()
    );

    // ------------------------------------------------- the full password reset
    const hasher = new PasswordHasherService();
    const authService = new AuthService(
      AuthModel,
      { findById: async () => ({ _id: userId, email: 'visitor@example.com' }) },
      {},
      {},
      hasher
    );

    const OLD_PASSWORD = 'a'.repeat(64);
    const NEW_PASSWORD = 'b'.repeat(64);
    await authService.createAuthPassword({ userId, type: 'password', value: OLD_PASSWORD, key: 'visitor@example.com' });

    let revoked = 0;
    const recovery = new PasswordRecoveryService(
      tokens,
      { sendPasswordResetEmail: async () => undefined },
      { consume: async () => true },
      authService,
      { removeAllUserTokens: async () => { revoked += 1; return 2; } },
      {
        findByEmail: async () => ({
          _id: userId, email: 'visitor@example.com', username: 'visitor', status: 'active'
        }),
        findById: async () => ({
          _id: userId, email: 'visitor@example.com', username: 'visitor', status: 'active'
        })
      }
    );

    const resetToken = await tokens.issue({
      userId, type: AUTH_TOKEN_TYPE.PASSWORD_RESET, email: 'visitor@example.com', ttlMinutes: 60
    });

    // Two requests, one token. Exactly one may actually change the password —
    // anything else is a false success.
    const [first, second] = await Promise.allSettled([
      recovery.resetPassword(resetToken.rawToken, NEW_PASSWORD),
      recovery.resetPassword(resetToken.rawToken, 'c'.repeat(64))
    ]);
    const fulfilled = [first, second].filter((r) => r.status === 'fulfilled');
    const rejected = [first, second].filter((r) => r.status === 'rejected');
    check('only one of two resets with the same token succeeds', fulfilled.length === 1);
    check(
      'the loser is told the link is invalid, not that it worked',
      rejected.length === 1 && rejected[0].reason instanceof ResetTokenInvalidException
    );

    const credentials = await AuthModel.collection.find({ userId }).toArray();
    check('exactly one credential row survives', credentials.length === 1, `${credentials.length} rows`);
    check('the stored credential is scrypt', String(credentials[0].value).startsWith('scrypt$'));
    check('the legacy salt column is gone', credentials[0].salt === undefined);
    check('sessions were revoked exactly once', revoked === 1, `${revoked} calls`);

    const oldStillWorks = await hasher.verify(OLD_PASSWORD, credentials[0]);
    const newWorks = await hasher.verify(NEW_PASSWORD, credentials[0]);
    check('the old password no longer verifies', oldStillWorks.valid === false);
    check('the winning new password verifies', newWorks.valid === true);

    check(
      'the spent reset token cannot be replayed',
      (await tokens.claim(resetToken.rawToken, AUTH_TOKEN_TYPE.PASSWORD_RESET)) === null
    );

    // ----------------------------------------------------- cross-type isolation
    const verificationToken = await tokens.issue({
      userId, type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION, email: 'visitor@example.com', ttlMinutes: 60
    });
    check(
      'a verification link cannot be used to reset a password',
      (await tokens.claim(verificationToken.rawToken, AUTH_TOKEN_TYPE.PASSWORD_RESET)) === null
    );
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
