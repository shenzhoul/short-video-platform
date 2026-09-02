/**
 * Notifications, conversations and messages — the parts of the product a
 * dataset of posts alone leaves untested.
 *
 * ## Notifications are derived, not invented
 *
 * Every notification here comes from an interaction that already exists in the
 * database: a follow row, a like reaction, a comment, a reply. Nothing is
 * fabricated to fill a list. That is what makes the notification list agree with
 * the post it points at, and what makes the aggregate counts add up.
 *
 * The shape is production's, not one-row-per-event — see
 * `notification-adapter.js` for the table. The visible consequence: a post with
 * twelve likes produces **one** notification, and an account with many comments
 * on one post gets four individual rows and then an aggregate.
 *
 * ## Every account is populated, without an O(n²) graph
 *
 * Conversations follow a deterministic ring with a few chords rather than every
 * pair: each account talks to its two ring neighbours, which guarantees every
 * account has at least two conversations, both incoming and outgoing messages,
 * and at least one unread thread — while the total stays linear in the number of
 * accounts instead of quadratic.
 *
 * The primary account additionally gets one thread of every reachable kind, so
 * a person signing in as it can exercise the whole messaging surface by hand.
 *
 * ## Only reachable states are seeded
 *
 * Pending, accepted, mutual-follow-open, restricted and blocked are the five
 * states `claimSendSlot` can produce. A pending thread therefore contains
 * exactly one message, from the initiator, because the product refuses a second
 * — seeding two would make the UI look populated while testing a state that
 * cannot occur.
 */

const logger = require('./logger');
const { createRandom } = require('./random');
const { KINDS } = require('./ledger');

/**
 * Group rows by a key, preserving the order they arrived in.
 *
 * Order matters: the caller reads "the newest event" off the end of each group,
 * and the aggregation threshold is applied to the oldest events first, exactly
 * as it would have fallen live.
 */
function groupBy(rows, keyOf) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

/** Openers used to start a thread. Short, and not about anything in particular. */
const OPENERS = [
  'Hey! Loved the last one you posted.',
  'Been following for a while, finally saying hi.',
  'Quick question about how you shot that.',
  'Your last clip made my morning.',
  'Are you posting more of these soon?',
  'That was genuinely useful, thank you.',
  'Hello! Fellow creator here.',
  'Great work on the recent series.'
];

const REPLIES = [
  'Thank you! That means a lot.',
  'Appreciate it — more coming this week.',
  'Ha, glad it landed.',
  'Yes! Working on the next one now.',
  'Thanks for watching, genuinely.',
  'Good question, I will do a longer version.',
  'Hello! Always happy to talk shop.',
  'Cheers, that made my day.'
];

const FOLLOW_UPS = [
  'Also — where do you usually shoot?',
  'Let me know if you ever collaborate.',
  'Saving this whole series.',
  'Will definitely watch the next one.',
  'Sharing this with a friend who needs it.'
];

/**
 * Create the notifications implied by the interactions already in the database.
 *
 * Reads the rows rather than the plan, so what is notified is exactly what
 * happened — and so a re-run sees the same rows and produces the same groups.
 */
