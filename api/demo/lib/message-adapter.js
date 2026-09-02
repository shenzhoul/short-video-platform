/**
 * The single place the demo seeder writes conversations and messages.
 *
 * Same reasoning as `notification-adapter.js`: the production services are
 * Nest-decorated TypeScript the seeder cannot call, so their persistence
 * contract is reproduced once, here, rather than scattered across the seed
 * modules as raw inserts.
 *
 * ## The permission model, and the states that are actually reachable
 *
 * From `MessagePermissionService.claimSendSlot`, in its own order of precedence:
 *
 * 1. **blocked** — either direction, nothing can be sent.
 * 2. **restricted** — the recipient restricted the sender; the sender is refused.
 * 3. **accepted** — `requestAccepted: true`; both sides send freely.
 * 4. **mutual follow** — bypasses the request flow entirely; both sides send
 *    freely and the thread carries a `mutual_follow` system notice.
 * 5. **pending** — a one-sided initiator has sent, `pendingSenderId` names them,
 *    and they may not send again until the other side answers. The answer is
 *    what sets `requestAccepted: true` and clears `pendingSenderId`.
 *
 * The seeder only ever produces those five. A conversation with a pending sender
 * *and* `requestAccepted: true`, or a pending thread where the initiator sent
 * twice, is a state the product cannot reach — seeding one would make the UI
 * look right while testing something that can never happen.
 *
 * ## Counters
 *
 * `unreadCount`, `lastMessageAt` and `lastReadAt` on `conversation_participants`
 * and the `lastMessage*` preview on `conversations` are maintained here exactly
 * as `ConversationParticipantService` maintains them: the sender's row is
 * cleared and marked read, the recipient's is incremented. They are then
 * recomputed from the messages at the end of the seed, for the same reason every
 * other counter is — see `reconcile.js`.
 */

const { ObjectId } = require('mongodb');

/** `MESSAGE_TYPES` in api/src/common/constants/community.ts. */
const MESSAGE_TYPES = Object.freeze({
  TEXT: 'text', IMAGE: 'image', VIDEO: 'video', POST: 'post', SYSTEM: 'system'
});

/** `MESSAGE_SYSTEM_EVENTS`. */
const SYSTEM_EVENTS = Object.freeze({ MUTUAL_FOLLOW: 'mutual_follow' });

/** `RELATIONSHIP_TYPE_LIST` values used here. */
const RELATIONSHIP_TYPES = Object.freeze({ BLOCK: 'block', RESTRICT: 'restrict' });

/**
 * `ConversationService.buildHashKey` — sorted so the pair identifies one
 * conversation whichever way round it is opened.
 */
const buildHashKey = (a, b) => [String(a), String(b)].sort().join('_');

/**
 * `MessageSystemNoticeService.buildMutualFollowKey`.
 *
 * Keyed on the conversation, not on the follow rows, which is what makes it
 * stable: re-following after an unfollow announces nothing, and a second seed
 * run computes the same key and is refused by the unique index.
 */
const buildMutualFollowKey = (conversationId) => `${SYSTEM_EVENTS.MUTUAL_FOLLOW}:${String(conversationId)}`;

