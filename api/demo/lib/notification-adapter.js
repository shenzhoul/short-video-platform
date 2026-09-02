/**
 * The single place the demo seeder writes notifications.
 *
 * ## Why an adapter and not raw inserts
 *
 * `NotificationService` is Nest-decorated TypeScript with an injected model and
 * a queue publisher, so a plain Node seeder cannot call it. The alternative —
 * inserting notification rows wherever a like or comment is created — would
 * scatter a policy that production keeps in one class, and would drift from it
 * silently. Everything below is written once, here, and every notification the
 * seeder produces goes through it.
 *
 * ## The policy this mirrors
 *
 * Read from `NotificationService`, `notification-reaction.listener.ts` and
 * `notification-comment.listener.ts`. It is not one row per interaction, and
 * assuming it is would produce a notification list that no real usage could
 * generate:
 *
 * | Event | Shape |
 * |---|---|
 * | follow | one reusable row per actor, `follow:<actorId>` |
 * | post like | **one aggregate row per post**, whatever the number of likers |
 * | comment like | one aggregate row per comment |
 * | comment on a post | individual rows until the 5th, then one aggregate per post |
 * | reply to a comment | individual rows until the 5th, then one aggregate per thread |
 * | mention | one row per resource mentioned in |
 * | **share** | **nothing** — see below |
 *
 * `post_share` is deliberately absent from `NOTIFICATION_TYPES`: sharing
 * delivers the post as a message, and the recipient already gets a new-message
 * indication. Seeding a share notification would invent a type the product does
 * not have.
 *
 * Two invariants hold for every row: an actor never notifies themselves
 * (`hasDistinctParticipants`), and the unique `(recipientId, groupKey)` index is
 * what makes a second seed run a no-op rather than a duplicate.
 *
 * ## Read state
 *
 * Production creates every notification unread. The seeder needs a mix, so it
 * marks a deterministic subset read afterwards through `markRead` — which sets
 * exactly the two fields the product sets, and never invents a third.
 */

const { ObjectId } = require('mongodb');

/** `NOTIFICATION_TYPES` in api/src/common/constants/community.ts. */
const TYPES = Object.freeze({
  POST_LIKE: 'post_like',
  COMMENT_LIKE: 'comment_like',
  POST_COMMENT: 'post_comment',
  COMMENT_REPLY: 'comment_reply',
  POST_MENTION: 'post_mention',
  COMMENT_MENTION: 'comment_mention',
  FOLLOW: 'follow'
});

/** `NOTIFICATION_GROUP_KEYS`, reproduced exactly. */
const GROUP_KEYS = Object.freeze({
  postLike: (postId) => `post_like:${postId}`,
  commentLike: (commentId) => `comment_like:${commentId}`,
  postMention: (postId) => `post_mention:${postId}`,
  commentMention: (commentId) => `comment_mention:${commentId}`,
  follow: (actorId) => `follow:${actorId}`,
  postComment: (commentId) => `post_comment:${commentId}`,
  postCommentAggregate: (postId) => `post_comment_agg:${postId}`,
  commentReply: (replyId) => `comment_reply:${replyId}`,
  commentReplyAggregate: (threadId) => `comment_reply_agg:${threadId}`
});

/** `NOTIFICATION_POLICY.COMMENT_AGGREGATION_THRESHOLD`. */
const COMMENT_AGGREGATION_THRESHOLD = 5;

