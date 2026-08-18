import { ObjectId } from 'mongodb';
import {
  NOTIFICATION_GROUP_KEYS,
  NOTIFICATION_POLICY,
  NOTIFICATION_TYPES
} from 'src/common/constants';

import { InMemoryNotificationModel } from './notification-model.testing';
import { NotificationService } from './notification.service';

/**
 * The write policies, exercised against a model that implements the MongoDB
 * semantics they rely on rather than a call recorder — so the assertions below
 * are about persisted state, not about which method happened to be invoked.
 */

function createSubject(options: { posts?: any[]; comments?: any[] } = {}) {
  const notificationModel = new InMemoryNotificationModel();
  const postModel = {
    find: () => ({ select: () => ({ lean: async () => options.posts || [] }) })
  };
  const commentModel = {
    find: () => ({ select: () => ({ lean: async () => options.comments || [] }) })
  };
  const baseUserService = { findByIds: jest.fn().mockResolvedValue([]) };
  const followService = { getFollowingCreatorIdSet: jest.fn().mockResolvedValue(new Set()) };
  const queueMessageService = { publish: jest.fn().mockResolvedValue(undefined) };

  const service = new NotificationService(
    notificationModel as any,
    postModel as any,
    commentModel as any,
    baseUserService as any,
    followService as any,
    queueMessageService as any
  );

  return {
    service, notificationModel, queueMessageService
  };
}

/** How many realtime deliveries were published. */
function deliveries(queueMessageService: { publish: jest.Mock }) {
  return queueMessageService.publish.mock.calls.length;
}

const recipient = new ObjectId();
const postId = new ObjectId();
const commentId = new ObjectId();
const actorB = new ObjectId();
const actorC = new ObjectId();
const actorD = new ObjectId();
const actorE = new ObjectId();

const postLikeKey = NOTIFICATION_GROUP_KEYS.postLike(postId.toString());

function likeOptions(actorId: ObjectId, eventId: ObjectId) {
  return {
    recipientId: recipient,
    actorId,
    type: NOTIFICATION_TYPES.POST_LIKE,
    groupKey: postLikeKey,
    postId,
    eventId
  };
}

describe('POST_LIKE aggregation', () => {
  it('keeps one row per recipient and post however many people like it', async () => {
    const { service, notificationModel } = createSubject();

    await service.aggregate(likeOptions(actorB, new ObjectId()));
    const firstId = notificationModel.docs[0]._id.toString();
    await service.aggregate(likeOptions(actorC, new ObjectId()));
    await service.aggregate(likeOptions(actorD, new ObjectId()));

    expect(notificationModel.byGroupKey(postLikeKey)).toHaveLength(1);
    // The same document throughout, so the panel never grows a row per liker.
    expect(notificationModel.docs[0]._id.toString()).toBe(firstId);
  });

  it('shows the most recent liker and advances the activity time', async () => {
    const { service, notificationModel } = createSubject();

    await service.aggregate(likeOptions(actorB, new ObjectId()));
    const afterFirst = new Date(notificationModel.docs[0].lastActivityAt).getTime();

    await new Promise((resolve) => { setTimeout(resolve, 5); });
    await service.aggregate(likeOptions(actorD, new ObjectId()));

    expect(notificationModel.docs[0].actorId.toString()).toBe(actorD.toString());
    expect(new Date(notificationModel.docs[0].lastActivityAt).getTime())
      .toBeGreaterThan(afterFirst);
  });

  it('resurfaces a group the recipient had already read', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();
    await service.aggregate(likeOptions(actorB, new ObjectId()));

    notificationModel.docs[0].read = true;
    notificationModel.docs[0].readAt = new Date();
    const deliveredBefore = deliveries(queueMessageService);

    await service.aggregate(likeOptions(actorE, new ObjectId()));

    expect(notificationModel.docs[0].read).toBe(false);
    expect(notificationModel.docs[0].readAt).toBeNull();
    expect(deliveries(queueMessageService)).toBe(deliveredBefore + 1);
  });

  it('never counts likers on the row itself', async () => {
    const { service, notificationModel } = createSubject();

    await service.aggregate(likeOptions(actorB, new ObjectId()));
    await service.aggregate(likeOptions(actorC, new ObjectId()));

    // The count is derived from the post's own like statistic at read time, so
    // nothing unbounded is written and a like/unlike toggle cannot inflate it.
    expect(notificationModel.docs[0].activityCount).toBe(1);
  });

  it('keeps different posts and different recipients apart', async () => {
    const { service, notificationModel } = createSubject();
    const otherPost = new ObjectId();

    await service.aggregate(likeOptions(actorB, new ObjectId()));
    await service.aggregate({
      ...likeOptions(actorB, new ObjectId()),
      postId: otherPost,
      groupKey: NOTIFICATION_GROUP_KEYS.postLike(otherPost.toString())
    });
    await service.aggregate({
      ...likeOptions(actorB, new ObjectId()),
      recipientId: new ObjectId()
    });

    expect(notificationModel.docs).toHaveLength(3);
  });

  it('never notifies someone about their own like', async () => {
    const { service, notificationModel } = createSubject();

    await service.aggregate({ ...likeOptions(recipient as any, new ObjectId()) });

    expect(notificationModel.docs).toHaveLength(0);
  });
});

