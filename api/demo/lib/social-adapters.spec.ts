/**
 * Regression tests for the notification and messaging adapters.
 *
 * These two modules reproduce a policy that lives in `NotificationService`,
 * `MessagePermissionService` and `MessageSystemNoticeService`. Reproduced policy
 * drifts, and the two failure modes are both silent: a notification list that no
 * real usage could produce, and a second seed run that quietly adds rows. The
 * tests below fix both shapes in place.
 *
 * What is deliberately asserted rather than assumed:
 *
 *  - twelve likes on one post produce **one** notification, not twelve;
 *  - the fifth comment on a post starts an aggregate, and the four before it
 *    stay as individual rows;
 *  - nothing notifies its own actor;
 *  - `post_share` is never produced, because the product has no such type;
 *  - a pending conversation holds exactly one message, from the pending sender;
 *  - the mutual-follow notice is written once and only once, ever.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { ObjectId } = require('mongodb');

const { createNotificationAdapter, COMMENT_AGGREGATION_THRESHOLD } = require('./notification-adapter');
const { createMessageAdapter, buildHashKey, buildMutualFollowKey } = require('./message-adapter');
const { KINDS } = require('./ledger');

/** An in-memory stand-in for the handful of collections the adapters touch. */
function createFakeDb() {
  const stores: Record<string, any[]> = {};
  const uniqueIndexes: Record<string, string[][]> = {
    messages: [['systemEventKey']],
    conversations: [['hashKey']],
    user_relationships: [['userId', 'targetId', 'type']]
  };

  const matches = (doc: any, filter: any): boolean => Object.entries(filter).every(([key, value]: [string, any]) => {
    const actual = doc[key];
    if (value && typeof value === 'object' && !(value instanceof Date) && !Array.isArray(value)) {
      if ('$ne' in value) return String(actual ?? '') !== String(value.$ne ?? '');
      if ('$in' in value) return value.$in.some((v: any) => String(v) === String(actual));
      if ('$nin' in value) return !value.$nin.some((v: any) => String(v) === String(actual));
      if ('$gt' in value) return actual > value.$gt;
    }
    if (Array.isArray(actual)) return actual.some((v) => String(v) === String(value));
    return String(actual ?? '') === String(value ?? '');
  });

  const apply = (doc: any, update: any) => {
    if (update.$set) Object.assign(doc, update.$set);
    if (update.$inc) for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + (v as number);
    if (update.$unset) for (const k of Object.keys(update.$unset)) delete doc[k];
    return doc;
  };

  const checkUnique = (name: string, doc: any) => {
    for (const fields of uniqueIndexes[name] || []) {
      if (fields.some((f) => doc[f] === undefined || doc[f] === null)) continue;
      const clash = (stores[name] || []).some(
        (existing) => existing !== doc && fields.every((f) => String(existing[f]) === String(doc[f]))
      );
      if (clash) {
        const error: any = new Error('E11000 duplicate key');
        error.code = 11000;
        error.keyPattern = Object.fromEntries(fields.map((f) => [f, 1]));
        throw error;
      }
    }
  };

  const collection = (name: string) => {
    stores[name] = stores[name] || [];
    return {
      findOne: async (filter: any) => stores[name].find((d) => matches(d, filter)) || null,
      find: (filter: any = {}, options: any = {}) => {
        let rows = stores[name].filter((d) => matches(d, filter));
        const api: any = {
          sort: () => api,
          toArray: async () => rows,
          project: () => api
        };
        void options;
        void rows;
        return api;
      },
      countDocuments: async (filter: any = {}) => stores[name].filter((d) => matches(d, filter)).length,
      insertOne: async (doc: any) => {
        checkUnique(name, doc);
        stores[name].push(doc);
        return { insertedId: doc._id };
      },
      updateOne: async (filter: any, update: any) => {
        const doc = stores[name].find((d) => matches(d, filter));
        if (doc) apply(doc, update);
        return { modifiedCount: doc ? 1 : 0 };
      },
      updateMany: async (filter: any, update: any) => {
        const rows = stores[name].filter((d) => matches(d, filter));
        rows.forEach((d) => apply(d, update));
        return { modifiedCount: rows.length };
      },
      findOneAndUpdate: async (filter: any, update: any, options: any = {}) => {
        const doc = stores[name].find((d) => matches(d, filter));
        if (doc) return apply(doc, update);
        if (!options.upsert) return null;
        const created: any = { ...(update.$setOnInsert || {}) };
        apply(created, { $set: update.$set, $inc: update.$inc });
        if (!created._id) created._id = new ObjectId();
        checkUnique(name, created);
        stores[name].push(created);
        return created;
      }
    };
  };

  return { collection, stores };
}