async function seedNotifications({
  plan, db, ledger, notifications
}) {
  const created = {
    follow: 0, postLike: 0, commentLike: 0, postComment: 0, commentReply: 0, mention: 0
  };
  const userIds = new Map([...plan.userIds.entries()].map(([name, id]) => [String(id), name]));

  // --- follows: one reusable row per (recipient, actor)
  const follows = await db.reactions.find({
    objectType: 'creator', action: 'follow'
  }).sort({ createdAt: 1 }).toArray();
  for (const follow of follows) {
    if (!userIds.has(String(follow.objectId)) || !userIds.has(String(follow.createdBy))) continue;
    const key = `notif:follow:${follow.createdBy}->${follow.objectId}`;
    const id = await notifications.recordFollow(
      { recipientId: follow.objectId, actorId: follow.createdBy },
      follow.createdAt,
      key
    );
    if (id) created.follow += 1;
  }

  // --- post likes: ONE aggregate per post
  //
  // Grouped first, then written once. Replaying the likes one at a time would
  // both race the unique group index and reset read state on every re-run — see
  // `upsertAggregate` for what that cost.
  const postIds = await ledger.idsOf(KINDS.POST);
  const posts = await db.posts.find(
    { _id: { $in: postIds } }, { projection: { userId: 1 } }
  ).toArray();
  const postAuthor = new Map(posts.map((p) => [String(p._id), p.userId]));

  const likes = await db.reactions.find({
    objectType: 'post', action: 'like', objectId: { $in: postIds }
  }).sort({ createdAt: 1 }).toArray();
  for (const [postId, group] of groupBy(likes, (l) => String(l.objectId))) {
    const recipientId = postAuthor.get(postId);
    if (!recipientId) continue;
    const newest = group[group.length - 1];
    const id = await notifications.recordPostLikes({
      recipientId,
      latestActorId: newest.createdBy,
      postId: newest.objectId,
      latestReactionId: newest._id,
      at: newest.createdAt
    });
    if (id) created.postLike += 1;
  }

  // --- comment likes: one aggregate per comment
  const commentIds = await ledger.idsOf(KINDS.COMMENT);
  const comments = await db.comments.find({ _id: { $in: commentIds } })
    .sort({ createdAt: 1 }).toArray();
  const commentById = new Map(comments.map((c) => [String(c._id), c]));
  const postIdOfComment = (comment) => (comment.objectType === 'post'
    ? comment.objectId
    : commentById.get(String(comment.objectId))?.objectId || null);

  const commentLikes = await db.reactions.find({
    objectType: 'comment', action: 'like', objectId: { $in: commentIds }
  }).sort({ createdAt: 1 }).toArray();
  for (const [commentId, group] of groupBy(commentLikes, (l) => String(l.objectId))) {
    const comment = commentById.get(commentId);
    if (!comment) continue;
    const newest = group[group.length - 1];
    const id = await notifications.recordCommentLikes({
      recipientId: comment.createdBy,
      latestActorId: newest.createdBy,
      postId: postIdOfComment(comment),
      commentId: comment._id,
      latestReactionId: newest._id,
      at: newest.createdAt
    });
    if (id) created.commentLike += 1;
  }

  // --- comments on a post: individual rows until the threshold, then one
  //     aggregate carrying the rest. Grouped per (recipient, post), because that
  //     is what the threshold counts.
  const postComments = comments.filter((c) => c.objectType === 'post');
  for (const [postId, group] of groupBy(postComments, (c) => String(c.objectId))) {
    const recipientId = postAuthor.get(postId);
    if (!recipientId) continue;
    // A comment by the author on their own post notifies nobody, and must not
    // count towards the threshold either.
    const relevant = group.filter((c) => String(c.createdBy) !== String(recipientId));
    const individual = relevant.slice(0, notifications.COMMENT_AGGREGATION_THRESHOLD - 1);
    const aggregated = relevant.slice(notifications.COMMENT_AGGREGATION_THRESHOLD - 1);

    for (const comment of individual) {
      const id = await notifications.recordPostCommentIndividual({
        recipientId,
        actorId: comment.createdBy,
        postId: comment.objectId,
        commentId: comment._id,
        at: comment.createdAt
      });
      if (id) created.postComment += 1;
    }
    if (aggregated.length > 0) {
      const newest = aggregated[aggregated.length - 1];
      const id = await notifications.recordPostCommentAggregate({
        recipientId,
        latestActorId: newest.createdBy,
        postId: newest.objectId,
        latestCommentId: newest._id,
        activityCount: aggregated.length,
        at: newest.createdAt
      });
      if (id) created.postComment += 1;
    }
  }

  // --- replies: the same shape, grouped per thread
  const replies = comments.filter((c) => c.objectType === 'comment');
  for (const [threadId, group] of groupBy(replies, (c) => String(c.objectId))) {
    const parent = commentById.get(threadId);
    if (!parent) continue;
    const recipientId = parent.createdBy;
    const relevant = group.filter((c) => String(c.createdBy) !== String(recipientId));
    const individual = relevant.slice(0, notifications.COMMENT_AGGREGATION_THRESHOLD - 1);
    const aggregated = relevant.slice(notifications.COMMENT_AGGREGATION_THRESHOLD - 1);

    for (const reply of individual) {
      const id = await notifications.recordCommentReplyIndividual({
        recipientId,
        actorId: reply.createdBy,
        postId: postIdOfComment(parent),
        threadId: parent._id,
        replyId: reply._id,
        at: reply.createdAt
      });
      if (id) created.commentReply += 1;
    }
    if (aggregated.length > 0) {
      const newest = aggregated[aggregated.length - 1];
      const id = await notifications.recordCommentReplyAggregate({
        recipientId,
        latestActorId: newest.createdBy,
        postId: postIdOfComment(parent),
        threadId: parent._id,
        latestReplyId: newest._id,
        activityCount: aggregated.length,
        at: newest.createdAt
      });
      if (id) created.commentReply += 1;
    }
  }

  // --- mentions: from the comments that actually carry a @mention
  for (const comment of comments) {
    if (!comment.mentionedUserIds?.length) continue;
    const postId = postIdOfComment(comment);
    for (const mentioned of comment.mentionedUserIds) {
      const id = await notifications.recordCommentMention({
        recipientId: mentioned,
        actorId: comment.createdBy,
        postId,
        commentId: comment._id
      }, comment.createdAt, `notif:commentmention:${comment._id}:${mentioned}`);
      if (id) created.mention += 1;
    }
  }

  return created;
}

