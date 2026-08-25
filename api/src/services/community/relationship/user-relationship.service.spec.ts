import { ObjectId } from 'mongodb';
import { RELATIONSHIP_TYPES } from 'src/common/constants/community';

import { UserRelationshipService } from './user-relationship.service';

/**
 * A flag has to be exactly present or exactly absent.
 *
 * "Mostly one row" is not good enough: a second row that an Unblock leaves
 * behind keeps somebody blocked while the UI insists they are not, and there is
 * no control left to fix it.
 */

/**
 * Stand-in for the collection, with the unique index enforced.
 *
 * The index is modelled rather than assumed, because the behaviour under test is
 * how the service reacts *to* it — an upsert that loses the race raises 11000,
 * and that has to read as success.
 */
/** Records what the service publishes, so the cleared-flag event can be asserted. */
function createQueue() {
  return { publish: jest.fn().mockResolvedValue(undefined) };
}

function createModel(options: { unique?: boolean } = {}) {
  const unique = options.unique !== false;
  const rows: any[] = [];

  const matches = (row: any, filter: any) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return false;
    return String(row[key]) === String(value);
  });

  return {
    get rows() { return rows; },
    /** Seeds duplicates directly, as a database without the index could hold. */
    seed(row: any) { rows.push({ ...row }); },
    updateOne: jest.fn(async (filter: any, update: any, opts: any) => {
      const existing = rows.find((row) => matches(row, filter));
      if (existing) return { upsertedCount: 0, modifiedCount: 1 };
      if (!opts?.upsert) return { upsertedCount: 0, modifiedCount: 0 };

      if (unique && rows.some((row) => matches(row, filter))) {
        const error: any = new Error('E11000 duplicate key error');
        error.code = 11000;
        throw error;
      }
      rows.push({ ...filter, ...(update.$setOnInsert || {}) });
      return { upsertedCount: 1, modifiedCount: 0 };
    }),
    deleteMany: jest.fn(async (filter: any) => {
      const keep = rows.filter((row) => !matches(row, filter));
      const removed = rows.length - keep.length;
      rows.length = 0;
      rows.push(...keep);
      return { deletedCount: removed };
    }),
    find: jest.fn(() => ({
      select: () => ({ lean: async () => rows.slice() })
    }))
  };
}

