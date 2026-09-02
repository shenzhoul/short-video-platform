/**
 * Creates the demo accounts and puts a real avatar and cover on each.
 *
 * ## The profile-image order is the reverse of the post-media order, on purpose
 *
 * `api/src/services/identity/user/base-user.service.ts` states the rule the
 * whole project follows: *never leave a published row pointing at an
 * unreferenced file*. For a new row (a post) that means write the row, then
 * attach the file. For a pointer on a row that already exists (an avatar) it
 * means the opposite — attach the reference **first**, then swap the pointer,
 * because a profile whose avatar carries no reference is one sweeper pass away
 * from serving a URL whose bytes are gone.
 *
 * This module follows the second form, because a user document is created
 * before its images are.
 *
 * ## Passwords
 *
 * Written in the **current** format, which is scrypt — see
 * `api/src/services/identity/auth/password-hasher.service.ts`. The legacy salted
 * SHA-256 scheme is verify-only ("nothing in the codebase writes this format any
 * more"), and a seeder that wrote it would quietly reintroduce it into every
 * developer's database and make the lazy upgrade path look like it still has
 * live traffic.
 *
 * Two layers, because that is what a real login sends: the browser SHA-256s the
 * plaintext (`user/src/services/auth.service.ts`), and the server scrypt-hashes
 * whatever arrives. So the stored value is `scrypt(sha256(plaintext))`.
 *
 * The parameters are duplicated rather than imported — `PasswordHasherService`
 * is Nest-decorated TypeScript and this is a plain Node script — so
 * `password-format.spec.ts` verifies a credential produced here against the real
 * service. If the two ever drift, that test fails rather than the demo accounts
 * silently becoming unloggable.
 */

const crypto = require('crypto');

const logger = require('./logger');
const { KINDS } = require('./ledger');

const USER_STATUS_ACTIVE = 'active';
/** `FILE_REFERENCE_TYPES.USER` in api/src/common/constants/content.ts. */
const FILE_REF_USER = 'user';

/**
 * Scrypt parameters, mirroring `SCRYPT_PARAMS` in
 * `api/src/services/identity/auth/password-hasher.service.ts`.
 */
const SCRYPT = {
  N: 32768, r: 8, p: 1, keylen: 64, saltBytes: 16, maxmem: 64 * 1024 * 1024
};

/** What the browser sends: the plaintext, SHA-256'd. */
const clientHash = (plainPassword) => crypto.createHash('sha256').update(plainPassword).digest('hex');

/**
 * Produce a stored credential in the current format.
 *
 * `scrypt$v=1$N=32768,r=8,p=1$<salt-base64>$<key-base64>` — self-describing, so
 * the parameters travel with the hash and a later cost increase does not
 * invalidate it. Fresh random salt per call, so sixteen accounts sharing one
 * demo password do not share a stored value.
 */
async function hashPassword(plainPassword) {
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const derived = await new Promise((resolve, reject) => {
    crypto.scrypt(
      clientHash(plainPassword),
      salt,
      SCRYPT.keylen,
      {
        N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem
      },
      (error, key) => (error ? reject(error) : resolve(key))
    );
  });

  return [
    'scrypt$v=1',
    `N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}`,
    salt.toString('base64'),
    derived.toString('base64')
  ].join('$');
}

/**
 * Upload one profile image and attach it to the user, or reuse the one a
 * previous run already attached.
 *
 * @returns `{ fileId, url, coverBgColor }`
 */
async function attachProfileImage({
  account, userId, entry, purpose, ledger, pipeline, mediaDir, path: pathLib
}) {
  const seedKey = `file:${purpose}:${account.username}`;
  const existing = await ledger.find(KINDS.FILE, seedKey);

  if (existing?.refId) {
    // Trust but verify: a file the ledger names may have been deleted from the
    // file server since, in which case this run must produce a new one.
    try {
      const file = await pipeline.getFile(String(existing.refId));
      if (file && file.processingStatus === 'completed' && file.url) {
        return {
          fileId: String(existing.refId), url: file.url, coverBgColor: file.metadata?.coverBgColor, reused: true
        };
      }
    } catch {
      logger.warn(`${purpose} for ${account.username} was recorded but is gone; re-uploading`);
    }
  }

  const localPath = pathLib.join(mediaDir, entry.localFile);
  const target = await pipeline.upload({
    filePath: localPath,
    purpose,
    mimeType: entry.mimeType,
    createdBy: String(userId),
    metadata: { demo: true, theme: account.themeKey }
  });

  // Recorded the moment the id exists, before the bytes are sent, so a crash
  // mid-upload leaves something `demo:clean` can find rather than an orphan.
  await ledger.record(KINDS.FILE, seedKey, target.fileId, { purpose, username: account.username });

  await pipeline.sendBytes({
    uploadUrl: target.uploadUrl,
    token: target.token,
    filePath: localPath,
    mimeType: entry.mimeType
  });

  const processed = await pipeline.waitForProcessing(target.fileId, { timeoutMs: 120000 });
  if (!processed.ok) throw new Error(`${purpose} for ${account.username}: ${processed.reason}`);

  // Reference first, pointer second — see the note at the top of this file.
  await pipeline.attachReference({
    fileIds: [target.fileId],
    createdBy: String(userId),
    itemId: String(userId),
    itemType: FILE_REF_USER
  });

  return {
    fileId: target.fileId,
    url: processed.file.url,
    coverBgColor: processed.file.metadata?.coverBgColor,
    reused: false
  };
}

