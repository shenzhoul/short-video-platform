/**
 * Correct the `auth_tokens` TTL index to `expireAfterSeconds: 0`.
 *
 * `expiresAt` holds an **absolute instant** — the moment a token stops being
 * usable. For a field like that, `expireAfterSeconds: 0` is what makes MongoDB
 * delete the document once the instant has passed. The index shipped as
 * `604800`, which is the option for a *creation* timestamp and here meant
 * "delete a week after the token expired", retaining spent tokens for seven days
 * nothing asked to keep.
 *
 * `createIndex` cannot change an existing index's options — it fails with a
 * conflict against the old definition — so the fix is a drop and recreate, which
 * is why it lives in a script rather than relying on `autoIndex`.
 *
 * The other two indexes on this collection are read and reported but never
 * touched. Only the TTL index is dropped, and only when its options actually
 * differ.
 *
 * Usage:
 *   node scripts/repair-auth-token-ttl-index.js            # dry run (default)
 *   node scripts/repair-auth-token-ttl-index.js --apply    # drop + recreate
 *
 * Mutation is never the default and a second `--apply` changes nothing: the
 * script re-reads the live options and exits early when they already match.
 *
 * Exit code 0 = correct (or repaired and verified). Non-zero = something still
 * needs a human; the output names it.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');
const URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';

const COLLECTION = 'auth_tokens';
const TTL_INDEX = 'idx_auth_token_expiry_cleanup';
const TTL_KEY = { expiresAt: 1 };
const TTL_SECONDS = 0;

/** Indexes this script must never touch, whatever it finds. */
const PROTECTED = ['idx_auth_token_hash_unique', 'idx_auth_token_user_type_status', '_id_'];

function sameKey(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Is the live TTL index already what the schema declares?
 *
 * Both halves matter: an index with the right name but a different key is as
 * wrong as one with the right key and the wrong expiry.
 */
function isCorrect(index) {
  return !!index
    && sameKey(index.key, TTL_KEY)
    && index.expireAfterSeconds === TTL_SECONDS;
}

(async () => {
  const connection = await mongoose.createConnection(URI).asPromise();
  let exitCode = 0;

  try {
    const collections = await connection.db.listCollections({ name: COLLECTION }).toArray();
    if (!collections.length) {
      console.log(`${COLLECTION} does not exist yet — the migration will create it correctly. Nothing to do.`);
      return;
    }

    const collection = connection.db.collection(COLLECTION);
    const before = await collection.indexes();
    const ttl = before.find((index) => index.name === TTL_INDEX);

    console.log(`${COLLECTION} indexes:`);
    before.forEach((index) => {
      const expiry = index.expireAfterSeconds === undefined ? '-' : index.expireAfterSeconds;
      console.log(`   ${index.name} ${JSON.stringify(index.key)} expireAfterSeconds=${expiry}`);
    });

    if (isCorrect(ttl)) {
      console.log(`\n${TTL_INDEX} is already { expiresAt: 1 } with expireAfterSeconds=0. Nothing to do.`);
      return;
    }

    if (!ttl) {
      console.log(`\n${TTL_INDEX} is missing.`);
    } else {
      console.log(`\n${TTL_INDEX} has expireAfterSeconds=${ttl.expireAfterSeconds}, expected ${TTL_SECONDS}.`);
    }

    if (!APPLY) {
      console.log('dry run complete — 1 fix would be applied. Re-run with --apply to perform it.');
      return;
    }

    if (ttl) {
      // Named explicitly. A drop by key specification could match something the
      // schema does not own.
      if (PROTECTED.includes(TTL_INDEX)) throw new Error('refusing to drop a protected index');
      await collection.dropIndex(TTL_INDEX);
      console.log(`dropped ${TTL_INDEX}`);
    }

    await collection.createIndex(TTL_KEY, { name: TTL_INDEX, expireAfterSeconds: TTL_SECONDS });
    console.log(`created ${TTL_INDEX} with expireAfterSeconds=${TTL_SECONDS}`);

    // Read back from MongoDB rather than trusting the call above.
    const after = await collection.indexes();
    const repaired = after.find((index) => index.name === TTL_INDEX);
    if (!isCorrect(repaired)) {
      console.error(`\nVERIFY FAILED: ${TTL_INDEX} is ${JSON.stringify(repaired)}`);
      exitCode = 1;
      return;
    }

    const missing = PROTECTED.filter((name) => !after.some((index) => index.name === name));
    if (missing.length) {
      console.error(`\nVERIFY FAILED: protected index removed: ${missing.join(', ')}`);
      exitCode = 1;
      return;
    }

    console.log(`\nverified from MongoDB: ${TTL_INDEX} expireAfterSeconds=${repaired.expireAfterSeconds}; `
      + `${PROTECTED.length - 1} other index(es) intact`);
  } catch (error) {
    console.error('\nrepair aborted:', error.message);
    exitCode = 1;
  } finally {
    await connection.close();
  }

  if (exitCode) process.exit(exitCode);
})();
