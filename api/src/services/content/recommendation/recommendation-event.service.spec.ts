import { ObjectId } from 'mongodb';
import { RECOMMENDATION_EVENT_TYPES } from 'src/schemas/content/recommendation';
import { RecommendationEventService } from './recommendation-event.service';

const USER_ID = new ObjectId().toString();

function makePost(id: ObjectId, overrides: Record<string, any> = {}) {
  return {
    _id: id, userId: new ObjectId(), topicKey: 'food', tags: ['pho'], type: 'video', mediaTypes: ['video'], ...overrides
  };
}

/** The `PostMedia` row `RecommendationEventService` batch-fetches for canonical video duration. */
function videoMedia(postId: ObjectId, durationMs: number) {
  return { postId, durationMs };
}

interface ExistingEventFixture {
  dedupeKey: string;
  _id?: any;
  watchMs?: number | null;
  durationMs?: number | null;
  watchRatio?: number | null;
  dwellMs?: number | null;
}

function service(options: {
  posts?: any[];
  existingDedupeKeys?: string[];
  existingEvents?: ExistingEventFixture[];
  primaryVideoMedia?: any[];
  /** `followService.getFollowedAt` resolves to this — `undefined` means "not following". */
  followedAt?: Date | null;
  /** Whether `eventModel.exists` finds a prior impression/view/detail_open within the attribution window. */
  hasPriorExposure?: boolean;
  /** Rows `eventModel.aggregate` resolves to for the replay-count pre-query — `{ _id: { sessionId, postId }, count }`. */
  existingReplayAggregateRows?: Array<{ _id: any; count: number }>;
  /** Comment rows `commentModel.findById` resolves, keyed by id string. */
  comments?: Record<string, any>;
} = {}) {
  const postModel: any = {
    find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(options.posts || []) }) })
  };
  const postMediaModel: any = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(options.primaryVideoMedia || []) })
    })
  };
  const statModel: any = { bulkWrite: jest.fn().mockResolvedValue({}) };
  const existingRows = options.existingEvents
    || (options.existingDedupeKeys || []).map((dedupeKey) => ({ dedupeKey }));
  const eventModel: any = {
    find: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(existingRows.map((row) => ({ _id: new ObjectId(), ...row })))
      })
    }),
    exists: jest.fn().mockResolvedValue(options.hasPriorExposure ?? false),
    insertMany: jest.fn().mockResolvedValue([]),
    bulkWrite: jest.fn().mockResolvedValue({}),
    // Seeds the replay anti-spam cap (`maxReplaysCountedPerExposure`) from
    // "already persisted" replay counts, grouped by (session, post) — see
    // `RecommendationEventService.ingest`'s replay-count pre-query.
    aggregate: jest.fn().mockResolvedValue(options.existingReplayAggregateRows || [])
  };
  const affinityService: any = { applyEvent: jest.fn().mockResolvedValue(undefined), markSeen: jest.fn().mockResolvedValue(undefined) };
  const followService: any = { getFollowedAt: jest.fn().mockResolvedValue(options.followedAt ?? null) };
  // `findById(...).select(...).lean()` — resolves per-id from the fixture map
  // so a reply's parent lookup can differ from the comment itself.
  const commentsById = options.comments || {};
  const commentModel: any = {
    findById: jest.fn().mockImplementation((id: any) => ({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(commentsById[id?.toString()] ?? null) })
    }))
  };

  return {
    svc: new RecommendationEventService(postModel, postMediaModel, statModel, eventModel, commentModel, affinityService, followService),
    postModel,
    postMediaModel,
    statModel,
    eventModel,
    commentModel,
    affinityService,
    followService
  };
}

