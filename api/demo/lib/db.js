/**
 * MongoDB access for the seed and clean phases.
 *
 * Uses the driver directly rather than booting the Nest application context.
 * Booting the app would start the BullMQ workers, the socket gateway and the
 * recurring job schedulers, so seeding would fire notification fan-out,
 * scheduled cleanups and socket broadcasts as a side effect of writing test
 * data — and it would make Redis a hard requirement of a script that otherwise
 * needs only Mongo and the file server. The trade is that the counters and
 * derived collections the services maintain have to be maintained here too, so
 * every place that does is marked with the service it mirrors.
 *
 * Collection names are read from the schemas rather than guessed: each `@Schema`
 * decorator in `api/src/schemas` declares its `collection`, and the constants
 * below match them one for one.
 *
 * Files are NOT here. They live in the file server's own database
 * (`douyin-clone-file-server`) and are only ever reached through its HTTP API,
 * so nothing in this feature writes to a database it does not own.
 */

const { MongoClient } = require('mongodb');

/** Mirrors the `collection:` option on each `@Schema` in `api/src/schemas`. */
const COLLECTIONS = Object.freeze({
  USERS: 'users',
  AUTH: 'auth',
  POSTS: 'posts',
  POST_MEDIA: 'post_media',
  REACTIONS: 'reactions',
  COMMENTS: 'comments',
  TAG_SUMMARIES: 'tag_summaries',
  CATEGORIES: 'categories',
  NOTIFICATIONS: 'notifications',
  /** This feature's own bookkeeping. Not part of the product schema. */
  DEMO_LEDGER: 'demo_seed_ledger'
});

async function connect(mongoUri) {
  const client = new MongoClient(mongoUri, {
    // A seeder that silently waits forever on an unreachable database is worse
    // than one that says so.
    serverSelectionTimeoutMS: 8000
  });
  await client.connect();
  const db = client.db();

  return {
    client,
    db,
    collection: (name) => db.collection(name),
    users: db.collection(COLLECTIONS.USERS),
    auth: db.collection(COLLECTIONS.AUTH),
    posts: db.collection(COLLECTIONS.POSTS),
    postMedia: db.collection(COLLECTIONS.POST_MEDIA),
    reactions: db.collection(COLLECTIONS.REACTIONS),
    comments: db.collection(COLLECTIONS.COMMENTS),
    tagSummaries: db.collection(COLLECTIONS.TAG_SUMMARIES),
    categories: db.collection(COLLECTIONS.CATEGORIES),
    ledger: db.collection(COLLECTIONS.DEMO_LEDGER),
    close: () => client.close()
  };
}

/**
 * Confirm the deployment is what this tool expects.
 *
 * MongoDB here is standalone, so there are no transactions and no multi-document
 * atomicity. Every write path in the seeder is ordered to be safe without one —
 * ledger row before the document it names, counters reconciled from the data
 * rather than incremented blindly — and this check exists so that assumption is
 * stated rather than implied. A replica set would not break anything; it would
 * just mean the ordering is more careful than it strictly needs to be.
 */
async function describeDeployment(db) {
  try {
    const status = await db.admin().command({ hello: 1 });
    return {
      isReplicaSet: Boolean(status.setName),
      setName: status.setName || null,
      version: (await db.admin().command({ buildInfo: 1 })).version
    };
  } catch {
    return { isReplicaSet: false, setName: null, version: 'unknown' };
  }
}

module.exports = { connect, describeDeployment, COLLECTIONS };
