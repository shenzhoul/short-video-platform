/**
 * Recomputes every cached counter from the rows that actually exist.
 *
 * ## Why recompute instead of increment
 *
 * The services increment: `handleLikeStat(postId, 1)` when a like arrives,
 * `updateCommentCount(postId, -(1 + totalReply))` when a comment is deleted.
 * That is right for a live system, where each event happens once.
 *
 * A seeder is not a live system. It is expected to run twice, and the second run
 * finds most rows already present and creates only the missing ones. Incrementing
 * would then either double every counter or require the increment to know
 * exactly which rows were new — a condition that is one bug away from silent
 * drift, in the direction nobody notices until a profile says 40 followers and
 * lists 20.
 *
 * Recomputing is idempotent by construction: the counter after the second run
 * equals the counter after the first, because both are a count of the same rows.
 *
 * ## The semantics come from the listeners, not from guesswork
 *
 *  - `post.totalComment` counts replies too. `comment.listener.ts` increments the
 *    post for a top-level comment *and* again for a reply, via the reply's parent.
 *  - `comment.totalReply` counts direct replies to that comment.
 *  - `user.stats.totalPosts` is a count of active posts — `user-assests.listener.ts`
 *    `$set`s it from `countPostsByCreator`, it does not increment.
 *  - `user.stats.totalLikes` is likes received across the creator's content.
 *  - `post.totalShare` counts distinct sharers; share reactions are never removed.
 *
 * ## Scope
 *
 * Every update below is restricted to the ids this tool created. A real user's
 * counters are never read, written, or recomputed — a recompute is still a
 * write, and this feature has no business making one on data it does not own.
 */

const logger = require('./logger');

/** The reaction shapes production uses for a comment like. */
const REACTION_TARGET_COMMENT = 'comment';
const REACTION_LIKE = 'like';

/** Recompute `totalLike`, `totalComment` and `totalShare` for the demo posts. */
async function reconcilePosts(db, postIds) {
  if (postIds.length === 0) return 0;

  const [likes, shares, directComments, replies] = await Promise.all([
    db.reactions.aggregate([
      { $match: { objectType: 'post', action: 'like', objectId: { $in: postIds } } },
      { $group: { _id: '$objectId', n: { $sum: 1 } } }
    ]).toArray(),
    db.reactions.aggregate([
      { $match: { objectType: 'post', action: 'share', objectId: { $in: postIds } } },
      { $group: { _id: '$objectId', n: { $sum: 1 } } }
    ]).toArray(),
    db.comments.aggregate([
      { $match: { objectType: 'post', objectId: { $in: postIds } } },
      { $group: { _id: '$objectId', n: { $sum: 1 } } }
    ]).toArray(),
    // Replies count towards the post as well, so they have to be attributed
    // back to it through their parent comment.
    db.comments.aggregate([
      { $match: { objectType: 'post', objectId: { $in: postIds } } },
      {
        $lookup: {
          from: 'comments',
          localField: '_id',
          foreignField: 'objectId',
          pipeline: [{ $match: { objectType: 'comment' } }],
          as: 'replies'
        }
      },
      { $project: { objectId: 1, replyCount: { $size: '$replies' } } },
      { $group: { _id: '$objectId', n: { $sum: '$replyCount' } } }
    ]).toArray()
  ]);

  const toMap = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));
  const likeMap = toMap(likes);
  const shareMap = toMap(shares);
  const commentMap = toMap(directComments);
  const replyMap = toMap(replies);

  const operations = postIds.map((postId) => {
    const key = String(postId);
    return {
      updateOne: {
        filter: { _id: postId },
        update: {
          $set: {
            totalLike: likeMap.get(key) || 0,
            totalShare: shareMap.get(key) || 0,
            totalComment: (commentMap.get(key) || 0) + (replyMap.get(key) || 0)
          }
        }
      }
    };
  });

  await db.posts.bulkWrite(operations, { ordered: false });
  return operations.length;
}

/**
 * Recompute `totalReply` and `totalLike` on the demo comments.
 *
 * `totalLike` was missing here, and nothing else set it. The seeder wrote
 * comment-like reactions and the `comment_like` notifications that go with
 * them, but every seeded comment kept the `totalLike: 0` it was inserted with —
 * so a notification saying somebody liked your comment opened onto a comment
 * showing zero likes. Four real reaction rows, a counter reading nought, and no
 * error anywhere.
 *
 * The definition is production's, from `CommentReactionListener`, which moves
 * the counter by one per `reactions` row with `objectType: 'comment'` and
 * `action: 'like'`. Counted here rather than incremented, like every other
 * counter in this file — see the note at the top.
 *
 * `commentIds` covers replies as well as root comments: a reply is a `comments`
 * row and is liked exactly the same way, so it gets the same treatment. Nothing
 * folds a reply's likes into its parent.
 */