describe('POST_LIKE retry idempotency', () => {
  it('does not count or resurface a redelivered like event', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();
    const reactionId = new ObjectId();

    await service.aggregate(likeOptions(actorB, reactionId));
    notificationModel.docs[0].read = true;
    const deliveredBefore = deliveries(queueMessageService);
    const activityBefore = notificationModel.docs[0].lastActivityAt;

    const replayed = await service.aggregate(likeOptions(actorB, reactionId));

    expect(replayed).toBeNull();
    expect(notificationModel.docs).toHaveLength(1);
    // A queue retry must not undo the recipient having read it.
    expect(notificationModel.docs[0].read).toBe(true);
    expect(notificationModel.docs[0].lastActivityAt).toBe(activityBefore);
    expect(deliveries(queueMessageService)).toBe(deliveredBefore);
  });

  it('still counts a genuinely different event from the same actor', async () => {
    const { service, notificationModel } = createSubject();

    await service.aggregate(likeOptions(actorB, new ObjectId()));
    await service.aggregate(likeOptions(actorB, new ObjectId()));

    expect(notificationModel.docs).toHaveLength(1);
    expect(notificationModel.docs[0].read).toBe(false);
  });
});

describe('aggregate concurrency', () => {
  it('produces one row when the first two events race', async () => {
    const { service, notificationModel } = createSubject();

    await Promise.all([
      service.aggregate(likeOptions(actorB, new ObjectId())),
      service.aggregate(likeOptions(actorC, new ObjectId())),
      service.aggregate(likeOptions(actorD, new ObjectId()))
    ]);

    expect(notificationModel.byGroupKey(postLikeKey)).toHaveLength(1);
  });

  it('loses no event when an insert collides, because the retry increments', async () => {
    const { service, notificationModel } = createSubject();
    const aggregateKey = NOTIFICATION_GROUP_KEYS.postCommentAggregate(postId.toString());

    // Model a lost race: the row appears between this caller's filter miss and
    // its insert, exactly as a concurrent writer would cause.
    notificationModel.onBeforeInsert = () => {
      notificationModel.onBeforeInsert = null;
      notificationModel.docs.push({
        _id: new ObjectId(),
        recipientId: recipient,
        groupKey: aggregateKey,
        type: NOTIFICATION_TYPES.POST_COMMENT,
        isAggregate: true,
        activityCount: 1,
        lastEventId: new ObjectId()
      });
    };

    await service.aggregate({
      recipientId: recipient,
      actorId: actorB,
      type: NOTIFICATION_TYPES.POST_COMMENT,
      groupKey: aggregateKey,
      postId,
      eventId: new ObjectId(),
      countsActivity: true
    });

    const rows = notificationModel.byGroupKey(aggregateKey);
    expect(rows).toHaveLength(1);
    // The winner's event plus this one — the retry counted rather than dropped it.
    expect(rows[0].activityCount).toBe(2);
  });

  it('counts every distinct event exactly once under concurrency', async () => {
    const { service, notificationModel } = createSubject();
    const aggregateKey = NOTIFICATION_GROUP_KEYS.postCommentAggregate(postId.toString());

    const events = Array.from({ length: 6 }, () => new ObjectId());
    await Promise.all(events.map((eventId) => service.aggregate({
      recipientId: recipient,
      actorId: actorB,
      type: NOTIFICATION_TYPES.POST_COMMENT,
      groupKey: aggregateKey,
      postId,
      eventId,
      countsActivity: true
    })));

    const rows = notificationModel.byGroupKey(aggregateKey);
    expect(rows).toHaveLength(1);
    // One row is not enough on its own; the count has to be exact.
    expect(rows[0].activityCount).toBe(events.length);
  });

  it('does not double-count when the same event arrives twice concurrently', async () => {
    const { service, notificationModel } = createSubject();
    const aggregateKey = NOTIFICATION_GROUP_KEYS.postCommentAggregate(postId.toString());
    const eventId = new ObjectId();

    const options = {
      recipientId: recipient,
      actorId: actorB,
      type: NOTIFICATION_TYPES.POST_COMMENT,
      groupKey: aggregateKey,
      postId,
      eventId,
      countsActivity: true
    };
    await service.aggregate(options);
    await Promise.all([service.aggregate(options), service.aggregate(options)]);

    expect(notificationModel.byGroupKey(aggregateKey)[0].activityCount).toBe(1);
  });
});

