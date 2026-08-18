/**
 * This script will reset superadmin user if found
 * or create new superadmin user if not found
 * The superadmin account has username 'superadmin' and cannot be modified by regular admins
 */
const crypto = require('crypto');
const {
  DB, COLLECTION, generateSalt, encryptPassword
} = require('../migrations/lib');

// Hash the default password using SHA256 (client-side compatible)
const defaultPlainPassword = 'adminadmin';
const defaultPassword = crypto.createHash('sha256').update(defaultPlainPassword).digest('hex');

exports.createAuth = async (newUser, userId, type = 'email') => {
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
      value: encryptPassword(defaultPassword, salt),
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
        value: encryptPassword(defaultPassword, salt),
        key: type === 'email' ? newUser.email : newUser.username
      }
    });
  }
};

module.exports = async () => {
  // Look for existing superadmin account
  const superadminUser = await DB.collection(COLLECTION.USER).findOne({
    username: 'superadmin'
  });

  if (superadminUser) {
    console.log(`Updating password for superadmin: ${superadminUser.username} - email: ${superadminUser.email}`);
    await this.createAuth(superadminUser, superadminUser._id, 'email');
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
    await this.createAuth(createdSuperadmin, createdSuperadmin._id, 'email');
    console.log(`Creating superadmin account - username: ${createdSuperadmin.username} - email: ${createdSuperadmin.email}`);
  }
  console.log(`Superadmin password is: ${defaultPlainPassword} (hashed: ${defaultPassword})`);
};