async function reconcileComments(db, commentIds) {
  if (commentIds.length === 0) return 0;

  const replyCounts = await db.comments.aggregate([
    { $match: { objectType: 'comment', objectId: { $in: commentIds } } },
    { $group: { _id: '$objectId', n: { $sum: 1 } } }
  ]).toArray();
  const replyMap = new Map(replyCounts.map((r) => [String(r._id), r.n]));

  const likeCounts = await db.reactions.aggregate([
    {
      $match: {
        objectType: REACTION_TARGET_COMMENT,
        action: REACTION_LIKE,
        objectId: { $in: commentIds }
      }
    },
    // Distinct likers, not raw rows: two rows from one account would otherwise
    // count twice, and the product treats a like as a property of the person.
    { $group: { _id: { objectId: '$objectId', by: '$createdBy' } } },
    { $group: { _id: '$_id.objectId', n: { $sum: 1 } } }
  ]).toArray();
  const likeMap = new Map(likeCounts.map((r) => [String(r._id), r.n]));

  await db.comments.bulkWrite(
    commentIds.map((commentId) => ({
      updateOne: {
        filter: { _id: commentId },
        update: {
          $set: {
            totalReply: replyMap.get(String(commentId)) || 0,
            totalLike: likeMap.get(String(commentId)) || 0
          }
        }
      }
    })),
    { ordered: false }
  );
  return commentIds.length;
}

/** Recompute the four `stats` fields on the demo users. */
async function reconcileUsers(db, userIds) {
  if (userIds.length === 0) return 0;

  const [followers, followings, postCounts, likesReceived] = await Promise.all([
    db.reactions.aggregate([
      { $match: { objectType: 'creator', action: 'follow', objectId: { $in: userIds } } },
      { $group: { _id: '$objectId', n: { $sum: 1 } } }
    ]).toArray(),
    db.reactions.aggregate([
      { $match: { objectType: 'creator', action: 'follow', createdBy: { $in: userIds } } },
      { $group: { _id: '$createdBy', n: { $sum: 1 } } }
    ]).toArray(),
    db.posts.aggregate([
      { $match: { userId: { $in: userIds }, status: 'active' } },
      { $group: { _id: '$userId', n: { $sum: 1 } } }
    ]).toArray(),
    db.posts.aggregate([
      { $match: { userId: { $in: userIds }, status: 'active' } },
      { $group: { _id: '$userId', n: { $sum: { $ifNull: ['$totalLike', 0] } } } }
    ]).toArray()
  ]);

  const toMap = (rows) => new Map(rows.map((r) => [String(r._id), r.n]));
  const followerMap = toMap(followers);
  const followingMap = toMap(followings);
  const postMap = toMap(postCounts);
  const likeMap = toMap(likesReceived);

  await db.users.bulkWrite(
    userIds.map((userId) => {
      const key = String(userId);
      return {
        updateOne: {
          filter: { _id: userId },
          update: {
            $set: {
              'stats.followers': followerMap.get(key) || 0,
              'stats.followings': followingMap.get(key) || 0,
              'stats.totalPosts': postMap.get(key) || 0,
              'stats.totalLikes': likeMap.get(key) || 0,
              updatedAt: new Date()
            }
          }
        }
      };
    }),
    { ordered: false }
  );
  return userIds.length;
}

/**
 * Rebuild the tag summaries for a set of tags.
 *
 * A direct port of `TagStatisticsService.reconcileTagStatistic`, including the
 * deletion of a summary whose last post is gone — which is what makes this
 * correct to call from `demo:clean` as well as from `demo:seed`.
 *
 * Note that this one is deliberately **not** scoped to demo data: a tag summary
 * aggregates every post carrying the tag, so recomputing it from the whole
 * collection is the only way to get the right number when demo posts and real
 * posts share a hashtag.
 */