/**
 * Mark a deterministic share of each account's notifications read.
 *
 * Newest stay unread, because that is what an inbox looks like: somebody reads
 * down from the top and stops. Every account keeps at least one unread, which
 * `demo:verify` requires.
 */
async function applyReadState({ plan, ledger, notifications, config }) {
  const ratio = config.seed.social.notificationsReadRatio;
  let markedRead = 0;

  for (const [username, userId] of plan.userIds.entries()) {
    const rows = await notifications.collection.find(
      { recipientId: userId }, { projection: { _id: 1, lastActivityAt: 1 } }
    ).sort({ lastActivityAt: -1 }).toArray();
    if (rows.length === 0) continue;

    // Oldest first are the ones already read. At least one always stays unread.
    const readable = rows.slice(1).reverse();
    const takeCount = Math.min(readable.length, Math.floor(rows.length * ratio));
    const random = createRandom(`notif-read:${username}`);
    const ids = readable.slice(0, takeCount).map((r) => r._id);
    // A stable jitter so the read/unread split is not a clean prefix.
    if (ids.length > 2 && random.chance(0.5)) ids.pop();
    markedRead += await notifications.markRead(ids, new Date());
  }

  return markedRead;
}

/**
 * Build the conversation graph.
 *
 * A ring plus a small number of deterministic chords: linear in accounts, and
 * every account ends up with at least two threads, both directions of traffic,
 * and one unread.
 */
