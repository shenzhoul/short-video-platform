import { ObjectId } from 'mongodb';

import {
  ProfileImageNotAttachableException,
  ProfileImageNotFoundException,
  ProfileImageNotOwnedException,
  ProfileImageNotReadyException,
  ProfileImageWrongTypeException
} from 'src/common/exceptions/user';
import { EntityNotFoundException } from 'src/kernel';
import { BaseUserService } from './base-user.service';

/**
 * The profile image write path, and specifically what is true after each way it
 * can fail.
 *
 * There is no shared transaction between the user document and the file server,
 * so correctness here is entirely a matter of ordering plus compensation. Two
 * states must never exist:
 *
 *  1. A profile pointing at a file with no reference — `cleanup-unused-files.job`
 *     decides what is abandoned purely from `refItems` and sweeps both `avatar`
 *     and `cover`, so that profile's image is deleted within hours.
 *  2. A file holding a reference that no profile points at — nothing will ever
 *     collect it, because the sweeper only looks at unreferenced files.
 *
 * Every test below is one route into one of those two states, and the assertion
 * is that the route is closed.
 */

interface FakeFileRecord {
  _id: ObjectId;
  type: string;
  createdBy: string;
  status: string;
  processingStatus?: string;
  processingError?: string;
  url: string;
  metadata?: Record<string, any>;
  refItems: Array<{ itemId: ObjectId; itemType: string }>;
}

/**
 * A file server that behaves like the real one for the four operations this path
 * uses, and tracks the two things the assertions care about: the reference list
 * and whether the bytes still exist.
 *
 * Modelling `physicalFiles` apart from `records` is the point. Every failure
 * guarded against here is a disagreement between them, so asserting only on the
 * record would miss half of it. It is a model of the file server's storage, not
 * of the disk — the real tombstone/derivative/bytes deletion is exercised
 * against a running file server separately. What is proved here is that the API
 * asks for the right operations in the right order, which is the part that lives
 * in this app.
 */
class FakeFileServer {
  records = new Map<string, FakeFileRecord>();

  physicalFiles = new Set<string>();

  /** Ordered log of every mutating call, for asserting sequence. */
  calls: string[] = [];

  failures: { updateOwnership?: Error; removeRef?: Error; delete?: Error } = {};

  /** Forces `updateFileOwnership` to report that it matched nothing. */
  ownershipMatchesNothing = false;

  /** Awaited inside `updateFileOwnership`, to interleave concurrent requests. */
  ownershipGate: Promise<void> | null = null;

  seed(file: Partial<FakeFileRecord> & { _id: ObjectId; type: string; createdBy: string }): FakeFileRecord {
    const record = {
      status: 'uploaded',
      processingStatus: 'completed',
      url: `https://cdn.example.com/${file._id.toString()}.webp`,
      refItems: [],
      ...file
    } as FakeFileRecord;

    this.records.set(record._id.toString(), record);
    this.physicalFiles.add(record._id.toString());
    return record;
  }

  userRefs(fileId: ObjectId | string): string[] {
    const record = this.records.get(fileId.toString());
    if (!record) return [];
    return record.refItems.filter((ref) => ref.itemType === 'user').map((ref) => ref.itemId.toString());
  }

  exists(fileId: ObjectId | string): boolean {
    return this.records.has(fileId.toString());
  }

  hasBytes(fileId: ObjectId | string): boolean {
    return this.physicalFiles.has(fileId.toString());
  }

  findByIds = jest.fn(async (fileIds: Array<string | ObjectId>) => fileIds
    .map((id) => this.records.get(id.toString()))
    .filter(Boolean)
    // Cloned, so the service cannot mutate the store by accident and a caller
    // holding a stale copy is a state the tests can actually create.
    .map((record) => ({ ...record, refItems: record.refItems.map((ref) => ({ ...ref })) })));