function createMessageAdapter({ db, ledger, KINDS }) {
  const conversations = db.collection('conversations');
  const participants = db.collection('conversation_participants');
  const messages = db.collection('messages');
  const relationships = db.collection('user_relationships');

  /**
   * Find or create the direct conversation between two users, with both
   * participant rows. Mirrors `findOrCreateDirectConversation`.
   */
  async function ensureConversation(userA, userB, createdAt, seedKey) {
    const hashKey = buildHashKey(userA, userB);
    const existing = await conversations.findOne({ hashKey });
    if (existing) {
      await ensureParticipants(existing._id, [userA, userB], existing.createdAt || createdAt, seedKey);
      // `wasCreated` is how the caller reports honestly on a re-run. Attached to
      // the document rather than returned alongside it so every existing call
      // site keeps working with the conversation itself.
      return Object.assign(existing, { wasCreated: false });
    }

    const claim = await ledger.claim(KINDS.CONVERSATION, seedKey, { hashKey });
    const document = {
      _id: claim.refId,
      hashKey,
      recipientIds: [new ObjectId(String(userA)), new ObjectId(String(userB))],
      pendingSenderId: null,
      requestAccepted: false,
      lastMessage: '',
      lastMessageType: null,
      lastSenderId: null,
      lastMessageCreatedAt: null,
      createdAt,
      updatedAt: createdAt
    };
    try {
      await conversations.insertOne(document);
      await ledger.activate(KINDS.CONVERSATION, seedKey);
    } catch (error) {
      // Narrowly: a duplicate on the hashKey index means the conversation is
      // already there, which is success. Any other 11000 is a different problem.
      if (error?.code !== 11000) throw error;
      const winner = await conversations.findOne({ hashKey });
      if (!winner) throw error;
      await ensureParticipants(winner._id, [userA, userB], winner.createdAt || createdAt, seedKey);
      return Object.assign(winner, { wasCreated: false });
    }

    await ensureParticipants(claim.refId, [userA, userB], createdAt, seedKey);
    return Object.assign(document, { wasCreated: true });
  }

  /**
   * Both people get a participant row when the conversation is created, not when
   * the first message is sent — the conversation list is built from these rows.
   */
  async function ensureParticipants(conversationId, userIds, at, seedKey) {
    for (const userId of userIds) {
      const key = `${seedKey}:participant:${String(userId)}`;
      const existing = await participants.findOne({
        conversationId: new ObjectId(String(conversationId)), userId: new ObjectId(String(userId))
      });
      if (existing) continue;
      const claim = await ledger.claim(KINDS.CONVERSATION_PARTICIPANT, key, {});
      await participants.insertOne({
        _id: claim.refId,
        conversationId: new ObjectId(String(conversationId)),
        userId: new ObjectId(String(userId)),
        unreadCount: 0,
        lastMessageAt: at,
        lastReadAt: null,
        createdAt: at,
        updatedAt: at
      });
      await ledger.activate(KINDS.CONVERSATION_PARTICIPANT, key);
    }
  }

  /**
   * Append one message and move every counter the send path moves.
   *
   * `kind` is `text` or `post`; a `post` message carries only `postId`, because
   * the card is rendered from the post read back at request time rather than
   * from a copy taken when it was shared.
   */
  async function sendMessage({
    conversation, senderId, recipientId, type = MESSAGE_TYPES.TEXT, text = '', postId = null, at, seedKey
  }) {
    const claim = await ledger.claim(KINDS.MESSAGE, seedKey, { type });
    // `null` for a message a previous run already wrote, so the caller's counts
    // describe what this run did rather than what the dataset contains. Also
    // stops the preview and unread counters below from being reapplied.
    if (await messages.findOne({ _id: claim.refId })) return null;

    await messages.insertOne({
      _id: claim.refId,
      conversationId: conversation._id,
      senderId: new ObjectId(String(senderId)),
      type,
      text: type === MESSAGE_TYPES.POST ? '' : text,
      fileIds: [],
      postId: postId ? new ObjectId(String(postId)) : null,
      createdAt: at,
      updatedAt: at
    });
    await ledger.activate(KINDS.MESSAGE, seedKey);

    // Conversation preview.
    await conversations.updateOne({ _id: conversation._id }, {
      $set: {
        lastMessage: type === MESSAGE_TYPES.POST ? '' : text,
        lastMessageType: type,
        lastSenderId: new ObjectId(String(senderId)),
        lastMessageCreatedAt: at,
        updatedAt: at
      }
    });

    // The sender has by definition read their own message.
    await participants.updateOne(
      { conversationId: conversation._id, userId: new ObjectId(String(senderId)) },
      { $set: { lastMessageAt: at, lastReadAt: at, unreadCount: 0, updatedAt: at } }
    );
    await participants.updateOne(
      { conversationId: conversation._id, userId: new ObjectId(String(recipientId)) },
      { $inc: { unreadCount: 1 }, $set: { lastMessageAt: at, updatedAt: at } }
    );

    return claim.refId;
  }

  /**
   * Place the mutual-follow notice, once per conversation, ever.
   *
   * `systemEventKey` is unique and keyed on the conversation, so a second seed
   * run is refused by the index rather than adding a duplicate notice. The
   * notice deliberately moves no counter: it is not activity, and a conversation
   * must not resurface because the notice was written.
   */
  async function announceMutualFollow(conversation, at, seedKey) {
    const existing = await messages.findOne({
      conversationId: conversation._id,
      type: MESSAGE_TYPES.SYSTEM,
      systemEvent: SYSTEM_EVENTS.MUTUAL_FOLLOW
    });
    // `null`, matching `MessageSystemNoticeService`: an already-announced thread
    // is a complete no-op. Returning the existing id would be truthy, and the
    // caller counts truthy results — so a second seed run would report notices
    // it did not write.
    if (existing) return null;

    const claim = await ledger.claim(KINDS.MESSAGE, seedKey, { type: 'system' });
    try {
      await messages.insertOne({
        _id: claim.refId,
        conversationId: conversation._id,
        senderId: null,
        type: MESSAGE_TYPES.SYSTEM,
        systemEvent: SYSTEM_EVENTS.MUTUAL_FOLLOW,
        systemEventKey: buildMutualFollowKey(conversation._id),
        text: '',
        fileIds: [],
        postId: null,
        createdAt: at,
        updatedAt: at
      });
    } catch (error) {
      // Narrowed to this index: another writer announced the same transition.
      if (error?.code === 11000 && error?.keyPattern?.systemEventKey) return null;
      throw error;
    }
    await ledger.activate(KINDS.MESSAGE, seedKey);
    return claim.refId;
  }

  /** Mark a conversation open for both sides — the accepted state. */
  const markAccepted = (conversationId, at) => conversations.updateOne(
    { _id: conversationId },
    { $set: { requestAccepted: true, pendingSenderId: null, updatedAt: at } }
  );

  /** Leave the initiator waiting — the pending state. */
  const markPending = (conversationId, senderId, at) => conversations.updateOne(
    { _id: conversationId },
    {
      $set: {
        requestAccepted: false, pendingSenderId: new ObjectId(String(senderId)), updatedAt: at
      }
    }
  );

  /** Mark one participant's side read, as opening the thread would. */
  const markRead = (conversationId, userId, at) => participants.updateOne(
    { conversationId, userId: new ObjectId(String(userId)) },
    { $set: { unreadCount: 0, lastReadAt: at, updatedAt: at } }
  );

  /** One-way relationship flag: block or restrict. */
  async function setRelationship(userId, targetId, type, at, seedKey) {
    const existing = await relationships.findOne({
      userId: new ObjectId(String(userId)), targetId: new ObjectId(String(targetId)), type
    });
    if (existing) return existing._id;

    const claim = await ledger.claim(KINDS.RELATIONSHIP, seedKey, { type });
    try {
      await relationships.insertOne({
        _id: claim.refId,
        userId: new ObjectId(String(userId)),
        targetId: new ObjectId(String(targetId)),
        type,
        createdAt: at,
        updatedAt: at
      });
    } catch (error) {
      if (error?.code === 11000) return null;
      throw error;
    }
    await ledger.activate(KINDS.RELATIONSHIP, seedKey);
    return claim.refId;
  }

  return {
    MESSAGE_TYPES,
    SYSTEM_EVENTS,
    RELATIONSHIP_TYPES,
    buildHashKey,
    buildMutualFollowKey,
    ensureConversation,
    sendMessage,
    announceMutualFollow,
    markAccepted,
    markPending,
    markRead,
    setRelationship,
    collections: {
      conversations, participants, messages, relationships
    }
  };
}

module.exports = {
  createMessageAdapter,
  MESSAGE_TYPES,
  SYSTEM_EVENTS,
  RELATIONSHIP_TYPES,
  buildHashKey,
  buildMutualFollowKey
};