describe('COMMENT_LIKE aggregation', () => {
  const commentLikeKey = NOTIFICATION_GROUP_KEYS.commentLike(commentId.toString());

  function commentLikeOptions(actorId: ObjectId) {
    return {
      recipientId: recipient,
      actorId,
      type: NOTIFICATION_TYPES.COMMENT_LIKE,
      groupKey: commentLikeKey,
      postId,
      commentId,
      eventId: new ObjectId()
    };
  }

  it('groups by comment and carries the containing post', async () => {
    const { service, notificationModel } = createSubject();

    await service.aggregate(commentLikeOptions(actorB));
    await service.aggregate(commentLikeOptions(actorC));
    await service.aggregate(commentLikeOptions(actorD));

    const rows = notificationModel.byGroupKey(commentLikeKey);
    expect(rows).toHaveLength(1);
    expect(rows[0].commentId.toString()).toBe(commentId.toString());
    // The panel navigates to the post, since there is no per-comment deep link.
    expect(rows[0].postId.toString()).toBe(postId.toString());
    expect(rows[0].actorId.toString()).toBe(actorD.toString());
  });

  it('never merges likes on different comments', async () => {
    const { service, notificationModel } = createSubject();
    const otherComment = new ObjectId();

    await service.aggregate(commentLikeOptions(actorB));
    await service.aggregate({
      ...commentLikeOptions(actorB),
      commentId: otherComment,
      groupKey: NOTIFICATION_GROUP_KEYS.commentLike(otherComment.toString())
    });

    expect(notificationModel.docs).toHaveLength(2);
  });
});

describe('stale aggregate actor repair', () => {
  const departing = actorD;

  async function seedAggregate() {
    const subject = createSubject();
    await subject.service.aggregate(likeOptions(departing, new ObjectId()));
    return subject;
  }

  it('leaves the group alone when somebody else unlikes', async () => {
    const { service, notificationModel } = await seedAggregate();
    const before = { ...notificationModel.docs[0] };

    const changed = await service.replaceAggregateActor(
      recipient,
      postLikeKey,
      actorC,
      async () => actorB
    );

    expect(changed).toBe(false);
    expect(notificationModel.docs[0].actorId.toString()).toBe(before.actorId.toString());
  });

  it('adopts the newest remaining liker when the displayed actor unlikes', async () => {
    const { service, notificationModel } = await seedAggregate();
    notificationModel.docs[0].read = true;
    const activityBefore = notificationModel.docs[0].lastActivityAt;

    const changed = await service.replaceAggregateActor(
      recipient,
      postLikeKey,
      departing,
      async () => actorB
    );

    expect(changed).toBe(true);
    expect(notificationModel.docs[0].actorId.toString()).toBe(actorB.toString());
    // Withdrawing a like must never resurface or reorder a notification.
    expect(notificationModel.docs[0].read).toBe(true);
    expect(notificationModel.docs[0].lastActivityAt).toBe(activityBefore);
  });

  it('removes the group once nobody likes the resource any more', async () => {
    const { service, notificationModel } = await seedAggregate();

    const changed = await service.replaceAggregateActor(
      recipient,
      postLikeKey,
      departing,
      async () => null
    );

    expect(changed).toBe(true);
    // A group standing for zero activity would read "X liked your post" forever.
    expect(notificationModel.docs).toHaveLength(0);
  });

  it('recreates the group cleanly when somebody likes again afterwards', async () => {
    const { service, notificationModel } = await seedAggregate();
    await service.replaceAggregateActor(recipient, postLikeKey, departing, async () => null);

    await service.aggregate(likeOptions(actorB, new ObjectId()));

    expect(notificationModel.byGroupKey(postLikeKey)).toHaveLength(1);
    expect(notificationModel.docs[0].actorId.toString()).toBe(actorB.toString());
    expect(notificationModel.docs[0].read).toBe(false);
  });

  it('does nothing when there is no group to repair', async () => {
    const { service } = createSubject();
    await expect(
      service.replaceAggregateActor(recipient, postLikeKey, actorB, async () => actorC)
    ).resolves.toBe(false);
  });
});