  updateFileOwnership = jest.fn(async (payload: {
    fileIds?: Array<string | ObjectId>;
    createdBy?: string;
    ref?: { itemId: ObjectId; itemType: string };
  }) => {
    this.calls.push('claim');
    if (this.ownershipGate) await this.ownershipGate;
    if (this.failures.updateOwnership) throw this.failures.updateOwnership;
    if (this.ownershipMatchesNothing) {
      return {
        updated: 0, updatedFileIds: [], errors: [], message: ''
      };
    }

    let updated = 0;
    for (const id of payload.fileIds || []) {
      const record = this.records.get(id.toString());
      if (!record) continue;
      if (payload.createdBy) record.createdBy = payload.createdBy;
      if (payload.ref) {
        const already = record.refItems.some((ref) => ref.itemType === payload.ref.itemType
          && ref.itemId.toString() === payload.ref.itemId.toString());
        if (!already) record.refItems.push({ ...payload.ref });
      }
      updated += 1;
    }

    return {
      updated, updatedFileIds: [], errors: [], message: ''
    };
  });

  removeRef = jest.fn(async (fileId: string | ObjectId, ref: { itemId: any; itemType: string }) => {
    this.calls.push(`unref:${fileId.toString()}`);
    if (this.failures.removeRef) throw this.failures.removeRef;

    const record = this.records.get(fileId.toString());
    if (!record) return;
    record.refItems = record.refItems.filter((existing) => !(existing.itemType === ref.itemType
      && existing.itemId.toString() === ref.itemId.toString()));
  });

  deleteManyByIds = jest.fn(async (fileIds: Array<string | ObjectId>) => {
    this.calls.push(`delete:${fileIds.map((id) => id.toString()).join(',')}`);
    if (this.failures.delete) throw this.failures.delete;

    let deleted = 0;
    for (const id of fileIds) {
      if (this.records.delete(id.toString())) deleted += 1;
      this.physicalFiles.delete(id.toString());
    }
    return { deleted, errors: [] };
  });
}

/**
 * A user collection whose `findOneAndUpdate` is genuinely atomic.
 *
 * The read-modify-write below contains no `await`, so two concurrent callers
 * cannot interleave inside it — the same guarantee MongoDB gives per document.
 * That property is what the concurrency assertions rest on: each caller receives
 * the exact document it displaced, never a shared pre-read.
 */
class FakeUserCollection {
  docs = new Map<string, Record<string, any>>();

  swapFailure: Error | null = null;

  /** Awaited before the atomic section, to order concurrent swaps. */
  swapGate: (() => Promise<void>) | null = null;

  seed(doc: Record<string, any> & { _id: ObjectId }) {
    this.docs.set(doc._id.toString(), { ...doc });
    return doc;
  }

  get(userId: ObjectId | string) {
    return this.docs.get(userId.toString());
  }

  findOne = jest.fn(async (filter: any) => {
    const doc = this.docs.get(filter._id.toString());
    return doc ? { ...doc } : null;
  });

  findOneAndUpdate = jest.fn(async (filter: any, update: any) => {
    if (this.swapGate) await this.swapGate();
    if (this.swapFailure) throw this.swapFailure;

    // --- atomic section: no awaits past this point ---
    const doc = this.docs.get(filter._id.toString());
    if (!doc) return null;
    const before = { ...doc };
    Object.assign(doc, update.$set);
    return before;
  });

  updateOne = jest.fn(async (filter: any, update: any) => {
    const doc = this.docs.get(filter._id.toString());
    if (!doc) return { modifiedCount: 0 };
    Object.assign(doc, update.$set);
    return { modifiedCount: 1 };
  });
}

function createService() {
  const fileServer = new FakeFileServer();
  const users = new FakeUserCollection();
  const userModel: any = { db: { collection: () => users } };
  const service = new BaseUserService(userModel, fileServer as any);

  // Several tests drive failure paths that log by design; the noise would bury a
  // real failure in the report.
  jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);

  return { service, fileServer, users };
}