describe('UserRelationshipService', () => {
  const alice = new ObjectId();
  const bob = new ObjectId();

  it('creates one row for a flag', async () => {
    const model = createModel();
    const service = new UserRelationshipService(model as any, createQueue() as any);

    await expect(service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK)).resolves.toBe(true);
    expect(model.rows).toHaveLength(1);
  });

  it('keeps exactly one row when the button is clicked twice', async () => {
    const model = createModel();
    const service = new UserRelationshipService(model as any, createQueue() as any);

    await service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK);
    await service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK);

    expect(model.rows).toHaveLength(1);
  });

  it('keeps exactly one row when two requests arrive at the same instant', async () => {
    // Both pass the upsert's existence check; the index refuses the second
    // write, and the service must read that as "the flag exists" rather than
    // failing the request.
    const model = createModel();
    const service = new UserRelationshipService(model as any, createQueue() as any);

    const outcomes = await Promise.allSettled([
      service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK),
      service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK)
    ]);

    expect(outcomes.every((o) => o.status === 'fulfilled')).toBe(true);
    expect(model.rows).toHaveLength(1);
  });

  it('does not swallow errors that are not duplicate keys', async () => {
    const model = createModel();
    model.updateOne = jest.fn().mockRejectedValue(new Error('connection lost'));
    const service = new UserRelationshipService(model as any, createQueue() as any);

    await expect(service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK)).rejects.toThrow('connection lost');
  });

  it('clears every row for the flag, not just one', async () => {
    // A database that ran this code before the unique index existed can hold
    // duplicates; removing one per click would leave the user blocked.
    const model = createModel({ unique: false });
    model.seed({ userId: alice, targetId: bob, type: RELATIONSHIP_TYPES.BLOCK });
    model.seed({ userId: alice, targetId: bob, type: RELATIONSHIP_TYPES.BLOCK });
    const service = new UserRelationshipService(model as any, createQueue() as any);

    await expect(service.clear(alice, bob, RELATIONSHIP_TYPES.BLOCK)).resolves.toBe(true);
    expect(model.rows).toHaveLength(0);
  });

  it('leaves the other direction alone — a mutual block is two valid rows', async () => {
    const model = createModel();
    const service = new UserRelationshipService(model as any, createQueue() as any);

    await service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK);
    await service.set(bob, alice, RELATIONSHIP_TYPES.BLOCK);

    expect(model.rows).toHaveLength(2);

    await service.clear(alice, bob, RELATIONSHIP_TYPES.BLOCK);
    expect(model.rows).toHaveLength(1);
    expect(String(model.rows[0].userId)).toBe(String(bob));
  });

  it('keeps block and restrict as separate flags on the same pair', async () => {
    const model = createModel();
    const service = new UserRelationshipService(model as any, createQueue() as any);

    await service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK);
    await service.set(alice, bob, RELATIONSHIP_TYPES.RESTRICT);

    expect(model.rows).toHaveLength(2);

    await service.clear(alice, bob, RELATIONSHIP_TYPES.BLOCK);
    expect(model.rows).toHaveLength(1);
    expect(model.rows[0].type).toBe(RELATIONSHIP_TYPES.RESTRICT);
  });

  describe('clearing a flag tells the other domains', () => {
    it('publishes when a flag was actually cleared', async () => {
      // Lifting a flag can make an announcement true that was correctly refused
      // while it was up, so the message domain needs to hear about it.
      const model = createModel();
      const queue = createQueue();
      const service = new UserRelationshipService(model as any, queue as any);

      await service.set(alice, bob, RELATIONSHIP_TYPES.RESTRICT);
      await service.clear(alice, bob, RELATIONSHIP_TYPES.RESTRICT);

      expect(queue.publish).toHaveBeenCalledTimes(1);
      const [, payload] = queue.publish.mock.calls[0];
      expect(payload).toMatchObject({
        eventName: 'relationship:cleared',
        data: expect.objectContaining({ type: RELATIONSHIP_TYPES.RESTRICT })
      });
    });

    it('says nothing when there was no flag to clear', async () => {
      // Otherwise a repeated Unblock would have other domains acting twice.
      const model = createModel();
      const queue = createQueue();
      const service = new UserRelationshipService(model as any, queue as any);

      await service.clear(alice, bob, RELATIONSHIP_TYPES.BLOCK);

      expect(queue.publish).not.toHaveBeenCalled();
    });

    it('says nothing when a flag is set', async () => {
      const model = createModel();
      const queue = createQueue();
      const service = new UserRelationshipService(model as any, queue as any);

      await service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK);

      expect(queue.publish).not.toHaveBeenCalled();
    });

    it('still clears the flag when publishing fails', async () => {
      // The user asked for the flag to go. A missed announcement must not fail
      // the request they actually made.
      const model = createModel();
      const queue = { publish: jest.fn().mockRejectedValue(new Error('queue down')) };
      const service = new UserRelationshipService(model as any, queue as any);

      await service.set(alice, bob, RELATIONSHIP_TYPES.BLOCK);
      await expect(service.clear(alice, bob, RELATIONSHIP_TYPES.BLOCK)).resolves.toBe(true);
      expect(model.rows).toHaveLength(0);
    });
  });

  it('refuses to flag yourself', async () => {
    const model = createModel();
    const service = new UserRelationshipService(model as any, createQueue() as any);

    await expect(service.set(alice, alice, RELATIONSHIP_TYPES.BLOCK)).resolves.toBe(false);
    expect(model.rows).toHaveLength(0);
  });
});