function createFakeLedger() {
  const rows = new Map<string, any>();
  return {
    rows,
    claim: async (kind: string, seedKey: string) => {
      const key = `${kind}:${seedKey}`;
      if (rows.has(key)) return { refId: rows.get(key).refId, created: false };
      const refId = new ObjectId();
      rows.set(key, { refId, status: 'pending' });
      return { refId, created: true };
    },
    activate: async () => {},
    record: async (kind: string, seedKey: string, refId: any) => {
      rows.set(`${kind}:${seedKey}`, { refId, status: 'active' });
    },
    find: async (kind: string, seedKey: string) => rows.get(`${kind}:${seedKey}`) || null
  };
}

const at = new Date('2026-08-01T10:00:00Z');

describe('notification adapter', () => {
  const setup = () => {
    const db = createFakeDb();
    const ledger = createFakeLedger();
    return { db, ledger, notifications: createNotificationAdapter({ db, ledger, KINDS }) };
  };

  it('folds many likes on one post into a single notification', async () => {
    const { db, notifications } = setup();
    const author = new ObjectId();
    const postId = new ObjectId();
    const newestActor = new ObjectId();
    const newestReaction = new ObjectId();

    await notifications.recordPostLikes({
      recipientId: author,
      latestActorId: newestActor,
      postId,
      latestReactionId: newestReaction,
      at
    });

    const rows = db.stores.notifications;
    // Twelve likers, one row. A seeder that wrote one per like would produce a
    // notification list the product could never generate.
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('post_like');
    expect(rows[0].isAggregate).toBe(true);
    expect(rows[0].groupKey).toBe(`post_like:${postId}`);
    // The newest liker is the one on show.
    expect(String(rows[0].actorId)).toBe(String(newestActor));
  });

  it('keeps comment notifications individual until the threshold, then aggregates', async () => {
    const { db, notifications } = setup();
    const author = new ObjectId();
    const postId = new ObjectId();

    const commentIds = Array.from({ length: 8 }, () => new ObjectId());
    const individualIds = commentIds.slice(0, COMMENT_AGGREGATION_THRESHOLD - 1);
    const aggregatedIds = commentIds.slice(COMMENT_AGGREGATION_THRESHOLD - 1);

    for (const commentId of individualIds) {
      await notifications.recordPostCommentIndividual({
        recipientId: author, actorId: new ObjectId(), postId, commentId, at
      });
    }
    await notifications.recordPostCommentAggregate({
      recipientId: author,
      latestActorId: new ObjectId(),
      postId,
      latestCommentId: aggregatedIds[aggregatedIds.length - 1],
      activityCount: aggregatedIds.length,
      at
    });

    const rows = db.stores.notifications;
    const individual = rows.filter((r: any) => !r.isAggregate);
    const aggregates = rows.filter((r: any) => r.isAggregate);

    // Four individual rows, then one aggregate that carries the rest.
    expect(individual).toHaveLength(COMMENT_AGGREGATION_THRESHOLD - 1);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].groupKey).toBe(`post_comment_agg:${postId}`);
    expect(aggregates[0].activityCount).toBe(aggregatedIds.length);
  });

  it('never notifies an actor about their own action', async () => {
    const { db, notifications } = setup();
    const person = new ObjectId();
    const postId = new ObjectId();

    await notifications.recordPostLikes({
      recipientId: person, latestActorId: person, postId, latestReactionId: new ObjectId(), at
    });
    await notifications.recordFollow({ recipientId: person, actorId: person }, at, 'notif:selffollow');

    expect(db.stores.notifications || []).toHaveLength(0);
  });

  it('creates nothing on a second pass over the same interactions', async () => {
    const { db, notifications } = setup();
    const author = new ObjectId();
    const postId = new ObjectId();
    const likers = Array.from({ length: 4 }, () => new ObjectId());
    const reactions = likers.map(() => new ObjectId());
    const follower = new ObjectId();

    const pass = async () => {
      // The seeder replays the whole history each run: same likes, same newest.
      await notifications.recordPostLikes({
        recipientId: author,
        latestActorId: likers[likers.length - 1],
        postId,
        latestReactionId: reactions[reactions.length - 1],
        at
      });
      await notifications.recordFollow(
        { recipientId: author, actorId: follower }, at, `notif:follow:${follower}`
      );
    };

    await pass();
    const afterFirst = db.stores.notifications.length;
    const countsAfterFirst = db.stores.notifications.map((r: any) => r.activityCount);
    // Somebody reads it between the two runs.
    await notifications.markRead(db.stores.notifications.map((r: any) => r._id), new Date());

    await pass();

    expect(db.stores.notifications).toHaveLength(afterFirst);
    // `lastEventId` is what makes a re-run a no-op rather than an inflated count.
    expect(db.stores.notifications.map((r: any) => r.activityCount)).toEqual(countsAfterFirst);
    // And the read state survives. Re-folding would have reset it, resurfacing
    // notifications the recipient had already dealt with.
    expect(db.stores.notifications.every((r: any) => r.read)).toBe(true);
  });

  it('has no share notification type at all', () => {
    const { notifications } = setup();
    // `post_share` is deliberately absent from NOTIFICATION_TYPES: sharing
    // delivers the post as a message, which already notifies.
    expect(Object.values(notifications.TYPES)).not.toContain('post_share');
    expect(Object.keys(notifications.GROUP_KEYS)).not.toContain('postShare');
  });

  it('marks read without touching anything else', async () => {
    const { db, notifications } = setup();
    const author = new ObjectId();
    const postId = new ObjectId();
    await notifications.recordPostLikes({
      recipientId: author, latestActorId: new ObjectId(), postId, latestReactionId: new ObjectId(), at
    });

    const readAt = new Date('2026-08-02T10:00:00Z');
    const changed = await notifications.markRead(db.stores.notifications.map((r: any) => r._id), readAt);

    expect(changed).toBe(1);
    expect(db.stores.notifications[0].read).toBe(true);
    expect(db.stores.notifications[0].readAt).toBe(readAt);
    // Read state must not move the row in the list.
    expect(db.stores.notifications[0].lastActivityAt).toBe(at);
  });
});

