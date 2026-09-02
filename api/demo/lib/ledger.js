/**
 * The seed ledger — the record of everything this tool created.
 *
 * ## Why a ledger and not a marker field
 *
 * `demo:clean` must delete demo data and nothing else. Two weaker designs were
 * available and both are wrong:
 *
 *  - **Match on a marker field.** `Post` has no `metadata` field and Mongoose
 *    strips unknown properties, so posts could only be marked by writing outside
 *    the schema. Worse, matching on a shape means a real user who happens to
 *    match it gets deleted.
 *  - **Match on ownership.** "Delete every post belonging to a demo user" is
 *    correct only for as long as nothing else can produce such a row. A real
 *    person commenting on a demo post is exactly that case, and their comment is
 *    not ours to delete.
 *
 * The ledger inverts the question. Instead of asking "does this look like demo
 * data?", clean asks "did we create this?", and only ever deletes rows it can
 * name. A comment a real user left on a demo post is not in the ledger, so it
 * survives — see `clean.js` for what that means for the post itself.
 *
 * ## Ordering, on a standalone MongoDB
 *
 * There are no transactions here, so the ledger row is written **first**, with
 * the `_id` the document will be given. The two possible interruptions are:
 *
 *  - after the ledger row, before the document — clean tries to delete an `_id`
 *    that does not exist, which is a no-op;
 *  - after the document, before it is marked active — the row exists and names
 *    it, so clean removes it.
 *
 * Both are recoverable. The reverse order has an unrecoverable case: a document
 * that exists and nothing knows about.
 */

const { ObjectId } = require('mongodb');

const KINDS = Object.freeze({
  USER: 'user',
  AUTH: 'auth',
  POST: 'post',
  POST_MEDIA: 'post_media',
  REACTION: 'reaction',
  COMMENT: 'comment',
  /** Lives in the file server's database, deleted through its API. */
  FILE: 'file',
  NOTIFICATION: 'notification',
  CONVERSATION: 'conversation',
  CONVERSATION_PARTICIPANT: 'conversation_participant',
  MESSAGE: 'message',
  /** A block or restrict flag, in `user_relationships`. */
  RELATIONSHIP: 'relationship',
  /** A category this tool created. Never one that already existed. */
  CATEGORY: 'category'
});

function createLedger(collection, namespace) {
  /**
   * The unique index is what makes a claim idempotent under a concurrent run.
   * Created here rather than in a migration because this collection is
   * development tooling, not product schema — `demo:clean --purge` drops it.
   */
  async function ensureIndexes() {
    await collection.createIndex(
      { namespace: 1, kind: 1, seedKey: 1 },
      { name: 'uniq_namespace_kind_seedKey', unique: true }
    );
    await collection.createIndex({ namespace: 1, kind: 1 }, { name: 'idx_namespace_kind' });
  }

  /**
   * Reserve an `_id` for a document we are about to insert.
   *
   * @returns `{ refId, created }` — `created: false` means a previous run
   *   already claimed this key, and the caller should treat its work as done
   *   (or verify and repair, which is what the seeder does).
   */
  async function claim(kind, seedKey, meta = {}) {
    const existing = await collection.findOne({ namespace, kind, seedKey });
    if (existing) return { refId: existing.refId, created: false, entry: existing };

    const refId = new ObjectId();
    const entry = {
      namespace,
      kind,
      seedKey,
      refId,
      status: 'pending',
      meta,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    try {
      await collection.insertOne(entry);
      return { refId, created: true, entry };
    } catch (error) {
      // Narrowly: a duplicate on *this* index means a concurrent run won the
      // race, which is a success. Any other 11000 is a different problem and
      // must not be swallowed as one.
      if (error?.code === 11000 && error?.keyPattern?.seedKey !== undefined) {
        const winner = await collection.findOne({ namespace, kind, seedKey });
        if (winner) return { refId: winner.refId, created: false, entry: winner };
      }
      throw error;
    }
  }

  /**
   * Record something whose id we did not choose — a file server id, which only
   * exists once the upload record has been created.
   *
   * The window between the id existing and this call is the one place the
   * ledger cannot cover. It is bounded to a single statement, and the file
   * server's own unused-file sweeper collects anything stranded in it, because
   * such a file carries no reference.
   */
  async function record(kind, seedKey, refId, meta = {}) {
    await collection.updateOne(
      { namespace, kind, seedKey },
      {
        $set: {
          refId, status: 'active', meta, updatedAt: new Date()
        },
        $setOnInsert: {
          namespace, kind, seedKey, createdAt: new Date()
        }
      },
      { upsert: true }
    );
  }

  /** Mark a claimed row's document as written. */
  async function activate(kind, seedKey, meta = undefined) {
    const update = { status: 'active', updatedAt: new Date() };
    if (meta !== undefined) update.meta = meta;
    await collection.updateOne({ namespace, kind, seedKey }, { $set: update });
  }

  async function find(kind, seedKey) {
    return collection.findOne({ namespace, kind, seedKey });
  }

  async function all(kind) {
    const filter = { namespace };
    if (kind) filter.kind = kind;
    return collection.find(filter).toArray();
  }

  async function idsOf(kind) {
    const rows = await collection.find({ namespace, kind }, { projection: { refId: 1 } }).toArray();
    return rows.map((r) => r.refId);
  }

  async function remove(kind, seedKeys) {
    if (!seedKeys.length) return 0;
    const result = await collection.deleteMany({ namespace, kind, seedKey: { $in: seedKeys } });
    return result.deletedCount;
  }

  async function removeKind(kind) {
    const result = await collection.deleteMany({ namespace, kind });
    return result.deletedCount;
  }

  async function counts() {
    const rows = await collection.aggregate([
      { $match: { namespace } },
      { $group: { _id: '$kind', n: { $sum: 1 } } }
    ]).toArray();
    return Object.fromEntries(rows.map((r) => [r._id, r.n]));
  }

  return {
    ensureIndexes,
    claim,
    record,
    activate,
    find,
    all,
    idsOf,
    remove,
    removeKind,
    counts,
    namespace
  };
}

module.exports = { createLedger, KINDS };