async function seedConversations({
  plan, db, ledger, messages, config
}) {
  const created = {
    conversations: 0, messages: 0, systemNotices: 0, sharedPosts: 0, relationships: 0
  };
  const accounts = plan.accounts;
  const now = new Date();
  const windowMs = config.seed.social.conversationWindowDays * 24 * 60 * 60 * 1000;

  const isMutual = async (a, b) => {
    const n = await db.reactions.countDocuments({
      objectType: 'creator',
      action: 'follow',
      $or: [{ createdBy: a, objectId: b }, { createdBy: b, objectId: a }]
    });
    return n >= 2;
  };

  /** One thread between two accounts, in a state the product can reach. */
  async function buildThread({
    initiator, responder, state, seedKey, sharePostId = null, unreadFor = null
  }) {
    const initiatorId = plan.userIds.get(initiator.username);
    const responderId = plan.userIds.get(responder.username);
    const random = createRandom(`conv:${seedKey}`);
    const startedAt = new Date(now.getTime() - random.int(1, config.seed.social.conversationWindowDays) * 24 * 3600000);

    const conversation = await messages.ensureConversation(
      initiatorId, responderId, startedAt, `conv:${seedKey}`
    );
    if (conversation.wasCreated) created.conversations += 1;

    let at = new Date(startedAt.getTime() + 60000);

    // A mutual-follow thread opens with the system notice, exactly as the
    // product places it when the second follow lands.
    if (state === 'mutual') {
      const noticeId = await messages.announceMutualFollow(conversation, at, `msg:${seedKey}:notice`);
      if (noticeId) created.systemNotices += 1;
      at = new Date(at.getTime() + 120000);
    }

    const send = async (fromId, toId, index, options = {}) => {
      at = new Date(Math.min(at.getTime() + random.int(3, 240) * 60000, now.getTime() - 60000));
      const id = await messages.sendMessage({
        conversation,
        senderId: fromId,
        recipientId: toId,
        at,
        seedKey: `msg:${seedKey}:${index}`,
        ...options
      });
      if (id) created.messages += 1;
      return id;
    };

    if (state === 'pending') {
      // Exactly one message. The product refuses a second until the other side
      // answers, so a pending thread with two messages is unreachable.
      await send(initiatorId, responderId, 0, { text: random.pick(OPENERS) });
      await messages.markPending(conversation._id, initiatorId, at);
      return conversation;
    }

    await send(initiatorId, responderId, 0, { text: random.pick(OPENERS) });
    await send(responderId, initiatorId, 1, { text: random.pick(REPLIES) });
    // The responder answering is what accepts the request.
    await messages.markAccepted(conversation._id, at);
    await send(initiatorId, responderId, 2, { text: random.pick(FOLLOW_UPS) });

    if (sharePostId) {
      const shared = await send(responderId, initiatorId, 3, {
        type: messages.MESSAGE_TYPES.POST, postId: sharePostId
      });
      if (shared) created.sharedPosts += 1;
    }

    // Somebody has read their side; the other has not. Which one is fixed per
    // thread so the unread counts are deterministic.
    const readerId = unreadFor && String(unreadFor) === String(initiatorId) ? responderId : initiatorId;
    await messages.markRead(conversation._id, readerId, at);
    return conversation;
  }

  // --- the ring: account i talks to i+1
  const postIdsByUser = new Map();
  for (const account of accounts) {
    postIdsByUser.set(account.username, account.posts.map((p) => p.seedKey));
  }
  const ledgerPosts = new Map();
  for (const account of accounts) {
    for (const post of account.posts) {
      const row = await ledger.find(KINDS.POST, post.seedKey);
      if (row) ledgerPosts.set(post.seedKey, row.refId);
    }
  }

  for (let i = 0; i < accounts.length; i += 1) {
    const a = accounts[i];
    const b = accounts[(i + 1) % accounts.length];
    const mutual = await isMutual(plan.userIds.get(a.username), plan.userIds.get(b.username));
    // A post of b's, so the shared card in the thread points at real content.
    const sharePostSeedKey = b.posts[0]?.seedKey;
    await buildThread({
      initiator: a,
      responder: b,
      state: mutual ? 'mutual' : 'accepted',
      seedKey: `ring:${a.username}->${b.username}`,
      sharePostId: ledgerPosts.get(sharePostSeedKey) || null,
      unreadFor: plan.userIds.get(b.username)
    });
  }

  // --- chords: account i talks to i+5, giving everyone a second thread with
  //     traffic in the other direction
  const stride = Math.max(2, Math.floor(accounts.length / 3));
  for (let i = 0; i < accounts.length; i += 1) {
    const a = accounts[i];
    const b = accounts[(i + stride) % accounts.length];
    if (a.username === b.username) continue;
    await buildThread({
      initiator: b,
      responder: a,
      state: 'accepted',
      seedKey: `chord:${b.username}->${a.username}`,
      unreadFor: plan.userIds.get(a.username)
    });
  }

  return { created, ledgerPosts };
}