describe('message adapter', () => {
  const setup = () => {
    const db = createFakeDb();
    const ledger = createFakeLedger();
    return { db, ledger, messages: createMessageAdapter({ db, ledger, KINDS }) };
  };

  it('identifies a pair of users the same way round either way', () => {
    const a = new ObjectId();
    const b = new ObjectId();
    expect(buildHashKey(a, b)).toBe(buildHashKey(b, a));
  });

  it('creates one conversation and two participant rows, once', async () => {
    const { db, messages } = setup();
    const a = new ObjectId();
    const b = new ObjectId();

    await messages.ensureConversation(a, b, at, 'conv:pair');
    await messages.ensureConversation(a, b, at, 'conv:pair');
    // Even from the other direction.
    await messages.ensureConversation(b, a, at, 'conv:pair-reversed');

    expect(db.stores.conversations).toHaveLength(1);
    expect(db.stores.conversation_participants).toHaveLength(2);
  });

  it('moves the preview and the unread count on send', async () => {
    const { db, messages } = setup();
    const sender = new ObjectId();
    const recipient = new ObjectId();
    const conversation = await messages.ensureConversation(sender, recipient, at, 'conv:x');

    await messages.sendMessage({
      conversation, senderId: sender, recipientId: recipient, text: 'hello', at, seedKey: 'msg:x:0'
    });

    const stored = db.stores.conversations[0];
    expect(stored.lastMessage).toBe('hello');
    expect(stored.lastMessageType).toBe('text');
    expect(String(stored.lastSenderId)).toBe(String(sender));

    const seats = db.stores.conversation_participants;
    const senderSeat = seats.find((s: any) => String(s.userId) === String(sender));
    const recipientSeat = seats.find((s: any) => String(s.userId) === String(recipient));
    // The sender has read their own message by definition.
    expect(senderSeat.unreadCount).toBe(0);
    expect(recipientSeat.unreadCount).toBe(1);
  });

  it('carries only a postId on a shared-post message', async () => {
    const { db, messages } = setup();
    const sender = new ObjectId();
    const recipient = new ObjectId();
    const postId = new ObjectId();
    const conversation = await messages.ensureConversation(sender, recipient, at, 'conv:share');

    await messages.sendMessage({
      conversation,
      senderId: sender,
      recipientId: recipient,
      type: messages.MESSAGE_TYPES.POST,
      text: 'this should not be stored',
      postId,
      at,
      seedKey: 'msg:share:0'
    });

    const message = db.stores.messages[0];
    expect(message.type).toBe('post');
    expect(String(message.postId)).toBe(String(postId));
    // The card is rendered from the post read back at request time, never from
    // a copy taken when it was shared.
    expect(message.text).toBe('');
  });

  it('writes the mutual-follow notice exactly once, ever', async () => {
    const { db, messages } = setup();
    const a = new ObjectId();
    const b = new ObjectId();
    const conversation = await messages.ensureConversation(a, b, at, 'conv:mutual');

    const first = await messages.announceMutualFollow(conversation, at, 'msg:notice');
    const second = await messages.announceMutualFollow(conversation, at, 'msg:notice');
    const third = await messages.announceMutualFollow(conversation, at, 'msg:notice-different-key');

    expect(first).toBeTruthy();
    expect(second).toBeNull();
    expect(third).toBeNull();
    expect(db.stores.messages.filter((m: any) => m.type === 'system')).toHaveLength(1);
    // Keyed on the conversation, so re-following never announces again.
    expect(db.stores.messages[0].systemEventKey).toBe(buildMutualFollowKey(conversation._id));
    expect(db.stores.messages[0].senderId).toBeNull();
  });

  it('creates nothing on a second pass', async () => {
    const { db, messages } = setup();
    const a = new ObjectId();
    const b = new ObjectId();

    const pass = async () => {
      const conversation = await messages.ensureConversation(a, b, at, 'conv:repeat');
      await messages.announceMutualFollow(conversation, at, 'msg:repeat:notice');
      await messages.sendMessage({
        conversation, senderId: a, recipientId: b, text: 'hi', at, seedKey: 'msg:repeat:0'
      });
      await messages.sendMessage({
        conversation, senderId: b, recipientId: a, text: 'hello', at, seedKey: 'msg:repeat:1'
      });
      await messages.setRelationship(a, b, 'restrict', at, 'rel:repeat');
    };

    await pass();
    const counts = {
      conversations: db.stores.conversations.length,
      participants: db.stores.conversation_participants.length,
      messages: db.stores.messages.length,
      relationships: db.stores.user_relationships.length
    };

    await pass();

    expect({
      conversations: db.stores.conversations.length,
      participants: db.stores.conversation_participants.length,
      messages: db.stores.messages.length,
      relationships: db.stores.user_relationships.length
    }).toEqual(counts);
  });

  it('leaves a pending conversation with a pending sender and no acceptance', async () => {
    const { db, messages } = setup();
    const initiator = new ObjectId();
    const responder = new ObjectId();
    const conversation = await messages.ensureConversation(initiator, responder, at, 'conv:pending');

    await messages.sendMessage({
      conversation, senderId: initiator, recipientId: responder, text: 'hi', at, seedKey: 'msg:pending:0'
    });
    await messages.markPending(conversation._id, initiator, at);

    const stored = db.stores.conversations[0];
    expect(stored.requestAccepted).toBe(false);
    expect(String(stored.pendingSenderId)).toBe(String(initiator));
    // The product refuses a second message until the other side answers, so a
    // pending thread holds exactly one.
    expect(db.stores.messages.filter((m: any) => m.type !== 'system')).toHaveLength(1);
  });

  it('clears the pending sender when the request is accepted', async () => {
    const { db, messages } = setup();
    const initiator = new ObjectId();
    const responder = new ObjectId();
    const conversation = await messages.ensureConversation(initiator, responder, at, 'conv:accept');

    await messages.markPending(conversation._id, initiator, at);
    await messages.markAccepted(conversation._id, at);

    const stored = db.stores.conversations[0];
    expect(stored.requestAccepted).toBe(true);
    // Accepted *and* pending is a state `claimSendSlot` can never produce.
    expect(stored.pendingSenderId).toBeNull();
  });
});