describe('adaptive comment aggregation', () => {
  const threshold = NOTIFICATION_POLICY.COMMENT_AGGREGATION_THRESHOLD;
  const aggregateKey = NOTIFICATION_GROUP_KEYS.postCommentAggregate(postId.toString());

  function commentEvent(eventId: ObjectId) {
    return {
      recipientId: recipient,
      actorId: actorB,
      type: NOTIFICATION_TYPES.POST_COMMENT,
      groupKey: NOTIFICATION_GROUP_KEYS.postComment(eventId.toString()),
      aggregateGroupKey: aggregateKey,
      aggregateResourceId: postId,
      eventId,
      threshold,
      postId,
      commentId: eventId
    };
  }

  it('keeps events individual below the threshold', async () => {
    const { service, notificationModel } = createSubject();

    for (let index = 0; index < threshold - 1; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.recordAdaptive(commentEvent(new ObjectId()));
    }

    expect(notificationModel.docs).toHaveLength(threshold - 1);
    expect(notificationModel.docs.every((doc) => doc.isAggregate === false)).toBe(true);
  });

  it('starts the aggregate representing only the event that crossed the threshold', async () => {
    const { service, notificationModel } = createSubject();

    for (let index = 0; index < threshold - 1; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.recordAdaptive(commentEvent(new ObjectId()));
    }
    await service.recordAdaptive(commentEvent(new ObjectId()));

    const aggregate = notificationModel.byGroupKey(aggregateKey);
    expect(aggregate).toHaveLength(1);
    // The four individual rows are history; counting them again would double
    // represent the same events.
    expect(aggregate[0].activityCount).toBe(1);
    expect(aggregate[0].isAggregate).toBe(true);
  });

  it('keeps the earlier individual rows as history', async () => {
    const { service, notificationModel } = createSubject();

    for (let index = 0; index < threshold + 2; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.recordAdaptive(commentEvent(new ObjectId()));
    }

    const individuals = notificationModel.docs.filter((doc) => !doc.isAggregate);
    const aggregates = notificationModel.docs.filter((doc) => doc.isAggregate);
    expect(individuals).toHaveLength(threshold - 1);
    expect(aggregates).toHaveLength(1);
    expect(aggregates[0].activityCount).toBe(3);
  });

  it('sends every later event to the existing aggregate', async () => {
    const { service, notificationModel } = createSubject();

    for (let index = 0; index < threshold + 5; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.recordAdaptive(commentEvent(new ObjectId()));
    }

    expect(notificationModel.byGroupKey(aggregateKey)).toHaveLength(1);
    expect(notificationModel.docs).toHaveLength(threshold);
  });

  it('counts the threshold per recipient, so one busy resource cannot drag others in', async () => {
    const { service, notificationModel } = createSubject();
    const otherRecipient = new ObjectId();

    for (let index = 0; index < threshold + 2; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.recordAdaptive(commentEvent(new ObjectId()));
    }
    await service.recordAdaptive({
      ...commentEvent(new ObjectId()),
      recipientId: otherRecipient
    });

    const theirRows = notificationModel.docs.filter((doc) => (
      doc.recipientId.toString() === otherRecipient.toString()
    ));
    expect(theirRows).toHaveLength(1);
    // Someone else's volume must not put this recipient straight into aggregate mode.
    expect(theirRows[0].isAggregate).toBe(false);
  });

  it('counts the threshold per resource', async () => {
    const { service, notificationModel } = createSubject();
    const otherPost = new ObjectId();

    for (let index = 0; index < threshold + 2; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.recordAdaptive(commentEvent(new ObjectId()));
    }
    const otherEvent = new ObjectId();
    await service.recordAdaptive({
      ...commentEvent(otherEvent),
      aggregateGroupKey: NOTIFICATION_GROUP_KEYS.postCommentAggregate(otherPost.toString()),
      aggregateResourceId: otherPost,
      postId: otherPost
    });

    const otherRows = notificationModel.docs.filter((doc) => (
      doc.postId && doc.postId.toString() === otherPost.toString()
    ));
    expect(otherRows).toHaveLength(1);
    expect(otherRows[0].isAggregate).toBe(false);
  });

  it('separates reply thresholds per recipient inside one thread', async () => {
    const { service, notificationModel } = createSubject();
    const rootComment = new ObjectId();
    const replyAggregateKey = NOTIFICATION_GROUP_KEYS.commentReplyAggregate(rootComment.toString());
    const recipientB = new ObjectId();
    const recipientC = new ObjectId();

    function replyEvent(recipientId: ObjectId, eventId: ObjectId) {
      return {
        recipientId,
        actorId: actorD,
        type: NOTIFICATION_TYPES.COMMENT_REPLY,
        groupKey: NOTIFICATION_GROUP_KEYS.commentReply(eventId.toString()),
        aggregateGroupKey: replyAggregateKey,
        aggregateResourceId: rootComment,
        eventId,
        threshold,
        postId,
        commentId: eventId
      };
    }

    for (let index = 0; index < threshold + 1; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.recordAdaptive(replyEvent(recipientB, new ObjectId()));
    }
    await service.recordAdaptive(replyEvent(recipientC, new ObjectId()));

    const forC = notificationModel.docs.filter((doc) => (
      doc.recipientId.toString() === recipientC.toString()
    ));
    expect(forC).toHaveLength(1);
    // Activity aimed at B must not push C into aggregate mode.
    expect(forC[0].isAggregate).toBe(false);
  });

  it('never notifies a self-comment', async () => {
    const { service, notificationModel } = createSubject();

    await service.recordAdaptive({ ...commentEvent(new ObjectId()), actorId: recipient });

    expect(notificationModel.docs).toHaveLength(0);
  });
});

