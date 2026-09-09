import { Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { RECOMMENDATION_EVENT_TYPES } from 'src/schemas/content/recommendation';
import {
  RecommendationEventService,
  isDedupeCollision,
  partitionWriteErrors
} from './recommendation-event.service';

/**
 * The replay-protection index rejecting a concurrent duplicate is the system
 * working, not a partial failure.
 *
 * Both audit writes used to log every rejection at WARN with the full driver
 * message, so a live feed produced a steady stream of
 * `E11000 duplicate key error ... uq_recommendation_event_dedupe` warnings that
 * described normal operation. Per `.agents/rules/api.md`, a duplicate-key error
 * is classified by *which* index it collided on — `code === 11000` alone would
 * swallow an unrelated conflict as an expected no-op.
 */
function dedupeWriteError(dedupeKey = 'u1:s1:p1:impression') {
  return {
    index: 0,
    code: 11000,
    keyPattern: { dedupeKey: 1 },
    keyValue: { dedupeKey },
    errmsg: `E11000 duplicate key error collection: douyin.recommendationevents index: uq_recommendation_event_dedupe dup key: { dedupeKey: "${dedupeKey}" }`
  };
}

/** A collision on some *other* unique index — a real problem that must be reported. */
function foreignWriteError() {
  return {
    index: 1,
    code: 11000,
    keyPattern: { someOtherField: 1 },
    errmsg: 'E11000 duplicate key error collection: douyin.recommendationevents index: uq_something_else'
  };
}

function bulkError(writeErrors: any[]) {
  const error: any = new Error('BulkWriteError');
  error.writeErrors = writeErrors;
  return error;
}

describe('recommendation event write-error classification', () => {
  describe('isDedupeCollision', () => {
    it('recognises a collision on the dedupe index by keyPattern', () => {
      expect(isDedupeCollision(dedupeWriteError())).toBe(true);
    });

    it('recognises the driver shape that nests the detail under `err`', () => {
      expect(isDedupeCollision({ err: dedupeWriteError() } as any)).toBe(true);
    });

    it('falls back to the index name when only a message is available', () => {
      const { keyPattern, ...withoutKeyPattern } = dedupeWriteError();
      expect(isDedupeCollision(withoutKeyPattern as any)).toBe(true);
    });

    it('does NOT treat a duplicate key on another index as the dedupe working', () => {
      expect(isDedupeCollision(foreignWriteError())).toBe(false);
    });

    it('does not classify a non-duplicate-key error as a dedupe collision', () => {
      expect(isDedupeCollision({ code: 121, errmsg: 'Document failed validation' })).toBe(false);
    });
  });

  describe('partitionWriteErrors', () => {
    it('counts dedupe collisions and reports nothing else when that is all there was', () => {
      const result = partitionWriteErrors(bulkError([dedupeWriteError('a'), dedupeWriteError('b')]));
      expect(result.deduped).toBe(2);
      expect(result.other).toHaveLength(0);
    });

    it('keeps a foreign duplicate key in `other` even alongside real dedupe collisions', () => {
      const result = partitionWriteErrors(bulkError([dedupeWriteError(), foreignWriteError()]));
      expect(result.deduped).toBe(1);
      expect(result.other).toHaveLength(1);
      expect(result.other[0]).toMatchObject({ keyPattern: { someOtherField: 1 } });
    });

    it('reports an error with no writeErrors as entirely unexpected', () => {
      const error = new Error('connection reset');
      const result = partitionWriteErrors(error);
      expect(result.deduped).toBe(0);
      expect(result.other).toEqual([error]);
    });
  });

  describe('ingest logging', () => {
    const postId = new ObjectId();
    const userId = new ObjectId().toString();

    function service(insertRejection: any) {
      const postModel: any = {
        find: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            lean: jest.fn().mockResolvedValue([
              { _id: postId, userId: new ObjectId(), topicKey: 'food', tags: [], type: 'video', mediaTypes: ['video'] }
            ])
          })
        })
      };
      const postMediaModel: any = {
        find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) })
      };
      const statModel: any = { bulkWrite: jest.fn().mockResolvedValue({}) };
      const eventModel: any = {
        find: jest.fn().mockReturnValue({ select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }) }),
        exists: jest.fn().mockResolvedValue(false),
        aggregate: jest.fn().mockResolvedValue([]),
        bulkWrite: jest.fn().mockResolvedValue({}),
        insertMany: jest.fn().mockRejectedValue(insertRejection)
      };
      const affinityService: any = {
        applyEvent: jest.fn().mockResolvedValue(undefined),
        markSeen: jest.fn().mockResolvedValue(undefined)
      };
      const followService: any = { getFollowedAt: jest.fn().mockResolvedValue(null) };
      const commentModel: any = { findById: jest.fn() };
      return new RecommendationEventService(
        postModel, postMediaModel, statModel, eventModel, commentModel, affinityService, followService
      );
    }

    const impression = () => ([{
      postId: postId.toString(),
      sessionId: 's1',
      eventType: RECOMMENDATION_EVENT_TYPES.IMPRESSION,
      source: 'home'
    }]);

    let warn: jest.SpyInstance;
    let debug: jest.SpyInstance;

    beforeEach(() => {
      warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    });
    afterEach(() => jest.restoreAllMocks());

    it('logs no warning when every insert failure was the dedupe index', async () => {
      const svc = service(bulkError([dedupeWriteError()]));
      await svc.ingest(impression() as any, { userId });
      expect(warn).not.toHaveBeenCalled();
      expect(debug).toHaveBeenCalledWith(expect.stringContaining('replay protection'));
    });

    it('still warns when the insert failed for a reason that is not the dedupe index', async () => {
      const svc = service(bulkError([foreignWriteError()]));
      await svc.ingest(impression() as any, { userId });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('unexpected failure'));
    });

    it('still warns for a rejection that carries no writeErrors at all', async () => {
      const svc = service(new Error('connection reset by peer'));
      await svc.ingest(impression() as any, { userId });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('connection reset by peer'));
    });

    it('does not report the batch as failed — the audit row is not the source of truth', async () => {
      const svc = service(bulkError([dedupeWriteError()]));
      const result = await svc.ingest(impression() as any, { userId });
      expect(result.accepted).toBe(1);
      expect(result.rejected).toBe(0);
    });
  });
});