/**
 * The accounts the ring and the chords already pair the primary account with.
 *
 * Derived from the plan, using the same indices `seedConversations` uses -- not
 * read back from the database. That distinction is the whole point: reading the
 * database made the answer depend on how many times the seeder had already run.
 * On a first seed the showcase found three free partners; on a second, its own
 * three threads from the first run were now "taken", so it picked three
 * *different* partners and built three more conversations, two more
 * block/restrict rows and four more messages. Counts grew on every run.
 *
 * A seeded generator's stream must depend only on the seed. So must its inputs.
 */
function ringAndChordPartnersOf(accounts, username) {
  const index = accounts.findIndex((a) => a.username === username);
  if (index === -1) return new Set();
  const n = accounts.length;
  const stride = Math.max(2, Math.floor(n / 3));
  return new Set([
    accounts[(index + 1) % n].username,      // ring: primary -> next
    accounts[(index - 1 + n) % n].username,  // ring: previous -> primary
    accounts[(index + stride) % n].username, // chord: primary paired forward
    accounts[(index - stride + n) % n].username // chord: paired from behind
  ].filter((name) => name !== username));
}

/**
 * The primary account's extra threads: one of every state a person can be shown.
 *
 * Kept separate from the ring so the ring stays a simple, uniform structure and
 * the showcase is legible as what it is.
 */
