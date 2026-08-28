/**
 * Find accounts that a half-completed registration left behind.
 *
 * Creating an account is two writes — the `users` document, then the `auth`
 * credential — with no transaction between them, because MongoDB here is a
 * standalone node. `createNewUserAccount` compensates when the credential write
 * fails, deleting the user document first so the only state a crash can strand
 * is the harmless one. But compensation is best-effort: a process that dies
 * mid-rollback, or a credential write that succeeded in the database while the
 * caller saw a timeout, still leaves something inconsistent. This is what makes
 * those windows detectable instead of merely unlikely.
 *
 * Two findings, and they are not equally serious:
 *
 *  - **user with no password credential** — the account cannot log in ("invalid
 *    credentials") and cannot be re-registered ("that email is taken"), so the
 *    address is permanently unusable and nothing reports why. This is the state
 *    the whole compensation exists to prevent.
 *
 *  - **credential whose `userId` no longer exists** — harmless in itself. It
 *    holds no email and no username, so it blocks nothing; it is only clutter.
 *
 * ## Deliberately not automatic
 *
 * A user row with no credential can also be a legitimate account an
 * administrator created without a password, which this script cannot tell apart
 * from wreckage. So `--apply` **only ever removes orphan credentials** — the
 * finding that is unambiguous. Users with no credential are reported for a human
 * to decide on, never deleted.
 *
 * Usage:
 *   node scripts/audit-incomplete-accounts.js            # dry run (default)
 *   node scripts/audit-incomplete-accounts.js --apply    # remove orphan credentials only
 *
 * Exit code 0 = nothing needs a human. Non-zero = findings the output names.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';

/** Accounts anonymised by the soft-delete path are not registration wreckage. */
const DELETED_STATUS = 'deleted';

(async () => {
  const connection = await mongoose.createConnection(URI).asPromise();
  let exitCode = 0;

  try {
    const users = connection.db.collection('users');
    const auth = connection.db.collection('auth');

    // ---------------------------------------------- users with no credential
    const credentialOwners = await auth.distinct('userId', { type: 'password' });
    const owners = new Set(credentialOwners.map((id) => String(id)));

    const allUsers = await users
      .find({}, { projection: { username: 1, email: 1, status: 1, createdAt: 1 } })
      .toArray();

    const withoutCredential = allUsers.filter(
      (user) => user.status !== DELETED_STATUS && !owners.has(String(user._id))
    );

    // ------------------------------------------ credentials with no user row
    const userIds = new Set(allUsers.map((user) => String(user._id)));
    const allCredentials = await auth
      .find({ type: 'password' }, { projection: { userId: 1, createdAt: 1 } })
      .toArray();

    const orphanCredentials = allCredentials.filter(
      (credential) => !userIds.has(String(credential.userId))
    );

    console.log(`users: ${allUsers.length} | password credentials: ${allCredentials.length}`);
    console.log(`users with no password credential: ${withoutCredential.length}`);
    withoutCredential.forEach((user) => {
      console.log(`   ${user._id} ${user.username || '<no username>'} <${user.email || 'no email'}> status=${user.status}`);
    });
    console.log(`orphan credentials (userId no longer exists): ${orphanCredentials.length}`);
    orphanCredentials.forEach((credential) => {
      console.log(`   ${credential._id} -> userId ${credential.userId}`);
    });

    // No early `return` from here on. A `return` inside `try` runs `finally` and
    // then leaves the function — skipping the `process.exit(exitCode)` below, so
    // the script would report findings and still exit 0.
    if (!withoutCredential.length && !orphanCredentials.length) {
      console.log('\nno incomplete accounts found');
    } else if (!APPLY) {
      console.log(`\ndry run complete — ${orphanCredentials.length} orphan credential(s) would be removed.`);
      if (withoutCredential.length) {
        console.log(`${withoutCredential.length} user(s) have no credential. These are NOT removed automatically: `
          + 'an administrator may have created a passwordless account on purpose. Decide per account — '
          + 'set a password with PUT /admin/auth/user/password, or delete the account.');
      }
      exitCode = 1;
    } else {
      if (orphanCredentials.length) {
        const ids = orphanCredentials.map((credential) => credential._id);
        const result = await auth.deleteMany({ _id: { $in: ids } });
        console.log(`\nremoved ${result.deletedCount} orphan credential(s)`);

        // Read back rather than trusting the count.
        const remaining = await auth.countDocuments({ _id: { $in: ids } });
        if (remaining) {
          console.error(`VERIFY FAILED: ${remaining} orphan credential(s) still present`);
          exitCode = 1;
        }
      }

      if (!exitCode && withoutCredential.length) {
        console.error(`\n${withoutCredential.length} user(s) still have no credential and were left alone on purpose. `
          + 'Each one is either registration wreckage or a deliberate passwordless account; this script cannot tell '
          + 'them apart, and deleting an account to tidy up would be worse than leaving it.');
        exitCode = 1;
      }

      if (!exitCode) console.log('\nverified: no orphan credentials remain');
    }
  } catch (error) {
    console.error('\naudit aborted:', error.message);
    exitCode = 1;
  } finally {
    await connection.close();
  }

  if (exitCode) process.exit(exitCode);
})();