/**
 * Avatar and cover are the same code path with different fields, so every
 * invariant is asserted for both rather than for whichever one was written
 * first. `apply` is the method under test; `pointer`/`urlField` are what it must
 * end up writing.
 */
const VARIANTS = [
  {
    name: 'avatar',
    type: 'avatar',
    pointer: 'avatarId',
    urlField: 'avatar',
    otherPointer: 'coverId',
    otherType: 'cover',
    apply: (service: BaseUserService, user: any, fileId: any, actor?: any) => service.updateAvatar(user, fileId, actor)
  },
  {
    name: 'cover',
    type: 'cover',
    pointer: 'coverId',
    urlField: 'cover',
    otherPointer: 'avatarId',
    otherType: 'avatar',
    apply: (service: BaseUserService, user: any, fileId: any, actor?: any) => service.updateCover(user, fileId, actor)
  }
] as const;

describe.each(VARIANTS)('profile image: $name', (variant) => {
  const ownerId = new ObjectId();
  const owner = { _id: ownerId, isAdmin: false } as any;

  function seedUser(users: FakeUserCollection, extra: Record<string, any> = {}) {
    return users.seed({ _id: ownerId, username: 'owner', ...extra });
  }

  describe('the happy path', () => {
    it('claims the file, swaps the pointer, then retires the old image — in that order', async () => {
      const { service, fileServer, users } = createService();
      const previous = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      previous.refItems.push({ itemId: ownerId, itemType: 'user' });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: previous._id });

      await variant.apply(service, owner, next._id);

      expect(fileServer.calls).toEqual([
        'claim',
        `unref:${previous._id}`,
        `delete:${previous._id}`
      ]);
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(next._id.toString());
      expect(users.get(ownerId)[variant.urlField]).toBe(next.url);
      expect(fileServer.userRefs(next._id)).toEqual([ownerId.toString()]);
      // The replaced image is gone from both the record store and storage.
      expect(fileServer.exists(previous._id)).toBe(false);
      expect(fileServer.hasBytes(previous._id)).toBe(false);
      expect(fileServer.hasBytes(next._id)).toBe(true);
    });

    it('reapplying the image already on the profile deletes nothing', async () => {
      const { service, fileServer, users } = createService();
      const current = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      current.refItems.push({ itemId: ownerId, itemType: 'user' });
      seedUser(users, { [variant.pointer]: current._id });

      await variant.apply(service, owner, current._id);

      expect(fileServer.deleteManyByIds).not.toHaveBeenCalled();
      expect(fileServer.hasBytes(current._id)).toBe(true);
      expect(fileServer.userRefs(current._id)).toEqual([ownerId.toString()]);
    });

    it('accepts a file id or a whole file record', async () => {
      const { service, fileServer, users } = createService();
      const file = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users);

      await variant.apply(service, owner, { _id: file._id, url: 'ignored' });

      expect(users.get(ownerId)[variant.pointer].toString()).toBe(file._id.toString());
      // The url written is the file server's, never the caller's copy.
      expect(users.get(ownerId)[variant.urlField]).toBe(file.url);
    });
  });

  describe('the file is refused before anything is claimed', () => {
    async function expectRefusal(setup: (fileServer: FakeFileServer) => ObjectId, expected: any) {
      const { service, fileServer, users } = createService();
      const existing = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      existing.refItems.push({ itemId: ownerId, itemType: 'user' });
      seedUser(users, { [variant.pointer]: existing._id });
      const offered = setup(fileServer);

      await expect(variant.apply(service, owner, offered)).rejects.toBeInstanceOf(expected);

      // Nothing claimed, nothing swapped, nothing deleted — and the image the
      // profile was already showing is untouched.
      expect(fileServer.updateFileOwnership).not.toHaveBeenCalled();
      expect(fileServer.deleteManyByIds).not.toHaveBeenCalled();
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(existing._id.toString());
      expect(fileServer.hasBytes(existing._id)).toBe(true);
      expect(fileServer.userRefs(existing._id)).toEqual([ownerId.toString()]);
      return fileServer;
    }

    it('rejects a file id with no record', async () => {
      await expectRefusal(() => new ObjectId(), ProfileImageNotFoundException);
    });

    it('rejects a file uploaded as a different type', async () => {
      await expectRefusal(
        (fileServer) => fileServer.seed({
          _id: new ObjectId(), type: variant.otherType, createdBy: ownerId.toString()
        })._id,
        ProfileImageWrongTypeException
      );
    });

    it('rejects a post upload passed off as a profile image', async () => {
      await expectRefusal(
        (fileServer) => fileServer.seed({
          _id: new ObjectId(), type: 'post-photo', createdBy: ownerId.toString()
        })._id,
        ProfileImageWrongTypeException
      );
    });

    it('rejects a file uploaded by another user', async () => {
      await expectRefusal(
        (fileServer) => fileServer.seed({
          _id: new ObjectId(), type: variant.type, createdBy: new ObjectId().toString()
        })._id,
        ProfileImageNotOwnedException
      );
    });

    it('rejects a file already claimed by another profile', async () => {
      await expectRefusal(
        (fileServer) => {
          const stranger = new ObjectId();
          const file = fileServer.seed({
            _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString()
          });
          file.refItems.push({ itemId: stranger, itemType: 'user' });
          return file._id;
        },
        ProfileImageNotOwnedException
      );
    });

    it('rejects a file whose processing failed', async () => {
      await expectRefusal(
        (fileServer) => fileServer.seed({
          _id: new ObjectId(),
          type: variant.type,
          createdBy: ownerId.toString(),
          status: 'error'
        })._id,
        ProfileImageNotReadyException
      );
    });

    it('rejects a file carrying a processing error', async () => {
      await expectRefusal(
        (fileServer) => fileServer.seed({
          _id: new ObjectId(),
          type: variant.type,
          createdBy: ownerId.toString(),
          processingError: 'decode failed'
        })._id,
        ProfileImageNotReadyException
      );
    });

    it('rejects a file still being processed', async () => {
      await expectRefusal(
        (fileServer) => fileServer.seed({
          _id: new ObjectId(),
          type: variant.type,
          createdBy: ownerId.toString(),
          processingStatus: 'in-queue'
        })._id,
        ProfileImageNotReadyException
      );
    });

    it('refuses an admin-uploaded file when the actor is not an admin', async () => {
      await expectRefusal(
        (fileServer) => fileServer.seed({
          _id: new ObjectId(), type: variant.type, createdBy: 'admin'
        })._id,
        ProfileImageNotOwnedException
      );
    });

    it('accepts an admin-uploaded file when an admin is the actor', async () => {
      const { service, fileServer, users } = createService();
      const file = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: 'admin' });
      seedUser(users);

      await variant.apply(service, owner, file._id, { _id: new ObjectId(), isAdmin: true });

      // Ownership transfers to the profile's owner, not the admin who uploaded.
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(file._id.toString());
      expect(fileServer.records.get(file._id.toString()).createdBy).toBe(ownerId.toString());
      expect(fileServer.userRefs(file._id)).toEqual([ownerId.toString()]);
    });
  });

  describe('failure injection', () => {
    it('the claim matches no record: the profile is left alone', async () => {
      const { service, fileServer, users } = createService();
      const existing = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: existing._id });
      fileServer.ownershipMatchesNothing = true;

      await expect(variant.apply(service, owner, next._id))
        .rejects.toBeInstanceOf(ProfileImageNotAttachableException);

      expect(users.findOneAndUpdate).not.toHaveBeenCalled();
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(existing._id.toString());
      expect(fileServer.hasBytes(existing._id)).toBe(true);
    });

    it('the claim throws: the profile is left alone', async () => {
      const { service, fileServer, users } = createService();
      const existing = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: existing._id });
      fileServer.failures.updateOwnership = new Error('file server down');

      await expect(variant.apply(service, owner, next._id)).rejects.toThrow('file server down');

      expect(users.findOneAndUpdate).not.toHaveBeenCalled();
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(existing._id.toString());
      // The new file was never referenced, so the sweeper collects it.
      expect(fileServer.userRefs(next._id)).toEqual([]);
    });

    it('claim succeeds but the pointer swap fails: the claim is released and the new file deleted', async () => {
      const { service, fileServer, users } = createService();
      const existing = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      existing.refItems.push({ itemId: ownerId, itemType: 'user' });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: existing._id });
      users.swapFailure = new Error('write concern failure');

      await expect(variant.apply(service, owner, next._id)).rejects.toThrow('write concern failure');

      // The profile and the image it was already showing are exactly as before.
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(existing._id.toString());
      expect(fileServer.exists(existing._id)).toBe(true);
      expect(fileServer.hasBytes(existing._id)).toBe(true);
      expect(fileServer.userRefs(existing._id)).toEqual([ownerId.toString()]);
      // The new file is fully gone: reference dropped first, then the bytes.
      expect(fileServer.calls).toEqual(['claim', `unref:${next._id}`, `delete:${next._id}`]);
      expect(fileServer.exists(next._id)).toBe(false);
      expect(fileServer.hasBytes(next._id)).toBe(false);
    });

    it('the user vanishes between claim and swap: the claim is released', async () => {
      const { service, fileServer, users } = createService();
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users);
      users.swapGate = async () => { users.docs.delete(ownerId.toString()); };

      await expect(variant.apply(service, owner, next._id)).rejects.toBeInstanceOf(EntityNotFoundException);

      expect(fileServer.exists(next._id)).toBe(false);
      expect(fileServer.hasBytes(next._id)).toBe(false);
    });

    it('release is best effort: a failed delete still drops the reference', async () => {
      const { service, fileServer, users } = createService();
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users);
      users.swapFailure = new Error('write concern failure');
      fileServer.failures.delete = new Error('storage unavailable');

      await expect(variant.apply(service, owner, next._id)).rejects.toThrow('write concern failure');

      // Bytes remain, but with no reference — which is exactly the state the
      // unused-file sweeper collects. Nothing is stranded permanently.
      expect(fileServer.userRefs(next._id)).toEqual([]);
      expect(fileServer.hasBytes(next._id)).toBe(true);
    });

    it('swap succeeds but retiring the old image fails: the profile is not rolled back', async () => {
      const { service, fileServer, users } = createService();
      const previous = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      previous.refItems.push({ itemId: ownerId, itemType: 'user' });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: previous._id });
      fileServer.failures.delete = new Error('storage unavailable');

      await expect(variant.apply(service, owner, next._id)).resolves.toBeDefined();

      // The new image is published and correct.
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(next._id.toString());
      expect(fileServer.userRefs(next._id)).toEqual([ownerId.toString()]);
      // The old one could not be deleted, but its reference was dropped first,
      // so the sweeper will collect it without any repair being needed.
      expect(fileServer.userRefs(previous._id)).toEqual([]);
      expect(fileServer.hasBytes(previous._id)).toBe(true);
    });

    it('swap succeeds but both cleanup steps fail: the leftover is auditable, never a broken profile', async () => {
      const { service, fileServer, users } = createService();
      const previous = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      previous.refItems.push({ itemId: ownerId, itemType: 'user' });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: previous._id });
      fileServer.failures.removeRef = new Error('file server down');
      fileServer.failures.delete = new Error('storage unavailable');

      await expect(variant.apply(service, owner, next._id)).resolves.toBeDefined();

      expect(users.get(ownerId)[variant.pointer].toString()).toBe(next._id.toString());
      expect(fileServer.userRefs(next._id)).toEqual([ownerId.toString()]);
      // The worst case: a reference no profile points at. Invisible to the
      // sweeper, which is exactly the category the audit script repairs.
      expect(fileServer.userRefs(previous._id)).toEqual([ownerId.toString()]);
    });
  });

  describe('crash windows', () => {
    it('a crash after the claim, before the swap, leaves only an auditable leftover', async () => {
      const { service, fileServer, users } = createService();
      const existing = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      existing.refItems.push({ itemId: ownerId, itemType: 'user' });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: existing._id });

      // A process death cannot run compensation, so the swap simply never
      // happens. Modelled by letting the claim land and abandoning the call.
      users.swapGate = () => new Promise<void>(() => { /* never resolves */ });
      const abandoned = variant.apply(service, owner, next._id);
      // Give the claim a turn to complete before asserting.
      await Promise.resolve();
      await Promise.resolve();
      abandoned.catch(() => undefined);

      // The profile still shows the image it had, with its reference intact —
      // no viewer sees anything wrong.
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(existing._id.toString());
      expect(fileServer.userRefs(existing._id)).toEqual([ownerId.toString()]);
      // The leftover is a referenced file no profile points at: the exact
      // category `audit-profile-image-refs.js` reports as stale and repairs.
      expect(fileServer.userRefs(next._id)).toEqual([ownerId.toString()]);
      expect(fileServer.hasBytes(next._id)).toBe(true);
    });

    it('a crash after the swap, before cleanup, never breaks the published profile', async () => {
      const { service, fileServer, users } = createService();
      const previous = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      previous.refItems.push({ itemId: ownerId, itemType: 'user' });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: previous._id });

      // Cleanup begins with a read of the current pointers; hanging there models
      // dying immediately after the swap committed.
      users.findOne.mockImplementation(() => new Promise(() => { /* never resolves */ }));
      const abandoned = variant.apply(service, owner, next._id);
      for (let i = 0; i < 5; i += 1) await Promise.resolve();
      abandoned.catch(() => undefined);

      // The new image is live and referenced — the profile is whole.
      expect(users.get(ownerId)[variant.pointer].toString()).toBe(next._id.toString());
      expect(fileServer.userRefs(next._id)).toEqual([ownerId.toString()]);
      // The old file is the auditable leftover, not a deleted live image.
      expect(fileServer.hasBytes(previous._id)).toBe(true);
      expect(fileServer.userRefs(previous._id)).toEqual([ownerId.toString()]);
    });
  });

  describe('concurrency', () => {
    it('two simultaneous replacements leave exactly one current image, and it is referenced', async () => {
      const { service, fileServer, users } = createService();
      const original = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      original.refItems.push({ itemId: ownerId, itemType: 'user' });
      const first = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      const second = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      seedUser(users, { [variant.pointer]: original._id });

      // Both requests claim their file before either swaps — the interleaving
      // that a pre-read of the current pointer cannot survive, because both
      // would then believe they replaced `original` and `first` would be left
      // referenced and uncollectable forever.
      let openGate: () => void;
      fileServer.ownershipGate = new Promise<void>((resolve) => { openGate = resolve; });

      const a = variant.apply(service, owner, first._id);
      const b = variant.apply(service, owner, second._id);
      await Promise.resolve();
      openGate();
      await Promise.allSettled([a, b]);

      const finalId = users.get(ownerId)[variant.pointer].toString();
      expect([first._id.toString(), second._id.toString()]).toContain(finalId);

      // Exactly one file survives, it is the one on the profile, and it holds
      // the reference that keeps the sweeper away from it.
      const survivors = [original, first, second].filter((f) => fileServer.exists(f._id));
      expect(survivors.map((f) => f._id.toString())).toEqual([finalId]);
      expect(fileServer.userRefs(finalId)).toEqual([ownerId.toString()]);
      expect(fileServer.hasBytes(finalId)).toBe(true);

      // Every loser is gone from storage too — no bytes left behind.
      const losers = [original, first, second].filter((f) => f._id.toString() !== finalId);
      losers.forEach((loser) => {
        expect(fileServer.hasBytes(loser._id)).toBe(false);
      });
    });

    it('never deletes the file a profile is currently serving', async () => {
      const { service, fileServer, users } = createService();
      const shared = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      shared.refItems.push({ itemId: ownerId, itemType: 'user' });
      const next = fileServer.seed({ _id: new ObjectId(), type: variant.type, createdBy: ownerId.toString() });
      // The same file is both the avatar and the cover. Replacing one must not
      // delete the image the other is still showing.
      seedUser(users, { [variant.pointer]: shared._id, [variant.otherPointer]: shared._id });

      await variant.apply(service, owner, next._id);

      expect(users.get(ownerId)[variant.otherPointer].toString()).toBe(shared._id.toString());
      expect(fileServer.exists(shared._id)).toBe(true);
      expect(fileServer.hasBytes(shared._id)).toBe(true);
      expect(fileServer.deleteManyByIds).not.toHaveBeenCalled();
    });
  });
});