async function seedPrimaryShowcase({
  plan, db, ledger, messages, config, ledgerPosts
}) {
  const primary = plan.accounts.find((a) => a.username === config.seed.social.primaryUsername);
  if (!primary) return { pending: 0, restricted: 0, blocked: 0 };

  const primaryId = plan.userIds.get(primary.username);
  const random = createRandom(`showcase:${primary.username}`);
  const now = new Date();
  const counts = { pending: 0, restricted: 0, blocked: 0 };

  /**
   * Partners that the ring and the chords do not already pair with the primary.
   *
   * A conversation is identified by its pair, so reusing one of those pairs here
   * would apply a showcase state to a thread that already holds ordinary ring
   * messages. That produced a "pending" conversation with five messages from
   * both sides -- a state `claimSendSlot` cannot reach, and one `demo:verify`
   * correctly refused. Excluding exactly the structural pairs keeps every
   * showcase thread a clean example of one state.
   *
   * Computed from the plan, never from the conversations already in the
   * database: see `ringAndChordPartnersOf`.
   */
  const structural = ringAndChordPartnersOf(plan.accounts, primary.username);
  const available = plan.accounts.filter(
    (a) => a.username !== primary.username && !structural.has(a.username)
  );
  if (available.length < 3) {
    logger.warn(`only ${available.length} account(s) free for showcase threads; some states will be skipped`);
  }

  // A stranger's pending request sitting in the primary account's inbox.
  const pendingFrom = available[available.length - 1];
  if (pendingFrom) {
    const senderId = plan.userIds.get(pendingFrom.username);
    const at = new Date(now.getTime() - random.int(1, 6) * 24 * 3600000);
    const conversation = await messages.ensureConversation(
      senderId, primaryId, at, `conv:showcase:pending:${pendingFrom.username}`
    );
    const isNew = conversation.wasCreated;
    await messages.sendMessage({
      conversation,
      senderId,
      recipientId: primaryId,
      text: 'Hi! I make similar content, would love to swap notes sometime.',
      at: new Date(at.getTime() + 60000),
      seedKey: `msg:showcase:pending:${pendingFrom.username}:0`
    });
    await messages.markPending(conversation._id, senderId, at);
    if (isNew) counts.pending += 1;
  }

  // A restricted pair: the other account restricted the primary, so the primary
  // can no longer send into an otherwise ordinary accepted thread.
  const restrictedBy = available[available.length - 2];
  if (restrictedBy) {
    const otherId = plan.userIds.get(restrictedBy.username);
    const at = new Date(now.getTime() - random.int(10, 30) * 24 * 3600000);
    const conversation = await messages.ensureConversation(
      primaryId, otherId, at, `conv:showcase:restricted:${restrictedBy.username}`
    );
    const isNew = conversation.wasCreated;
    const lastMessageAt = new Date(at.getTime() + 3600000);
    await messages.sendMessage({
      conversation,
      senderId: primaryId,
      recipientId: otherId,
      text: 'Loved your last series!',
      at: new Date(at.getTime() + 60000),
      seedKey: `msg:showcase:restricted:${restrictedBy.username}:0`
    });
    await messages.sendMessage({
      conversation,
      senderId: otherId,
      recipientId: primaryId,
      text: 'Thanks! Bit swamped at the moment.',
      at: lastMessageAt,
      seedKey: `msg:showcase:restricted:${restrictedBy.username}:1`
    });
    await messages.markAccepted(conversation._id, at);
    // Applied *after* the conversation, which is the only order that makes
    // sense: the messages are history from before the restriction was set. A
    // flag dated earlier than the messages it is supposed to have prevented is
    // a state the product could never produce.
    await messages.setRelationship(
      otherId, primaryId, messages.RELATIONSHIP_TYPES.RESTRICT,
      new Date(lastMessageAt.getTime() + 3600000),
      `rel:restrict:${restrictedBy.username}->${primary.username}`
    );
    if (isNew) counts.restricted += 1;
  }

  // A blocked pair. The thread predates the block, which is the only way a
  // blocked conversation can have any history at all.
  const blockedBy = available[available.length - 3];
  if (blockedBy) {
    const otherId = plan.userIds.get(blockedBy.username);
    const at = new Date(now.getTime() - random.int(30, 60) * 24 * 3600000);
    const conversation = await messages.ensureConversation(
      primaryId, otherId, at, `conv:showcase:blocked:${blockedBy.username}`
    );
    const isNew = conversation.wasCreated;
    const lastMessageAt = new Date(at.getTime() + 60000);
    await messages.sendMessage({
      conversation,
      senderId: primaryId,
      recipientId: otherId,
      text: 'Hello! Quick question about your setup.',
      at: lastMessageAt,
      seedKey: `msg:showcase:blocked:${blockedBy.username}:0`
    });
    await messages.markPending(conversation._id, primaryId, at);
    await messages.setRelationship(
      otherId, primaryId, messages.RELATIONSHIP_TYPES.BLOCK,
      new Date(lastMessageAt.getTime() + 24 * 3600000),
      `rel:block:${blockedBy.username}->${primary.username}`
    );
    if (isNew) counts.blocked += 1;
  }

  void ledgerPosts;
  void db;
  void ledger;
  return counts;
}

async function seedSocial({
  plan, db, ledger, notifications, messages, config
}) {
  logger.detail('notifications from existing interactions…');
  const notificationCounts = await seedNotifications({
    plan, db, ledger, notifications
  });

  logger.detail('conversations (ring + chords)…');
  const { created: conversationCounts, ledgerPosts } = await seedConversations({
    plan, db, ledger, messages, config
  });

  logger.detail('primary account showcase threads…');
  const showcase = await seedPrimaryShowcase({
    plan, db, ledger, messages, config, ledgerPosts
  });

  logger.detail('notification read state…');
  const markedRead = await applyReadState({
    plan, ledger, notifications, config
  });

  return {
    notifications: notificationCounts, conversations: conversationCounts, showcase, markedRead
  };
}

module.exports = {
  seedSocial,
  seedNotifications,
  seedConversations,
  seedPrimaryShowcase,
  applyReadState,
  ringAndChordPartnersOf
};