describe('createOnce for mentions and individual rows', () => {
  const mentionKey = NOTIFICATION_GROUP_KEYS.postMention(postId.toString());

  function mention() {
    return {
      recipientId: recipient,
      actorId: actorB,
      type: NOTIFICATION_TYPES.POST_MENTION,
      groupKey: mentionKey,
      postId
    };
  }

  it('creates the notification and delivers it once', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();

    const created = await service.createOnce(mention());

    expect(created).not.toBeNull();
    expect(notificationModel.docs).toHaveLength(1);
    expect(notificationModel.docs[0].commentId).toBeNull();
    expect(deliveries(queueMessageService)).toBe(1);
  });

  it('is a true no-op on a duplicate event', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();
    await service.createOnce(mention());

    notificationModel.docs[0].read = true;
    notificationModel.docs[0].readAt = new Date();
    const activityBefore = notificationModel.docs[0].lastActivityAt;

    const second = await service.createOnce(mention());

    expect(second).toBeNull();
    expect(notificationModel.docs).toHaveLength(1);
    // A redelivered event must not resurface a mention already read.
    expect(notificationModel.docs[0].read).toBe(true);
    expect(notificationModel.docs[0].lastActivityAt).toBe(activityBefore);
    expect(deliveries(queueMessageService)).toBe(1);
  });

  it('does not deliver twice when two identical events race', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();

    // Both pass the existence check, then the unique index rejects the loser.
    notificationModel.onBeforeInsert = () => {
      notificationModel.onBeforeInsert = null;
      notificationModel.docs.push({
        _id: new ObjectId(), recipientId: recipient, groupKey: mentionKey
      });
    };

    const created = await service.createOnce(mention());

    expect(created).toBeNull();
    expect(deliveries(queueMessageService)).toBe(0);
  });

  it('suppresses a self-mention', async () => {
    const { service, notificationModel } = createSubject();

    await service.createOnce({ ...mention(), actorId: recipient });

    expect(notificationModel.docs).toHaveLength(0);
  });

  it('keeps mentions in different posts separate', async () => {
    const { service, notificationModel } = createSubject();
    const otherPost = new ObjectId();

    await service.createOnce(mention());
    await service.createOnce({
      ...mention(),
      postId: otherPost,
      groupKey: NOTIFICATION_GROUP_KEYS.postMention(otherPost.toString())
    });

    expect(notificationModel.docs).toHaveLength(2);
  });

  it('records a comment mention against its own comment', async () => {
    const { service, notificationModel } = createSubject();
    const key = NOTIFICATION_GROUP_KEYS.commentMention(commentId.toString());

    await service.createOnce({
      recipientId: recipient,
      actorId: actorB,
      type: NOTIFICATION_TYPES.COMMENT_MENTION,
      groupKey: key,
      postId,
      commentId
    });

    expect(notificationModel.docs[0].commentId.toString()).toBe(commentId.toString());
    expect(notificationModel.docs[0].postId.toString()).toBe(postId.toString());
  });
});