describe('profile image: avatar and cover together', () => {
  const ownerId = new ObjectId();
  const owner = { _id: ownerId, isAdmin: false } as any;

  it('changing both at once leaves both pointers set and both files referenced', async () => {
    const { service, fileServer, users } = createService();
    const oldAvatar = fileServer.seed({ _id: new ObjectId(), type: 'avatar', createdBy: ownerId.toString() });
    oldAvatar.refItems.push({ itemId: ownerId, itemType: 'user' });
    const oldCover = fileServer.seed({ _id: new ObjectId(), type: 'cover', createdBy: ownerId.toString() });
    oldCover.refItems.push({ itemId: ownerId, itemType: 'user' });
    const newAvatar = fileServer.seed({ _id: new ObjectId(), type: 'avatar', createdBy: ownerId.toString() });
    const newCover = fileServer.seed({
      _id: new ObjectId(),
      type: 'cover',
      createdBy: ownerId.toString(),
      metadata: { coverBgColor: '#101014' }
    });
    users.seed({ _id: ownerId, avatarId: oldAvatar._id, coverId: oldCover._id });

    let openGate: () => void;
    fileServer.ownershipGate = new Promise<void>((resolve) => { openGate = resolve; });
    const a = service.updateAvatar(owner, newAvatar._id);
    const c = service.updateCover(owner, newCover._id);
    await Promise.resolve();
    openGate();
    await Promise.all([a, c]);

    const doc = users.get(ownerId);
    // Neither write clobbered the other: they set different fields.
    expect(doc.avatarId.toString()).toBe(newAvatar._id.toString());
    expect(doc.coverId.toString()).toBe(newCover._id.toString());
    expect(doc.coverBgColor).toBe('#101014');
    expect(fileServer.userRefs(newAvatar._id)).toEqual([ownerId.toString()]);
    expect(fileServer.userRefs(newCover._id)).toEqual([ownerId.toString()]);
    // Both replaced files are gone, and neither request deleted the other's.
    expect(fileServer.hasBytes(oldAvatar._id)).toBe(false);
    expect(fileServer.hasBytes(oldCover._id)).toBe(false);
  });

  it('releases the avatar reference when an account is deleted', async () => {
    const { service, fileServer, users } = createService();
    const avatar = fileServer.seed({ _id: new ObjectId(), type: 'avatar', createdBy: ownerId.toString() });
    avatar.refItems.push({ itemId: ownerId, itemType: 'user' });
    users.seed({
      _id: ownerId, username: 'owner', email: 'owner@example.com', avatarId: avatar._id
    });

    await service.deleteUser(ownerId.toString());

    // Deletion clears `avatarId`, so leaving the reference would create the one
    // state the sweeper can never collect.
    expect(users.get(ownerId).avatarId).toBeNull();
    expect(fileServer.exists(avatar._id)).toBe(false);
    expect(fileServer.hasBytes(avatar._id)).toBe(false);
  });
});