function createNotificationAdapter({ db, ledger, KINDS }) {
  const collection = db.collection('notifications');

  /** Exactly the document `buildIdentity` produces. */
  function buildIdentity({
    recipientId, actorId, type, groupKey, postId, commentId, aggregateResourceId
  }, at) {
    return {
      recipientId,
      actorId,
      type,
      groupKey,
      postId: postId || null,
      commentId: commentId || null,
      aggregateResourceId: aggregateResourceId || null,
      isAggregate: false,
      activityCount: 1,
      lastEventId: null,
      read: false,
      readAt: null,
      lastActivityAt: at,
      createdAt: at,
      updatedAt: at
    };
  }

  /** An actor never notifies themselves. */
  const distinct = (o) => String(o.recipientId) !== String(o.actorId);

  /**
   * Create one row for a group, or leave the existing one untouched.
   *
   * Mirrors `createOnce`, including the part that matters for idempotency: an
   * existing row is *not* modified, so a second seed run never resets read state
   * or moves a notification back to the top.
   */
  async function createOnce(options, at, seedKey) {
    if (!distinct(options)) return null;

    const existing = await collection.findOne({
      recipientId: options.recipientId, groupKey: options.groupKey
    });
    if (existing) return null;

    const claim = await ledger.claim(KINDS.NOTIFICATION, seedKey, { type: options.type });
    if (await collection.findOne({ _id: claim.refId })) return null;

    await collection.insertOne({ _id: claim.refId, ...buildIdentity(options, at) });
    await ledger.activate(KINDS.NOTIFICATION, seedKey);
    return claim.refId;
  }

  /**
   * Write an aggregate group's **final** state in one operation.
   *
   * ## Why not replay the events one at a time
   *
   * The first version mirrored `applyAggregate` literally and folded each like
   * or comment in turn. That is right for production, where each event is
   * delivered once. It is wrong for a seeder, which replays the whole history on
   * every run, and it failed in two ways at once on the second run:
   *
   *  - the upsert filter excludes the event already folded in, so for the *last*
   *    event the filter missed and the upsert tried to insert a second row —
   *    straight into the unique `(recipientId, groupKey)` index;
   *  - every earlier event still matched, so the group was re-folded, `read` was
   *    reset to false and the read state from the previous run was destroyed.
   *
   * So the caller computes what the group should look like — latest actor,
   * newest event, how many events it stands for — and this writes that once.
   * Idempotency then comes from `lastEventId`: if the stored group already ends
   * at the same event, there is nothing new and the row is left completely
   * alone, read state included.
   */
  async function upsertAggregate({
    recipientId, actorId, type, groupKey, postId, commentId, aggregateResourceId,
    lastEventId, activityCount, at
  }, seedKey) {
    if (!distinct({ recipientId, actorId })) return null;

    const existing = await collection.findOne({ recipientId, groupKey });
    if (existing) {
      // Same newest event: nothing has happened since. Touching the row would
      // resurface a notification the recipient has already read.
      if (String(existing.lastEventId || '') === String(lastEventId || '')) return null;
      await collection.updateOne({ _id: existing._id }, {
        $set: {
          actorId,
          lastEventId,
          activityCount,
          isAggregate: true,
          read: false,
          readAt: null,
          lastActivityAt: at,
          updatedAt: at
        }
      });
      await ledger.record(KINDS.NOTIFICATION, seedKey, existing._id, { type });
      return existing._id;
    }

    const claim = await ledger.claim(KINDS.NOTIFICATION, seedKey, { type });
    const identity = buildIdentity({
      recipientId, actorId, type, groupKey, postId, commentId, aggregateResourceId
    }, at);
    try {
      await collection.insertOne({
        ...identity,
        _id: claim.refId,
        isAggregate: true,
        activityCount,
        lastEventId
      });
    } catch (error) {
      // Narrowed to the group index: a concurrent writer created it first, and
      // its row is as good as the one this call wanted.
      if (error?.code === 11000) {
        const winner = await collection.findOne({ recipientId, groupKey });
        if (winner) {
          await ledger.record(KINDS.NOTIFICATION, seedKey, winner._id, { type });
          return winner._id;
        }
      }
      throw error;
    }
    await ledger.activate(KINDS.NOTIFICATION, seedKey);
    return claim.refId;
  }

  /**
   * Reusable relationship notification — following.
   *
   * `resurface` in production reuses one row per actor subject to a cooldown.
   * The seeder creates each follow once, so the cooldown never comes into play
   * and `createOnce` on the same group key is the correct reproduction.
   */
  const recordFollow = ({ recipientId, actorId }, at, seedKey) => createOnce({
    recipientId, actorId, type: TYPES.FOLLOW, groupKey: GROUP_KEYS.follow(String(actorId))
  }, at, seedKey);

  /** One aggregate per post, standing for every liker. */
  const recordPostLikes = ({
    recipientId, latestActorId, postId, latestReactionId, at
  }) => upsertAggregate({
    recipientId,
    actorId: latestActorId,
    type: TYPES.POST_LIKE,
    groupKey: GROUP_KEYS.postLike(String(postId)),
    postId,
    lastEventId: latestReactionId,
    // Like aggregates derive their displayed count from the reaction statistic,
    // so the stored value stays at 1 exactly as production leaves it.
    activityCount: 1,
    at
  }, `notif:postlike:${postId}`);

  /** One aggregate per comment, standing for every liker. */
  const recordCommentLikes = ({
    recipientId, latestActorId, postId, commentId, latestReactionId, at
  }) => upsertAggregate({
    recipientId,
    actorId: latestActorId,
    type: TYPES.COMMENT_LIKE,
    groupKey: GROUP_KEYS.commentLike(String(commentId)),
    postId,
    commentId,
    lastEventId: latestReactionId,
    activityCount: 1,
    at
  }, `notif:commentlike:${commentId}`);

  /** One individual row for a comment below the aggregation threshold. */
  const recordPostCommentIndividual = ({
    recipientId, actorId, postId, commentId, at
  }) => createOnce({
    recipientId,
    actorId,
    type: TYPES.POST_COMMENT,
    groupKey: GROUP_KEYS.postComment(String(commentId)),
    aggregateResourceId: new ObjectId(String(postId)),
    postId,
    commentId
  }, at, `notif:postcomment:${commentId}`);

  /** The aggregate that carries every comment past the threshold. */
  const recordPostCommentAggregate = ({
    recipientId, latestActorId, postId, latestCommentId, activityCount, at
  }) => upsertAggregate({
    recipientId,
    actorId: latestActorId,
    type: TYPES.POST_COMMENT,
    groupKey: GROUP_KEYS.postCommentAggregate(String(postId)),
    aggregateResourceId: new ObjectId(String(postId)),
    postId,
    commentId: latestCommentId,
    lastEventId: latestCommentId,
    activityCount,
    at
  }, `notif:postcomment_agg:${postId}`);

  const recordCommentReplyIndividual = ({
    recipientId, actorId, postId, threadId, replyId, at
  }) => createOnce({
    recipientId,
    actorId,
    type: TYPES.COMMENT_REPLY,
    groupKey: GROUP_KEYS.commentReply(String(replyId)),
    aggregateResourceId: new ObjectId(String(threadId)),
    postId,
    commentId: replyId
  }, at, `notif:commentreply:${replyId}`);

  const recordCommentReplyAggregate = ({
    recipientId, latestActorId, postId, threadId, latestReplyId, activityCount, at
  }) => upsertAggregate({
    recipientId,
    actorId: latestActorId,
    type: TYPES.COMMENT_REPLY,
    groupKey: GROUP_KEYS.commentReplyAggregate(String(threadId)),
    aggregateResourceId: new ObjectId(String(threadId)),
    postId,
    commentId: latestReplyId,
    lastEventId: latestReplyId,
    activityCount,
    at
  }, `notif:commentreply_agg:${threadId}`);

  const recordCommentMention = ({
    recipientId, actorId, postId, commentId
  }, at, seedKey) => createOnce({
    recipientId,
    actorId,
    type: TYPES.COMMENT_MENTION,
    groupKey: GROUP_KEYS.commentMention(String(commentId)),
    postId,
    commentId
  }, at, seedKey);

  const recordPostMention = ({
    recipientId, actorId, postId
  }, at, seedKey) => createOnce({
    recipientId,
    actorId,
    type: TYPES.POST_MENTION,
    groupKey: GROUP_KEYS.postMention(String(postId)),
    postId
  }, at, seedKey);

  /**
   * Mark specific notifications read.
   *
   * Sets exactly what the product sets — `read` and `readAt` — so a seeded read
   * notification is indistinguishable from one a person opened. Idempotent, and
   * scoped to ids the ledger owns by the caller.
   */
  async function markRead(ids, at) {
    if (!ids.length) return 0;
    const result = await collection.updateMany(
      { _id: { $in: ids }, read: false },
      { $set: { read: true, readAt: at, updatedAt: at } }
    );
    return result.modifiedCount;
  }

  const countUnread = (recipientId) => collection.countDocuments({ recipientId, read: false });

  return {
    TYPES,
    GROUP_KEYS,
    COMMENT_AGGREGATION_THRESHOLD,
    collection,
    upsertAggregate,
    createOnce,
    recordFollow,
    recordPostLikes,
    recordCommentLikes,
    recordPostCommentIndividual,
    recordPostCommentAggregate,
    recordCommentReplyIndividual,
    recordCommentReplyAggregate,
    recordCommentMention,
    recordPostMention,
    markRead,
    countUnread
  };
}

module.exports = {
  createNotificationAdapter, TYPES, GROUP_KEYS, COMMENT_AGGREGATION_THRESHOLD
};