describe('FOLLOW cooldown and resurfacing', () => {
  const followKey = NOTIFICATION_GROUP_KEYS.follow(actorB.toString());
  const cooldown = NOTIFICATION_POLICY.FOLLOW_COOLDOWN_MS;

  function follow() {
    return {
      recipientId: recipient,
      actorId: actorB,
      type: NOTIFICATION_TYPES.FOLLOW,
      groupKey: followKey
    };
  }

  it('creates and delivers the first follow', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();

    await service.resurface(follow(), cooldown);

    expect(notificationModel.docs).toHaveLength(1);
    expect(notificationModel.docs[0].read).toBe(false);
    expect(deliveries(queueMessageService)).toBe(1);
  });

  it('stays quiet on a refollow inside the cooldown', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();
    await service.resurface(follow(), cooldown);
    const originalId = notificationModel.docs[0]._id.toString();

    notificationModel.docs[0].read = true;
    notificationModel.docs[0].readAt = new Date();
    const activityBefore = notificationModel.docs[0].lastActivityAt;

    const second = await service.resurface(follow(), cooldown);

    expect(second).toBeNull();
    expect(notificationModel.docs).toHaveLength(1);
    expect(notificationModel.docs[0]._id.toString()).toBe(originalId);
    // Rapid follow/unfollow cycling must not re-notify.
    expect(notificationModel.docs[0].read).toBe(true);
    expect(notificationModel.docs[0].lastActivityAt).toBe(activityBefore);
    expect(deliveries(queueMessageService)).toBe(1);
  });

  it('reuses the same row once the cooldown has passed', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();
    await service.resurface(follow(), cooldown);
    const originalId = notificationModel.docs[0]._id.toString();

    notificationModel.docs[0].read = true;
    notificationModel.docs[0].readAt = new Date();
    notificationModel.docs[0].lastActivityAt = new Date(Date.now() - cooldown - 1000);

    await service.resurface(follow(), cooldown);

    expect(notificationModel.docs).toHaveLength(1);
    expect(notificationModel.docs[0]._id.toString()).toBe(originalId);
    expect(notificationModel.docs[0].read).toBe(false);
    expect(notificationModel.docs[0].readAt).toBeNull();
    expect(new Date(notificationModel.docs[0].lastActivityAt).getTime())
      .toBeGreaterThan(Date.now() - 5000);
    expect(deliveries(queueMessageService)).toBe(2);
  });

  it('does not flood when a follow is toggled repeatedly', async () => {
    const { service, notificationModel, queueMessageService } = createSubject();

    for (let index = 0; index < 8; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await service.resurface(follow(), cooldown);
    }

    expect(notificationModel.docs).toHaveLength(1);
    expect(deliveries(queueMessageService)).toBe(1);
  });

  it('gives each follower their own row', async () => {
    const { service, notificationModel } = createSubject();

    await service.resurface(follow(), cooldown);
    await service.resurface({
      ...follow(),
      actorId: actorC,
      groupKey: NOTIFICATION_GROUP_KEYS.follow(actorC.toString())
    }, cooldown);

    expect(notificationModel.docs).toHaveLength(2);
  });

  it('never notifies someone who follows themselves', async () => {
    const { service, notificationModel } = createSubject();

    await service.resurface({ ...follow(), actorId: recipient }, cooldown);

    expect(notificationModel.docs).toHaveLength(0);
  });
});

describe('SHARE produces no notification', () => {
  it('has no share type and no group key for one', () => {
    expect(Object.values(NOTIFICATION_TYPES)).not.toContain('post_share');
    expect(Object.keys(NOTIFICATION_GROUP_KEYS)).not.toContain('postShare');
    expect(Object.keys(NOTIFICATION_GROUP_KEYS).some((key) => /share/i.test(key))).toBe(false);
  });
});