describe('RecommendationEventService', () => {
  it('rejects the whole batch when there is no authenticated user and no anonymousId', async () => {
    const { svc } = service();
    const result = await svc.ingest([
      { postId: new ObjectId().toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.IMPRESSION, source: 'home' }
    ], {});
    expect(result).toEqual({ accepted: 0, deduped: 0, rejected: 1 });
  });

  it('rejects an event referencing a post that does not exist', async () => {
    const { svc } = service({ posts: [] });
    const result = await svc.ingest([
      { postId: new ObjectId().toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.IMPRESSION, source: 'home' }
    ], { userId: USER_ID });
    expect(result.rejected).toBe(1);
    expect(result.accepted).toBe(0);
  });

  it('is idempotent: a retried impression with the same session/post is deduped, not double-counted', async () => {
    const postId = new ObjectId();
    const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.IMPRESSION}`;
    const { svc, statModel } = service({ posts: [makePost(postId)], existingDedupeKeys: [dedupeKey] });

    const result = await svc.ingest([
      { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.IMPRESSION, source: 'home' }
    ], { userId: USER_ID });

    expect(result).toEqual({ accepted: 0, deduped: 1, rejected: 0 });
    expect(statModel.bulkWrite).not.toHaveBeenCalled();
  });

  it('accepts a new impression and increments the stat via bulkWrite', async () => {
    const postId = new ObjectId();
    const { svc, statModel } = service({ posts: [makePost(postId)] });

    const result = await svc.ingest([
      { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.IMPRESSION, source: 'home' }
    ], { userId: USER_ID });

    expect(result.accepted).toBe(1);
    expect(statModel.bulkWrite).toHaveBeenCalledTimes(1);
    const [ops] = statModel.bulkWrite.mock.calls[0];
    expect(ops[0].updateOne.update.$inc.impressions).toBe(1);
  });

  it('clamps watchMs to the canonical (server-side) duration plus the configured slack, ignoring the client-reported duration', async () => {
    const postId = new ObjectId();
    const { svc, statModel } = service({
      posts: [makePost(postId)],
      primaryVideoMedia: [videoMedia(postId, 10_000)]
    });

    await svc.ingest([
      {
        // Client claims a 999s duration too, trying to inflate its own ratio — must be ignored entirely.
        postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 999_999, durationMs: 999_000
      }
    ], { userId: USER_ID });

    const [ops] = statModel.bulkWrite.mock.calls[0];
    // watchRatioSum is derived from the clamped ratio against the *canonical* 10s duration, so it can never exceed 1.
    expect(ops[0].updateOne.update.$inc.watchRatioSum).toBeLessThanOrEqual(1);
  });

  it('flags a short, low-ratio final_watch as a quick skip and applies negative affinity', async () => {
    const postId = new ObjectId();
    const { svc, statModel, affinityService } = service({
      posts: [makePost(postId)],
      primaryVideoMedia: [videoMedia(postId, 30_000)]
    });

    await svc.ingest([
      {
        postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 500, durationMs: 30_000
      }
    ], { userId: USER_ID });

    const [ops] = statModel.bulkWrite.mock.calls[0];
    expect(ops[0].updateOne.update.$inc.quickSkips).toBe(1);
    expect(affinityService.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ weight: expect.any(Number) }));
    const call = affinityService.applyEvent.mock.calls[0][0];
    expect(call.weight).toBeLessThan(0);
  });

  it('records weighted engagement for share distinctly from user-taste affinity', async () => {
    const postId = new ObjectId();
    const { svc, statModel, affinityService } = service({ posts: [makePost(postId)] });

    await svc.ingest([
      { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.SHARE, source: 'home' }
    ], { userId: USER_ID });

    const [ops] = statModel.bulkWrite.mock.calls[0];
    expect(ops[0].updateOne.update.$inc.weightedEngagement).toBe(5); // ENGAGEMENT_WEIGHTS.share
    expect(affinityService.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ weight: 5 })); // AFFINITY_EVENT_WEIGHTS.share
  });

  describe('follow_after_view attribution', () => {
    it('accepts and credits a follow that genuinely followed a real prior exposure within the window', async () => {
      const postId = new ObjectId();
      const creatorId = new ObjectId();
      const followedAt = new Date();
      const { svc, statModel, affinityService, followService, eventModel } = service({
        posts: [makePost(postId, { userId: creatorId })],
        followedAt,
        hasPriorExposure: true
      });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW, source: 'for-you' }
      ], { userId: USER_ID });

      expect(followService.getFollowedAt).toHaveBeenCalledWith(USER_ID, creatorId);
      expect(eventModel.exists).toHaveBeenCalledWith(expect.objectContaining({
        userId: expect.any(ObjectId),
        postId: expect.any(ObjectId),
        eventType: expect.objectContaining({ $in: expect.arrayContaining(['impression']) })
      }));
      expect(result.accepted).toBe(1);
      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.weightedEngagement).toBe(6); // ENGAGEMENT_WEIGHTS.followAfterView
      expect(affinityService.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ weight: 6 }));
    });

    it('rejects a follow_after_view when the user is not actually following the creator', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        followedAt: null, // not following
        hasPriorExposure: true
      });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW, source: 'for-you' }
      ], { userId: USER_ID });

      expect(result.rejected).toBe(1);
      expect(result.accepted).toBe(0);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects a follow_after_view with no prior recommendation exposure for this post', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        followedAt: new Date(),
        hasPriorExposure: false // followed, but never actually saw this post recommended
      });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW, source: 'for-you' }
      ], { userId: USER_ID });

      expect(result.rejected).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects a follow_after_view from a guest (no authenticated user)', async () => {
      const postId = new ObjectId();
      const { svc, followService } = service({
        posts: [makePost(postId)],
        followedAt: new Date(),
        hasPriorExposure: true
      });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW, source: 'for-you' }
      ], { anonymousId: 'anon-1' });

      expect(result.rejected).toBe(1);
      expect(followService.getFollowedAt).not.toHaveBeenCalled();
    });

    it('is idempotent: retrying the same valid follow_after_view does not credit it twice', async () => {
      const postId = new ObjectId();
      const creatorId = new ObjectId();
      const followedAt = new Date();
      const dedupeKey = `${USER_ID}:${creatorId.toString()}:${RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW}`;
      const { svc, statModel } = service({
        posts: [makePost(postId, { userId: creatorId })],
        followedAt,
        hasPriorExposure: true,
        existingDedupeKeys: [dedupeKey]
      });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's2', eventType: RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW, source: 'for-you' }
      ], { userId: USER_ID });

      expect(result.deduped).toBe(1);
      expect(result.accepted).toBe(0);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('blocks an unfollow-then-refollow cycle from re-earning the signal for the same creator', async () => {
      // The dedupe key is (subject, creator) with no session/post component,
      // so even a brand-new session viewing a *different* post by the same
      // creator, with a fresh follow timestamp, is still recognized as
      // "already credited" for this creator.
      const postId = new ObjectId();
      const creatorId = new ObjectId();
      const dedupeKey = `${USER_ID}:${creatorId.toString()}:${RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW}`;
      const { svc, statModel } = service({
        posts: [makePost(postId, { userId: creatorId })],
        followedAt: new Date(), // a brand-new follow timestamp from the refollow
        hasPriorExposure: true,
        existingDedupeKeys: [dedupeKey] // already credited once for this creator, previously
      });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's-new', eventType: RECOMMENDATION_EVENT_TYPES.FOLLOW_AFTER_VIEW, source: 'for-you' }
      ], { userId: USER_ID });

      expect(result.deduped).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('legacy fallback when the post has no canonical (server-side) duration yet', () => {
    it('never computes a watchRatio, and excludes the sample from completion/quick-skip scoring', async () => {
      const postId = new ObjectId();
      // No `primaryVideoMedia` fixture — canonicalDurationMs resolves to null.
      const { svc, statModel, affinityService } = service({ posts: [makePost(postId)] });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 500, durationMs: 30_000
        }
      ], { userId: USER_ID });

      // Still "accepted" (it is a legitimate new record, not a duplicate) —
      // but with no ratio to score from, it produces no stat increment and
      // no affinity signal, only the raw audit row asserted below.
      expect(result.accepted).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
      expect(affinityService.applyEvent).not.toHaveBeenCalled();
    });

    it('still clamps the raw watchMs to a safe absolute ceiling, ignoring the client duration entirely', async () => {
      const postId = new ObjectId();
      const { svc, eventModel } = service({ posts: [makePost(postId)] });

      await svc.ingest([
        {
          // Client claims an absurd watch time and an absurd duration; with no
          // canonical duration, only the safe legacy ceiling protects the raw log.
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 999_999_999, durationMs: 999_999_999
        }
      ], { userId: USER_ID });

      expect(eventModel.insertMany).toHaveBeenCalledTimes(1);
      const [rawDocs] = eventModel.insertMany.mock.calls[0];
      expect(rawDocs[0].watchMs).toBeLessThanOrEqual(30 * 60 * 1000);
      expect(rawDocs[0].durationMs).toBeNull();
      expect(rawDocs[0].watchRatio).toBeNull();
    });
  });

  describe('repeat final_watch for the same exposure (pause, then resume and watch more)', () => {
    it('applies only the delta against the previously recorded watch, not a second full sample', async () => {
      const postId = new ObjectId();
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.FINAL_WATCH}`;
      // First flush already recorded: watched 2s of a 10s video (ratio 0.2).
      const { svc, statModel, eventModel } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 10_000)],
        existingEvents: [{ dedupeKey, watchMs: 2000, durationMs: 10_000, watchRatio: 0.2 }]
      });

      // Second flush: they resumed and watched to 8s (ratio 0.8).
      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 8000, durationMs: 10_000
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1);
      expect(result.deduped).toBe(0);
      const [ops] = statModel.bulkWrite.mock.calls[0];
      // Delta is 0.8 - 0.2 = 0.6, not a fresh 0.8 sample, and watchSampleCount is not incremented again.
      expect(ops[0].updateOne.update.$inc.watchRatioSum).toBeCloseTo(0.6, 5);
      expect(ops[0].updateOne.update.$inc.watchSampleCount).toBeUndefined();

      // The raw event row is corrected in place, not duplicated.
      expect(eventModel.insertMany).not.toHaveBeenCalled();
      expect(eventModel.bulkWrite).toHaveBeenCalledTimes(1);
      const [updateOps] = eventModel.bulkWrite.mock.calls[0];
      expect(updateOps[0].updateOne.update.$set.watchMs).toBe(8000);
    });

    it('corrects quickSkips from true to false when the improved watch crosses out of the quick-skip band', async () => {
      const postId = new ObjectId();
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.FINAL_WATCH}`;
      // First flush was a quick skip: 1s of a 30s video.
      const { svc, statModel, affinityService } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 30_000)],
        existingEvents: [{ dedupeKey, watchMs: 1000, durationMs: 30_000, watchRatio: 1000 / 30_000 }]
      });

      // Second flush: they came back and watched to 25s — no longer a quick skip.
      await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 25_000, durationMs: 30_000
        }
      ], { userId: USER_ID });

      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.quickSkips).toBe(-1); // corrects the earlier +1
      const call = affinityService.applyEvent.mock.calls[0][0];
      expect(call.weight).toBeGreaterThan(0); // was negative (quick skip), now a genuine positive watch signal
    });

    it('ignores a flush reporting less watch than already on record (no regression)', async () => {
      const postId = new ObjectId();
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.FINAL_WATCH}`;
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 10_000)],
        existingEvents: [{ dedupeKey, watchMs: 9000, durationMs: 10_000, watchRatio: 0.9 }]
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 500, durationMs: 10_000
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(0);
      expect(result.deduped).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('repeat photo_dwell for the same exposure', () => {
    it('applies only the delta dwell time, not a second full sample', async () => {
      const postId = new ObjectId();
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.PHOTO_DWELL}`;
      const { svc, statModel } = service({
        posts: [makePost(postId, { type: 'photo', mediaTypes: ['photo'] })],
        existingEvents: [{ dedupeKey, dwellMs: 1500 }]
      });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.PHOTO_DWELL, source: 'for-you', dwellMs: 5000 }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1);
      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.dwellMsSum).toBe(3500);
      expect(ops[0].updateOne.update.$inc.dwellSampleCount).toBeUndefined();
    });
  });

  describe('quick-skip classification (video, via final_watch — rules/instructions §1.1)', () => {
    it('does NOT flag a short video watched mostly through, even though the absolute ms is under the floor', async () => {
      const postId = new ObjectId();
      // 2s video, watched 1.8s: ratio 0.9 (well above quickSkipMaxRatio) even
      // though watchMs (1800) is under quickSkipMaxMs (3000) — both must
      // hold for a quick skip, so this must NOT be flagged.
      const { svc, statModel, affinityService } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 2000)]
      });

      await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 1800, durationMs: 2000 }
      ], { userId: USER_ID });

      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.quickSkips).toBeUndefined();
      const call = affinityService.applyEvent.mock.calls[0][0];
      expect(call.weight).toBeGreaterThan(0);
    });

    it('flags a genuine long video left almost immediately as a quick skip (low ratio AND low absolute ms)', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 60_000)]
      });

      await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 2500, durationMs: 60_000 }
      ], { userId: USER_ID });

      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.quickSkips).toBe(1);
    });

    it('a photo with dwell under the floor is a quick skip; at or above it is not', async () => {
      const shortDwellPost = new ObjectId();
      const { svc: shortSvc, statModel: shortStat } = service({ posts: [makePost(shortDwellPost, { type: 'photo', mediaTypes: ['photo'] })] });
      await shortSvc.ingest([
        { postId: shortDwellPost.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.PHOTO_DWELL, source: 'home', dwellMs: 900 }
      ], { userId: USER_ID });
      expect(shortStat.bulkWrite.mock.calls[0][0][0].updateOne.update.$inc.quickSkips).toBe(1);

      const longDwellPost = new ObjectId();
      const { svc: longSvc, statModel: longStat } = service({ posts: [makePost(longDwellPost, { type: 'photo', mediaTypes: ['photo'] })] });
      await longSvc.ingest([
        { postId: longDwellPost.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.PHOTO_DWELL, source: 'home', dwellMs: 4200 }
      ], { userId: USER_ID });
      expect(longStat.bulkWrite.mock.calls[0][0][0].updateOne.update.$inc.quickSkips).toBeUndefined();
    });
  });

  describe('completion server source of truth (rules/instructions §1.2)', () => {
    it('rejects a client-claimed completion whose own watchMs does not clear the completion threshold', async () => {
      const postId = new ObjectId();
      const { svc, statModel, affinityService, eventModel } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 30_000)]
      });

      // Client sends eventType "completion" but only actually watched 5s of 30s (ratio 0.17).
      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMPLETION, source: 'for-you', watchMs: 5000, durationMs: 30_000 }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1); // accepted as a raw audit row, but...
      expect(statModel.bulkWrite).not.toHaveBeenCalled(); // ...no stat increment
      expect(affinityService.applyEvent).not.toHaveBeenCalled(); // ...no affinity credit
      // The raw row is still stored (for audit/debugging), honestly reflecting the claim did not verify.
      expect(eventModel.insertMany).toHaveBeenCalledTimes(1);
    });

    it('never counts a completion on a legacy post with no canonical duration, no matter what the client claims', async () => {
      const postId = new ObjectId();
      // No primaryVideoMedia fixture — canonicalDurationMs resolves to null, so watchRatio is always null.
      const { svc, statModel, affinityService } = service({ posts: [makePost(postId)] });

      await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMPLETION, source: 'for-you', watchMs: 999_999, durationMs: 999_999 }
      ], { userId: USER_ID });

      expect(statModel.bulkWrite).not.toHaveBeenCalled();
      expect(affinityService.applyEvent).not.toHaveBeenCalled();
    });

    it('accepts and credits a completion whose own watchMs genuinely clears the threshold against canonical duration', async () => {
      const postId = new ObjectId();
      const { svc, statModel, affinityService } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 10_000)]
      });

      await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMPLETION, source: 'for-you', watchMs: 9500, durationMs: 10_000 }
      ], { userId: USER_ID });

      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.completions).toBe(1);
      expect(affinityService.applyEvent).toHaveBeenCalledTimes(1);
    });
  });

  describe('replay occurrence idempotency and anti-spam cap (rules/instructions §1.3)', () => {
    it('counts a fresh replay occurrence (its own clientExposureId) and credits it', async () => {
      const postId = new ObjectId();
      const { svc, statModel, affinityService } = service({ posts: [makePost(postId)] });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.REPLAY, source: 'for-you', clientExposureId: 'occ-1'
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1);
      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.replays).toBe(1);
      expect(affinityService.applyEvent).toHaveBeenCalledTimes(1);
    });

    it('dedupes a retry of the SAME replay occurrence (same clientExposureId) instead of double-counting', async () => {
      const postId = new ObjectId();
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.REPLAY}:occ-1`;
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        existingDedupeKeys: [dedupeKey]
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.REPLAY, source: 'for-you', clientExposureId: 'occ-1'
        }
      ], { userId: USER_ID });

      expect(result).toEqual({ accepted: 0, deduped: 1, rejected: 0 });
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('counts a genuinely NEW replay occurrence (different clientExposureId) for the same exposure', async () => {
      const postId = new ObjectId();
      // occ-1 already recorded; this request is occ-2, a real second replay.
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.REPLAY}:occ-1`;
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        existingDedupeKeys: [dedupeKey],
        existingReplayAggregateRows: [{ _id: { sessionId: 's1', postId }, count: 1 }]
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.REPLAY, source: 'for-you', clientExposureId: 'occ-2'
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1);
      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.replays).toBe(1);
    });

    it('stops crediting replays once the persisted count already reached the cap, while still storing the raw row', async () => {
      const postId = new ObjectId();
      const { svc, statModel, affinityService, eventModel } = service({
        posts: [makePost(postId)],
        // Already at the cap (5) from prior requests/history.
        existingReplayAggregateRows: [{ _id: { sessionId: 's1', postId }, count: 5 }]
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.REPLAY, source: 'for-you', clientExposureId: 'occ-6'
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1); // still accepted as a raw audit row...
      expect(statModel.bulkWrite).not.toHaveBeenCalled(); // ...but no further stat increment...
      expect(affinityService.applyEvent).not.toHaveBeenCalled(); // ...and no further affinity credit.
      expect(eventModel.insertMany).toHaveBeenCalledTimes(1);
    });

    it('bounds the cap across multiple occurrences arriving in the SAME batch, not just one at a time', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        // Already 4 persisted; 2 new occurrences arrive together — only 1 more should be credited (cap 5).
        existingReplayAggregateRows: [{ _id: { sessionId: 's1', postId }, count: 4 }]
      });

      await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.REPLAY, source: 'for-you', clientExposureId: 'occ-a' },
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.REPLAY, source: 'for-you', clientExposureId: 'occ-b' }
      ], { userId: USER_ID });

      // Two updateOne ops queued (one per accepted item that produced an inc), but only the first carries a replays increment.
      const [ops] = statModel.bulkWrite.mock.calls[0];
      const replayIncrements = ops.filter((op: any) => op.updateOne.update.$inc.replays).length;
      expect(replayIncrements).toBe(1);
    });

    it('does not dedupe two occurrences with no clientExposureId at all (older client, no occurrence identity to key on)', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({ posts: [makePost(postId)] });

      await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.REPLAY, source: 'for-you' }
      ], { userId: USER_ID });
      const firstOps = statModel.bulkWrite.mock.calls[0][0];
      expect(firstOps[0].updateOne.update.$inc.replays).toBe(1);
    });
  });

  describe('out-of-order delivery / monotonic merge (rules/instructions §1.4)', () => {
    it('two distinct exposures (different sessionId) of the same post are counted independently, never merged', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 10_000)]
      });

      await svc.ingest([
        { postId: postId.toString(), sessionId: 's-exposure-1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 9000, durationMs: 10_000 }
      ], { userId: USER_ID });
      await svc.ingest([
        { postId: postId.toString(), sessionId: 's-exposure-2', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 500, durationMs: 10_000 }
      ], { userId: USER_ID });

      // Both calls produced their own full increment — a low-watch second
      // exposure is a real, independent data point, not a "regression" of
      // the first exposure's high watch.
      expect(statModel.bulkWrite).toHaveBeenCalledTimes(2);
      expect(statModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$inc.watchRatioSum).toBeCloseTo(0.9, 5);
      expect(statModel.bulkWrite.mock.calls[1][0][0].updateOne.update.$inc.watchRatioSum).toBeCloseTo(0.05, 5);
    });

    it('a late-arriving keepalive-on-unload flush with a smaller value than what is already stored is a pure no-op, never regressing the counter', async () => {
      const postId = new ObjectId();
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.FINAL_WATCH}`;
      // A normal pause flush already recorded 9s watched (out of 10s).
      const { svc, statModel, eventModel } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 10_000)],
        existingEvents: [{ dedupeKey, watchMs: 9000, durationMs: 10_000, watchRatio: 0.9 }]
      });

      // The keepalive `fetch` fired on an earlier, smaller checkpoint (3s)
      // arrives late, after the real pause flush already landed.
      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 3000, durationMs: 10_000 }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(0);
      expect(result.deduped).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
      expect(eventModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('a retried batch (network retry resending the exact same final_watch value) is a no-op, not a double-count', async () => {
      const postId = new ObjectId();
      const dedupeKey = `${USER_ID}:s1:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.FINAL_WATCH}`;
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        primaryVideoMedia: [videoMedia(postId, 10_000)],
        existingEvents: [{ dedupeKey, watchMs: 6000, durationMs: 10_000, watchRatio: 0.6 }]
      });

      // Same value resent (client retried after a timeout, but the first attempt had actually landed).
      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.FINAL_WATCH, source: 'for-you', watchMs: 6000, durationMs: 10_000 }
      ], { userId: USER_ID });

      expect(result.deduped).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });
  });

  describe('comment attribution is verified against the real comment (rules/instructions §2)', () => {
    it('credits a root comment this user genuinely wrote on this post', async () => {
      const postId = new ObjectId();
      const commentId = new ObjectId();
      const { svc, statModel, affinityService } = service({
        posts: [makePost(postId)],
        comments: { [commentId.toString()]: { createdBy: new ObjectId(USER_ID), objectType: 'post', objectId: postId } }
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: commentId.toString()
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1);
      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops[0].updateOne.update.$inc.weightedEngagement).toBe(3); // ENGAGEMENT_WEIGHTS.comment
      expect(affinityService.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ weight: 3 }));
    });

    it('credits a REPLY exactly once, resolving the post through its parent comment', async () => {
      const postId = new ObjectId();
      const parentId = new ObjectId();
      const replyId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        comments: {
          [replyId.toString()]: { createdBy: new ObjectId(USER_ID), objectType: 'comment', objectId: parentId },
          [parentId.toString()]: { objectType: 'post', objectId: postId }
        }
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: replyId.toString()
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1);
      // Exactly one signal — never counted as a root comment *and* a reply.
      const [ops] = statModel.bulkWrite.mock.calls[0];
      expect(ops).toHaveLength(1);
      expect(ops[0].updateOne.update.$inc.weightedEngagement).toBe(3);
    });

    it('rejects a comment claim with no commentId at all', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({ posts: [makePost(postId)] });

      const result = await svc.ingest([
        { postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail' }
      ], { userId: USER_ID });

      expect(result.rejected).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects a commentId that does not exist', async () => {
      const postId = new ObjectId();
      const { svc, statModel } = service({ posts: [makePost(postId)], comments: {} });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: new ObjectId().toString()
        }
      ], { userId: USER_ID });

      expect(result.rejected).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects claiming credit for somebody else\'s comment', async () => {
      const postId = new ObjectId();
      const commentId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        comments: { [commentId.toString()]: { createdBy: new ObjectId(), objectType: 'post', objectId: postId } }
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: commentId.toString()
        }
      ], { userId: USER_ID });

      expect(result.rejected).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects a real comment of mine that belongs to a DIFFERENT post', async () => {
      const postId = new ObjectId();
      const otherPostId = new ObjectId();
      const commentId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        comments: { [commentId.toString()]: { createdBy: new ObjectId(USER_ID), objectType: 'post', objectId: otherPostId } }
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: commentId.toString()
        }
      ], { userId: USER_ID });

      expect(result.rejected).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('rejects a comment claim from a guest', async () => {
      const postId = new ObjectId();
      const commentId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        comments: { [commentId.toString()]: { createdBy: new ObjectId(USER_ID), objectType: 'post', objectId: postId } }
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: commentId.toString()
        }
      ], { anonymousId: 'anon-1' });

      expect(result.rejected).toBe(1);
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('is idempotent: a retry carrying the same commentId does not credit it twice', async () => {
      const postId = new ObjectId();
      const commentId = new ObjectId();
      const dedupeKey = `${USER_ID}:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.COMMENT}:${commentId.toString()}`;
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        comments: { [commentId.toString()]: { createdBy: new ObjectId(USER_ID), objectType: 'post', objectId: postId } },
        existingDedupeKeys: [dedupeKey]
      });

      const result = await svc.ingest([
        {
          // A different session — the dedupe key is deliberately not session-scoped.
          postId: postId.toString(), sessionId: 's-other', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: commentId.toString()
        }
      ], { userId: USER_ID });

      expect(result).toEqual({ accepted: 0, deduped: 1, rejected: 0 });
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('counts a genuinely second comment on the same post (a different real commentId)', async () => {
      const postId = new ObjectId();
      const firstId = new ObjectId();
      const secondId = new ObjectId();
      const { svc, statModel } = service({
        posts: [makePost(postId)],
        comments: {
          [secondId.toString()]: { createdBy: new ObjectId(USER_ID), objectType: 'post', objectId: postId }
        },
        existingDedupeKeys: [`${USER_ID}:${postId.toString()}:${RECOMMENDATION_EVENT_TYPES.COMMENT}:${firstId.toString()}`],
        existingReplayAggregateRows: []
      });

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: secondId.toString()
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1);
      expect(statModel.bulkWrite.mock.calls[0][0][0].updateOne.update.$inc.weightedEngagement).toBe(3);
    });

    it('stops crediting once this subject already hit the per-post comment cap (comment/delete/repeat spam)', async () => {
      const postId = new ObjectId();
      const commentId = new ObjectId();
      const { svc, statModel, affinityService, eventModel } = service({
        posts: [makePost(postId)],
        comments: { [commentId.toString()]: { createdBy: new ObjectId(USER_ID), objectType: 'post', objectId: postId } }
      });
      // Already at the cap (3) from earlier comments on this same post.
      eventModel.aggregate.mockResolvedValue([{ _id: postId, count: 3 }]);

      const result = await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.COMMENT, source: 'post-detail', commentId: commentId.toString()
        }
      ], { userId: USER_ID });

      expect(result.accepted).toBe(1); // raw audit row still written
      expect(statModel.bulkWrite).not.toHaveBeenCalled();
      expect(affinityService.applyEvent).not.toHaveBeenCalled();
    });
  });

  describe('subject identity is server-derived, never client-claimed (rules/instructions §1.5)', () => {
    it('attributes writes to the authenticated actor even if the event item carries a spoofed userId field', async () => {
      const postId = new ObjectId();
      const impersonatedUserId = new ObjectId().toString();
      const { svc, eventModel, affinityService } = service({ posts: [makePost(postId)] });

      await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.VIEW, source: 'for-you',
          // Not a real field on the payload type — simulates a caller trying
          // to smuggle an identity claim through an unexpected property.
          userId: impersonatedUserId
        } as any
      ], { userId: USER_ID });

      const [rawDocs] = eventModel.insertMany.mock.calls[0];
      expect(rawDocs[0].userId.toString()).toBe(USER_ID);
      expect(rawDocs[0].userId.toString()).not.toBe(impersonatedUserId);
      expect(affinityService.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ subjectId: USER_ID }));
    });

    it('a guest event carrying a spoofed userId field still resolves to the request-supplied anonymousId, never that userId', async () => {
      const postId = new ObjectId();
      const impersonatedUserId = new ObjectId().toString();
      const { svc, eventModel, affinityService } = service({ posts: [makePost(postId)] });

      await svc.ingest([
        {
          postId: postId.toString(), sessionId: 's1', eventType: RECOMMENDATION_EVENT_TYPES.VIEW, source: 'for-you', userId: impersonatedUserId
        } as any
      ], { anonymousId: 'anon-guest-1' });

      const [rawDocs] = eventModel.insertMany.mock.calls[0];
      expect(rawDocs[0].userId).toBeNull();
      expect(rawDocs[0].anonymousId).toBe('anon-guest-1');
      expect(affinityService.applyEvent).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 'anon-guest-1', isAuthenticatedUser: false }));
    });
  });
});
