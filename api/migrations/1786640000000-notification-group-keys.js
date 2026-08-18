const mongoose = require('mongoose');

/**
 * Move notifications from per-actor de-duplication to per-type group policies.
 *
 * A schema change alone cannot do this on a populated database. Mongoose's
 * `autoIndex` only ever *creates* indexes, so:
 *
 *  - the obsolete `uniq_recipient_actor_type_resource` constraint would survive
 *    forever, and
 *  - the new unique `{recipientId, groupKey}` index cannot even build while
 *    legacy rows all carry a null `groupKey` — every one of them collides.
 *
 * Every field the new policies read is backfilled, not just `groupKey`, because
 * the adaptive threshold counts on `aggregateResourceId` and `isAggregate`.
 */

const COLLECTION = 'notifications';
const OBSOLETE_INDEX = 'uniq_recipient_actor_type_resource';
const GROUP_INDEX = 'uniq_recipient_groupKey';

/** Mirrors NOTIFICATION_GROUP_KEYS in src/common/constants/community.ts. */
function buildGroupKey(row) {
  const post = row.postId ? row.postId.toString() : null;
  const comment = row.commentId ? row.commentId.toString() : null;
  const actor = row.actorId ? row.actorId.toString() : null;

  switch (row.type) {
    case 'post_like': return post && `post_like:${post}`;
    case 'comment_like': return comment && `comment_like:${comment}`;
    case 'post_mention': return post && `post_mention:${post}`;
    case 'comment_mention': return comment && `comment_mention:${comment}`;
    case 'follow': return actor && `follow:${actor}`;
    // Legacy comment rows each stood for one event, so they become individual
    // rows; the aggregate form only ever appears for activity after this point.
    case 'post_comment': return comment && `post_comment:${comment}`;
    case 'comment_reply': return comment && `comment_reply:${comment}`;
    default: return null;
  }
}

/**
 * The resource the adaptive types count against: the post for a comment, the
 * thread's root comment for a reply.
 *
 * A reply's root is read from the stored comment rather than guessed. The
 * `postId` fallback covers only rows whose comment no longer exists, so the
 * field is never left null — the count reported below says how often that was
 * actually needed.
 */
async function resolveAggregateResourceId(db, row, stats) {
  if (row.type === 'post_comment') return row.postId || null;
  if (row.type !== 'comment_reply') return null;
  if (!row.commentId) return row.postId || null;

  const reply = await db.collection('comments').findOne(
    { _id: row.commentId },
    { projection: { objectId: 1, objectType: 1 } }
  );
  if (reply && reply.objectId) return reply.objectId;

  stats.repliesFallingBackToPost += 1;
  return row.postId || null;
}

/**
 * Keep a collapsed like group pointing at somebody who still likes the resource.
 *
 * Legacy like rows were per-actor, so collapsing them picks one survivor whose
 * actor may since have unliked. Displaying a stale name permanently is worse
 * than dropping a group that no longer represents anything.
 */
async function reconcileLikeActor(db, kept, stats) {
  const isLike = kept.type === 'post_like' || kept.type === 'comment_like';
  if (!isLike) return;

  const objectType = kept.type === 'post_like' ? 'post' : 'comment';
  const objectId = kept.type === 'post_like' ? kept.postId : kept.commentId;
  if (!objectId) return;

  const stillLikes = await db.collection('reactions').findOne({
    objectId, objectType, action: 'like', createdBy: kept.actorId
  });
  if (stillLikes) return;

  const newest = await db.collection('reactions')
    .find({ objectId, objectType, action: 'like' })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray();

  if (!newest.length) {
    await db.collection(COLLECTION).deleteOne({ _id: kept._id });
    stats.staleLikeGroupsDropped += 1;
    return;
  }

  await db.collection(COLLECTION).updateOne(
    { _id: kept._id },
    { $set: { actorId: newest[0].createdBy, updatedAt: new Date() } }
  );
  stats.likeActorsReconciled += 1;
}

module.exports.up = async function up(next) {
  try {
    const db = mongoose.connection.db;
    const notifications = db.collection(COLLECTION);
    const stats = {
      sharesRemoved: 0,
      rowsKeyed: 0,
      duplicatesCollapsed: 0,
      repliesFallingBackToPost: 0,
      likeActorsReconciled: 0,
      staleLikeGroupsDropped: 0,
      unkeyableRowsRemoved: 0
    };

    // 1. post_share is no longer a type, so these rows can never render.
    const removedShares = await notifications.deleteMany({ type: 'post_share' });
    stats.sharesRemoved = removedShares.deletedCount || 0;

    // 2. Backfill every field the new policies read.
    const cursor = notifications.find({
      $or: [{ groupKey: { $exists: false } }, { groupKey: null }]
    });

    while (await cursor.hasNext()) {
      const row = await cursor.next();
      const groupKey = buildGroupKey(row);

      if (!groupKey) {
        // Nothing identifies this row under any policy; leaving it would only
        // break the unique index it can never satisfy.
        await notifications.deleteOne({ _id: row._id });
        stats.unkeyableRowsRemoved += 1;
        continue;
      }

      await notifications.updateOne({ _id: row._id }, {
        $set: {
          groupKey,
          // Each legacy row stood for exactly one event.
          isAggregate: false,
          activityCount: 1,
          aggregateResourceId: await resolveAggregateResourceId(db, row, stats),
          lastEventId: row.lastEventId || null,
          lastActivityAt: row.lastActivityAt || row.createdAt || new Date(),
          updatedAt: new Date()
        }
      });
      stats.rowsKeyed += 1;
    }

    // 3. Collapse what used to be several per-actor rows into one group, which
    //    is exactly the intended change for likes.
    const duplicates = await notifications.aggregate([
      {
        $group: {
          _id: { recipientId: '$recipientId', groupKey: '$groupKey' },
          ids: { $push: '$_id' },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 1 } } }
    ]).toArray();

    for (const duplicate of duplicates) {
      const rows = await notifications
        .find({ _id: { $in: duplicate.ids } })
        .sort({ lastActivityAt: -1, _id: -1 })
        .toArray();

      const [kept, ...discarded] = rows;
      await notifications.deleteMany({ _id: { $in: discarded.map((row) => row._id) } });
      stats.duplicatesCollapsed += discarded.length;

      // 4. The survivor's actor must still be a current liker.
      await reconcileLikeActor(db, kept, stats);
    }

    // 5. Drop the constraint the old model needed; autoIndex never would.
    const indexes = await notifications.indexes();
    if (indexes.some((index) => index.name === OBSOLETE_INDEX)) {
      await notifications.dropIndex(OBSOLETE_INDEX);
    }

    // The application creates this index too, but doing it here proves the data
    // above is actually consistent rather than leaving it to fail at boot.
    if (!indexes.some((index) => index.name === GROUP_INDEX)) {
      await notifications.createIndex(
        { recipientId: 1, groupKey: 1 },
        { name: GROUP_INDEX, unique: true }
      );
    }

    console.log('[notification-group-keys]', JSON.stringify(stats));
    next();
  } catch (error) {
    next(error);
  }
};

module.exports.down = function down(next) {
  // Deliberately irreversible: the collapse discards per-actor rows, and the
  // originals cannot be reconstructed from what remains.
  next();
};
