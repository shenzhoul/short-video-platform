/**
 * This script will reset superadmin user if found
 * or create new superadmin user if not found
 * The superadmin account has username 'superadmin' and cannot be modified by regular admins
 */
const crypto = require('crypto');
const {
  DB, COLLECTION, generateSalt, encryptPassword
} = require('../migrations/lib');

/**
 * The development-only fallback.
 *
 * This value is committed to a public repository, so it is a password in name
 * only. It stays because local development and the test suite depend on a
 * known superadmin login, and it is safe there and nowhere else.
 */
const DEVELOPMENT_FALLBACK_PASSWORD = 'adminadmin';

/**
 * The superadmin password, hashed the way the client hashes it (SHA256).
 *
 * In production it comes from SUPERADMIN_PASSWORD and from nothing else. If it
 * is missing this THROWS rather than falling back, because the fallback is a
 * literal in a public repo: silently using it would put a publicly-known
 * password on a publicly-reachable admin panel, and nothing about the migration
 * output would say so.
 *
 * Resolved by the caller before any database write, so a missing password stops
 * the migration instead of leaving a half-created superadmin behind.
 */
function resolveSuperadminPasswordHash() {
  const fromEnv = (process.env.SUPERADMIN_PASSWORD || '').trim();

  if (process.env.NODE_ENV === 'production' && !fromEnv) {
    throw new Error(
      'SUPERADMIN_PASSWORD is required when NODE_ENV=production. '
      + 'Refusing to fall back to the development default, which is committed to this repository. '
      + 'Set it in deploy/.env and re-run the migration.'
    );
  }

  const plain = fromEnv || DEVELOPMENT_FALLBACK_PASSWORD;
  return {
    hash: crypto.createHash('sha256').update(plain).digest('hex'),
    source: fromEnv ? 'SUPERADMIN_PASSWORD' : 'development default'
  };
}

exports.createAuth = async (newUser, userId, type = 'email', passwordHash = resolveSuperadminPasswordHash().hash) => {
  const salt = generateSalt();
  const authCheck = await DB.collection(COLLECTION.AUTH).findOne({
    type: 'password',
    userId
  });
  if (!authCheck) {
    await DB.collection(COLLECTION.AUTH).insertOne({
      type: 'password',
      userId,
      salt,
      value: encryptPassword(passwordHash, salt),
      key: type === 'email' ? newUser.email : newUser.username
    });
  } else {
    await DB.collection(COLLECTION.AUTH).updateOne({
      type: 'password',
      userId
    }, {
      $set: {
        type: 'password',
        salt,
        value: encryptPassword(passwordHash, salt),
        key: type === 'email' ? newUser.email : newUser.username
      }
    });
  }
};

module.exports = async () => {
  // Resolved BEFORE any write. In production a missing SUPERADMIN_PASSWORD must
  // stop the migration outright, not create the account and fail afterwards.
  const { hash: passwordHash, source } = resolveSuperadminPasswordHash();

  // Look for existing superadmin account
  const superadminUser = await DB.collection(COLLECTION.USER).findOne({
    username: 'superadmin'
  });

  if (superadminUser) {
    console.log('Superadmin account found; resetting its password.');
    await this.createAuth(superadminUser, superadminUser._id, 'email', passwordHash);
    await DB.collection(COLLECTION.USER).updateOne({ _id: superadminUser._id }, {
      $set: {
        isAdmin: true,
        verifiedEmail: true
      }
    });
  } else {
    // Create new superadmin account
    await DB.collection(COLLECTION.USER).insertOne({
      firstName: 'Super',
      lastName: 'Admin',
      email: `superadmin@${process.env.DOMAIN || 'example.com'}`,
      username: 'superadmin',
      isAdmin: true,
      status: 'active',
      verifiedEmail: true,
      createdAt: new Date(),
      updatedAt: new Date()
    });

    const createdSuperadmin = await DB.collection(COLLECTION.USER).findOne({
      username: 'superadmin'
    });
    await this.createAuth(createdSuperadmin, createdSuperadmin._id, 'email', passwordHash);
    console.log('Superadmin account created.');
  }
  // Never the password, and never the hash. This runs inside a container whose
  // stdout is captured to disk by the Docker logging driver, so anything
  // printed here outlives the migration in a log file.
  console.log(`Superadmin password configured from the ${source}.`);
};