/**
 * Create (or confirm) every demo account, with avatar and cover attached.
 *
 * @returns a map of username to the account's `_id`, for the later phases.
 */
async function seedAccounts({
  plan, config, db, ledger, pipeline, mediaDir, path: pathLib
}) {
  const created = { users: 0, reused: 0, images: 0 };
  const userIds = new Map();

  for (const account of plan.accounts) {
    const claimed = await ledger.claim(KINDS.USER, account.seedKey, {
      username: account.username, theme: account.themeKey
    });
    const userId = claimed.refId;
    userIds.set(account.username, userId);

    const existing = await db.users.findOne({ _id: userId });
    if (!existing) {
      await db.users.insertOne({
        _id: userId,
        isAdmin: false,
        name: account.name,
        firstName: account.name.split(' ')[0],
        lastName: account.name.split(' ').slice(1).join(' ') || '',
        username: account.username,
        email: account.email,
        verifiedEmail: true,
        bio: account.bio,
        status: USER_STATUS_ACTIVE,
        balance: 0,
        isOnline: false,
        stats: {
          totalLikes: 0, followers: 0, followings: 0, totalPosts: 0
        },
        /**
         * `User.metadata` is a Mixed field, so this is a supported place to mark
         * an account rather than a field smuggled past the schema. It is how a
         * human reading the database, or an admin looking at the profile, can
         * tell this is fabricated data — the ledger answers "did we create it",
         * this answers "is it real".
         */
        metadata: {
          demo: {
            isDemo: true,
            fictional: true,
            namespace: config.seed.namespace,
            theme: account.themeKey,
            note: 'Seeded by api/demo. Not a real person. Remove with: yarn demo:clean'
          }
        },
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await ledger.activate(KINDS.USER, account.seedKey);
      created.users += 1;
      logger.ok(`account ${account.username} (${account.themeLabel})`);
    } else {
      created.reused += 1;
      logger.skip(`account ${account.username} already present`);
    }

    // Auth row, so the dataset can be logged into.
    const authKey = `auth:${account.username}`;
    const authClaim = await ledger.claim(KINDS.AUTH, authKey, { username: account.username });
    const storedAuth = await db.auth.findOne({ _id: authClaim.refId });
    if (!storedAuth) {
      await db.auth.insertOne({
        _id: authClaim.refId,
        userId,
        type: 'password',
        key: account.email,
        value: await hashPassword(config.seed.password),
        // No `salt` column: scrypt carries its own salt inside the value. The
        // legacy verifier keys off the presence of this field, so writing one
        // here would make a scrypt credential look like a legacy one.
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await ledger.activate(KINDS.AUTH, authKey);
    } else if (!String(storedAuth.value || '').startsWith('scrypt$')) {
      // A credential this tool wrote under the old scheme. Re-running the seed
      // should bring it to the current format rather than leaving a legacy row
      // behind for the login path to migrate.
      await db.auth.updateOne(
        { _id: authClaim.refId },
        {
          $set: { value: await hashPassword(config.seed.password), updatedAt: new Date() },
          $unset: { salt: '' }
        }
      );
      logger.detail(`upgraded ${account.username} credential to scrypt`);
    }

    const avatar = await attachProfileImage({
      account, userId, entry: account.avatar, purpose: 'avatar', ledger, pipeline, mediaDir, path: pathLib
    });
    const cover = await attachProfileImage({
      account, userId, entry: account.cover, purpose: 'cover', ledger, pipeline, mediaDir, path: pathLib
    });
    if (!avatar.reused) created.images += 1;
    if (!cover.reused) created.images += 1;

    await db.users.updateOne({ _id: userId }, {
      $set: {
        avatarId: toObjectIdish(avatar.fileId),
        avatar: avatar.url,
        coverId: toObjectIdish(cover.fileId),
        cover: cover.url,
        ...(cover.coverBgColor ? { coverBgColor: cover.coverBgColor } : {}),
        updatedAt: new Date()
      }
    });
  }

  return { userIds, created };
}

/** File server ids arrive as strings; the user schema stores them as ObjectIds. */
function toObjectIdish(id) {
  const { ObjectId } = require('mongodb');
  return ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : id;
}

module.exports = { seedAccounts, hashPassword };