async function reconcileTags(db, tags) {
  const normalised = [...new Set(tags.map((t) => String(t || '').toLowerCase().trim()).filter(Boolean))];
  let updated = 0;
  let removed = 0;

  for (const tag of normalised) {
    const [statistics] = await db.posts.aggregate([
      { $match: { tags: tag } },
      {
        $group: {
          _id: null,
          totalUsage: { $sum: 1 },
          totalLikes: { $sum: { $ifNull: ['$totalLike', 0] } },
          uniqueUsers: { $addToSet: '$userId' },
          firstUsageDate: { $min: '$createdAt' },
          lastUsageDate: { $max: '$createdAt' }
        }
      }
    ]).toArray();

    if (!statistics) {
      const result = await db.tagSummaries.deleteOne({ tag });
      removed += result.deletedCount;
      continue;
    }

    const uniqueUsers = statistics.uniqueUsers.length;
    await db.tagSummaries.updateOne(
      { tag },
      {
        $set: {
          postStats: {
            totalUsage: statistics.totalUsage,
            uniqueUsers,
            totalViews: 0,
            totalLikes: statistics.totalLikes
          },
          grandTotalUsage: statistics.totalUsage,
          grandTotalUniqueUsers: uniqueUsers,
          grandTotalViews: 0,
          grandTotalLikes: statistics.totalLikes,
          firstUsageDate: statistics.firstUsageDate,
          lastUsageDate: statistics.lastUsageDate,
          updatedAt: new Date()
        },
        $setOnInsert: {
          tag, createdAt: new Date(), trendingScore: 0, popularityRank: 0
        }
      },
      { upsert: true }
    );
    updated += 1;
  }

  return { updated, removed };
}

/**
 * Recompute conversation previews and per-participant unread counts.
 *
 * Mirrors `ConversationParticipantService`: a participant's `unreadCount` is the
 * number of messages in the thread that somebody else sent after that
 * participant last read it, and `lastMessageAt` is the newest message in the
 * thread. System notices are excluded from both — a notice is not activity, and
 * the product deliberately does not let one resurface a conversation.
 *
 * Recomputed rather than incremented for the same reason every other counter is:
 * a second seed run must not double anything.
 */
async function reconcileConversations(db, conversationIds) {
  if (conversationIds.length === 0) return 0;

  const messages = db.collection('messages');
  const participants = db.collection('conversation_participants');

  for (const conversationId of conversationIds) {
    const rows = await messages
      .find({ conversationId }, {
        projection: {
          senderId: 1, type: 1, text: 1, createdAt: 1
        }
      })
      .sort({ createdAt: 1 })
      .toArray();

    // A system notice carries no sender and must not become the preview.
    const real = rows.filter((m) => m.type !== 'system');
    const last = real[real.length - 1] || null;

    await db.collection('conversations').updateOne({ _id: conversationId }, {
      $set: {
        lastMessage: last && last.type !== 'post' ? last.text || '' : '',
        lastMessageType: last ? last.type : null,
        lastSenderId: last ? last.senderId : null,
        lastMessageCreatedAt: last ? last.createdAt : null
      }
    });

    const seats = await participants.find({ conversationId }).toArray();
    for (const seat of seats) {
      const unread = real.filter((m) => String(m.senderId) !== String(seat.userId)
        && (!seat.lastReadAt || m.createdAt > seat.lastReadAt)).length;
      await participants.updateOne({ _id: seat._id }, {
        $set: {
          unreadCount: unread,
          lastMessageAt: last ? last.createdAt : seat.lastMessageAt,
          updatedAt: new Date()
        }
      });
    }
  }

  return conversationIds.length;
}

/**
 * Run every reconciliation in dependency order.
 *
 * Posts before users, because `stats.totalLikes` sums `post.totalLike`; tags
 * last, because a tag summary caches the same `totalLike`.
 */
async function reconcileAll({
  db, userIds, postIds, commentIds, tags, conversationIds = []
}) {
  logger.detail('recomputing comment reply and like counts…');
  await reconcileComments(db, commentIds);
  logger.detail('recomputing post counters…');
  await reconcilePosts(db, postIds);
  logger.detail('recomputing user stats…');
  await reconcileUsers(db, userIds);
  logger.detail('recomputing conversation previews and unread counts…');
  await reconcileConversations(db, conversationIds);
  logger.detail('rebuilding tag summaries…');
  const tagResult = await reconcileTags(db, tags);
  return tagResult;
}

module.exports = {
  reconcileAll,
  reconcilePosts,
  reconcileComments,
  reconcileUsers,
  reconcileTags,
  reconcileConversations
};
