/**
 * Create the `auth_tokens` indexes.
 *
 * ## Why a migration rather than `autoIndex`
 *
 * Mongoose's `autoIndex` creates a missing index at boot, but it cannot *change*
 * an existing one — `createIndex` fails with a conflict against the old
 * definition — and it gives no signal about what it did. Declaring the indexes
 * here means the shape is created once, deliberately, before the first token is
 * written, and the run fails loudly if the database disagrees.
 *
 * The definitions match `AuthTokenSchema` exactly (same keys, same names, same
 * options), so `autoIndex` at boot finds them present and does nothing.
 *
 * ## It reads them back
 *
 * Per the repo rule about not assuming boot reconciled anything: after creating,
 * this asserts the live index list matches what was asked for. A silent mismatch
 * between the schema declaration and the runtime index is the failure mode that
 * only surfaces months later as a slow query or a missing constraint.
 *
 * ## Touches nothing else
 *
 * No existing collection is read or written. There is no backfill: every account
 * in the database is already `verifiedEmail: true`, and the collection this
 * creates holds only in-flight tokens.
 */
const { DB } = require('./lib');

const COLLECTION_NAME = 'auth_tokens';

const INDEXES = [
  {
    key: { tokenHash: 1 },
    options: { name: 'idx_auth_token_hash_unique', unique: true }
  },
  {
    key: {
      userId: 1, type: 1, status: 1, createdAt: -1
    },
    options: { name: 'idx_auth_token_user_type_status' }
  },
  {
    key: { expiresAt: 1 },
    // `expiresAt` is an absolute instant, so `expireAfterSeconds: 0` means
    // "delete once that instant has passed". Housekeeping only: expiry is
    // enforced by the claim's own `expiresAt` predicate — see AuthTokenSchema.
    options: { name: 'idx_auth_token_expiry_cleanup', expireAfterSeconds: 0 }
  }
];

module.exports.up = async function up(next) {
  const tokens = DB.collection(COLLECTION_NAME);

  await INDEXES.reduce(async (previous, index) => {
    await previous;
    await tokens.createIndex(index.key, index.options);
    return Promise.resolve();
  }, Promise.resolve());

  // Read back rather than assume. A name that exists with different options is
  // worse than one that does not exist, because nothing will report it.
  const live = await tokens.indexes();
  const byName = new Map(live.map((index) => [index.name, index]));

  const problems = [];
  INDEXES.forEach(({ key, options }) => {
    const found = byName.get(options.name);
    if (!found) {
      problems.push(`${options.name} was not created`);
      return;
    }
    if (JSON.stringify(found.key) !== JSON.stringify(key)) {
      problems.push(`${options.name} has key ${JSON.stringify(found.key)}, expected ${JSON.stringify(key)}`);
    }
    if (!!found.unique !== !!options.unique) {
      problems.push(`${options.name} unique=${!!found.unique}, expected ${!!options.unique}`);
    }
    if (found.expireAfterSeconds !== options.expireAfterSeconds) {
      problems.push(`${options.name} expireAfterSeconds=${found.expireAfterSeconds}, expected ${options.expireAfterSeconds}`);
    }
  });

  if (problems.length) {
    return next(new Error(`auth_tokens indexes did not verify:\n  - ${problems.join('\n  - ')}`));
  }

  console.log(`auth_tokens: ${INDEXES.length} indexes verified`);
  return next();
};

module.exports.down = async function down(next) {
  // Safe to drop wholesale: the collection holds only in-flight verification and
  // reset tokens. Anyone mid-flow requests a new link, which every UI state that
  // can show an expired token already offers.
  const exists = await DB.listCollections({ name: COLLECTION_NAME }).toArray();
  if (exists.length) {
    await DB.collection(COLLECTION_NAME).drop();
  }
  next();
};
