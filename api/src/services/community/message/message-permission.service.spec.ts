import { ObjectId } from 'mongodb';

import { MessagePermissionService } from './message-permission.service';

/**
 * Minimal stand-in for the conversations collection.
 *
 * `findOneAndUpdate` matches and writes without yielding, which is exactly the
 * guarantee MongoDB gives for a single document. That is what makes the
 * concurrency tests meaningful: they exercise the real filters against real
 * mutating state rather than asserting that a mock was called.
 */
function createConversationModel(initial: {
  _id: ObjectId;
  pendingSenderId?: ObjectId | null;
  requestAccepted?: boolean;
}) {
  const doc: any = {
    _id: initial._id,
    pendingSenderId: initial.pendingSenderId ?? null,
    requestAccepted: initial.requestAccepted ?? false
  };

  const matchField = (value: any, condition: any): boolean => {
    if (condition && typeof condition === 'object' && !(condition instanceof ObjectId)) {
      if ('$ne' in condition) {
        const target = condition.$ne;
        if (target === null) return value !== null && value !== undefined;
        if (typeof target === 'boolean') return value !== target;
        return !value || value.toString() !== target.toString();
      }
      if ('$nin' in condition) {
        return !condition.$nin.some((entry: any) => {
          if (entry === null) return value === null || value === undefined;
          return !!value && value.toString() === entry.toString();
        });
      }
    }
    if (condition === null) return value === null || value === undefined;
    if (typeof condition === 'boolean') return value === condition;
    return !!value && value.toString() === condition.toString();
  };

  const matches = (filter: any) => Object.entries(filter).every(([key, condition]) => {
    if (key === '_id') return doc._id.toString() === String(condition);
    return matchField(doc[key], condition);
  });

  const chain = (value: any) => ({ lean: () => Promise.resolve(value), select: () => chain(value) });

  return {
    get current() { return doc; },
    findOneAndUpdate: jest.fn((filter: any, update: any) => {
      // Match and mutate in one synchronous step. Awaiting in between would
      // model a read-then-write, which is the race MongoDB does not have and
      // this service must not rely on.
      const matched = matches(filter);
      const before = { ...doc };
      if (matched) Object.assign(doc, update.$set);
      return chain(matched ? before : null);
    }),
    findOne: jest.fn((filter: any) => chain(matches(filter) ? { ...doc } : null)),
    updateOne: jest.fn((filter: any, update: any) => {
      const matched = matches(filter);
      if (matched) Object.assign(doc, update.$set);
      return Promise.resolve({ modifiedCount: matched ? 1 : 0 });
    })
  };
}

function createService(
  model: ReturnType<typeof createConversationModel>,
  isMutualFollow: boolean | (() => boolean)
) {
  const followService = {
    areMutuallyFollowing: jest.fn(async () => (
      typeof isMutualFollow === 'function' ? isMutualFollow() : isMutualFollow
    ))
  };
  return { service: new MessagePermissionService(model as any, followService as any), followService };
}

describe('MessagePermissionService', () => {
  const conversationId = new ObjectId();
  let alice: ObjectId;
  let bob: ObjectId;

  beforeEach(() => {
    alice = new ObjectId();
    bob = new ObjectId();
  });

  describe('mutual followers', () => {
    it('lets either side send repeatedly without any request state', async () => {
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, true);

      for (const sender of [alice, bob, alice, bob]) {
        const claim = await service.claimSendSlot(conversationId, sender, sender === alice ? bob : alice);
        expect(claim).toMatchObject({ allowed: true, requestState: 'mutual' });
      }
      expect(model.current.pendingSenderId).toBeNull();
    });

    it('clears a stale waiting state so a later unfollow starts clean', async () => {
      const model = createConversationModel({ _id: conversationId, pendingSenderId: alice });
      const { service } = createService(model, true);

      await service.claimSendSlot(conversationId, alice, bob);
      expect(model.current.pendingSenderId).toBeNull();
    });
  });

  describe('the message request', () => {
    it('allows the first message and leaves the sender waiting', async () => {
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, false);

      const claim = await service.claimSendSlot(conversationId, alice, bob);

      expect(claim).toMatchObject({ allowed: true, requestState: 'waiting', transition: 'request-sent' });
      expect(model.current.pendingSenderId?.toString()).toBe(alice.toString());
      expect(model.current.requestAccepted).toBe(false);
    });

    it('rejects a second message before the request is answered', async () => {
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, false);

      await service.claimSendSlot(conversationId, alice, bob);
      const second = await service.claimSendSlot(conversationId, alice, bob);

      expect(second).toMatchObject({ allowed: false, restrictionReason: 'awaiting_reply' });
      expect(model.current.pendingSenderId?.toString()).toBe(alice.toString());
    });

    it('accepts the request when the recipient replies', async () => {
      const model = createConversationModel({ _id: conversationId, pendingSenderId: alice });
      const { service } = createService(model, false);

      const reply = await service.claimSendSlot(conversationId, bob, alice);

      expect(reply).toMatchObject({ allowed: true, requestState: 'accepted', transition: 'request-accepted' });
      expect(model.current.requestAccepted).toBe(true);
      // Nobody is waiting any more — this is the point of the correction.
      expect(model.current.pendingSenderId).toBeNull();
    });

    it('frees BOTH participants once the request is accepted', async () => {
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, false);

      await service.claimSendSlot(conversationId, alice, bob);
      await service.claimSendSlot(conversationId, bob, alice);

      // The initiator may now send consecutively...
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: true });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: true });
      // ...and so may the person who accepted. No alternating turn-taking.
      await expect(service.claimSendSlot(conversationId, bob, alice)).resolves.toMatchObject({ allowed: true });
      await expect(service.claimSendSlot(conversationId, bob, alice)).resolves.toMatchObject({ allowed: true });
    });

    it('does not accept the request merely because it was read', async () => {
      const model = createConversationModel({ _id: conversationId, pendingSenderId: alice });
      const { service } = createService(model, false);

      // Reading invokes nothing here; the state is untouched.
      expect(service.describe(model.current, alice, false)).toMatchObject({
        canSend: false, requestState: 'waiting', awaitingReplyFrom: 'me'
      });
      expect(service.describe(model.current, bob, false)).toMatchObject({
        canSend: true, requestState: 'waiting', awaitingReplyFrom: 'them'
      });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: false });
      expect(model.current.requestAccepted).toBe(false);
    });

    it('keeps acceptance across a reload, because it is stored', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, false);

      // A fresh read of the stored document still reports both sides free.
      expect(service.describe(model.current, alice, false)).toMatchObject({ canSend: true, requestState: 'accepted' });
      expect(service.describe(model.current, bob, false)).toMatchObject({ canSend: true, requestState: 'accepted' });
    });
  });

  describe('follow-state transitions', () => {
    it('returns an accepted conversation to a fresh request after an unfollow', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, false);

      await service.resetRequestState(conversationId);
      expect(model.current.requestAccepted).toBe(false);
      expect(model.current.pendingSenderId).toBeNull();

      // The next sender gets one request message, then waits again.
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: true });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: false });
      // And the recipient's reply accepts it again.
      await expect(service.claimSendSlot(conversationId, bob, alice)).resolves.toMatchObject({
        allowed: true, requestState: 'accepted'
      });
    });

    it('releases a waiting sender as soon as the pair becomes mutual', async () => {
      const model = createConversationModel({ _id: conversationId });
      let mutual = false;
      const { service } = createService(model, () => mutual);

      await service.claimSendSlot(conversationId, alice, bob);
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: false });

      mutual = true;
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'mutual'
      });
      expect(model.current.pendingSenderId).toBeNull();
    });
  });

  describe('concurrency', () => {
    it('lets exactly one of six simultaneous first messages through', async () => {
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, false);

      const claims = await Promise.all(
        Array.from({ length: 6 }, () => service.claimSendSlot(conversationId, alice, bob))
      );

      expect(claims.filter((c) => c.allowed)).toHaveLength(1);
      expect(model.current.pendingSenderId?.toString()).toBe(alice.toString());
      expect(model.current.requestAccepted).toBe(false);
    });

    it('accepts once when the recipient replies twice at the same moment', async () => {
      const model = createConversationModel({ _id: conversationId, pendingSenderId: alice });
      const { service } = createService(model, false);

      const [first, second] = await Promise.all([
        service.claimSendSlot(conversationId, bob, alice),
        service.claimSendSlot(conversationId, bob, alice)
      ]);

      // Both are allowed — after acceptance everyone is free — but only one
      // performed the acceptance transition.
      expect(first.allowed && second.allowed).toBe(true);
      expect([first.transition, second.transition].filter((t) => t === 'request-accepted')).toHaveLength(1);
      expect(model.current.requestAccepted).toBe(true);
    });

    it('does not restrict anyone once accepted, however many send at once', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, false);

      const claims = await Promise.all([
        ...Array.from({ length: 4 }, () => service.claimSendSlot(conversationId, alice, bob)),
        ...Array.from({ length: 4 }, () => service.claimSendSlot(conversationId, bob, alice))
      ]);
      expect(claims.every((c) => c.allowed)).toBe(true);
    });
  });

  describe('claim compensation', () => {
    it('undoes a request that was never written', async () => {
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, false);

      const claim = await service.claimSendSlot(conversationId, alice, bob);
      await expect(service.releaseSendSlot(conversationId, alice, claim)).resolves.toBe(true);

      expect(model.current.pendingSenderId).toBeNull();
      // The sender is not left falsely blocked.
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: true });
    });

    it('undoes an acceptance that was never written', async () => {
      const model = createConversationModel({ _id: conversationId, pendingSenderId: alice });
      const { service } = createService(model, false);

      const claim = await service.claimSendSlot(conversationId, bob, alice);
      expect(model.current.requestAccepted).toBe(true);

      await expect(service.releaseSendSlot(conversationId, bob, claim)).resolves.toBe(true);
      // Back to the initiator waiting: the request was never actually answered.
      expect(model.current.requestAccepted).toBe(false);
      expect(model.current.pendingSenderId?.toString()).toBe(alice.toString());
    });

    it('does not revert a newer transition made by somebody else', async () => {
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, false);

      const claim = await service.claimSendSlot(conversationId, alice, bob);
      // Before the rollback runs, B answers and the request is accepted.
      await service.claimSendSlot(conversationId, bob, alice);

      const reverted = await service.releaseSendSlot(conversationId, alice, claim);

      expect(reverted).toBe(false);
      expect(model.current.requestAccepted).toBe(true);
    });

    it('does nothing when the claim changed nothing', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, false);

      const claim = await service.claimSendSlot(conversationId, alice, bob);
      expect(claim.transition).toBe('none');
      await expect(service.releaseSendSlot(conversationId, alice, claim)).resolves.toBe(false);
      expect(model.current.requestAccepted).toBe(true);
    });
  });

  describe('describe', () => {
    it('reports mutual regardless of stored request state', () => {
      const service = new MessagePermissionService({} as any, {} as any);
      expect(service.describe({ pendingSenderId: alice, requestAccepted: false }, alice, true))
        .toEqual({
          isMutualFollow: true, canSend: true, requestState: 'mutual',
          awaitingReplyFrom: null, restrictionReason: null
        });
    });

    it('reports an untouched conversation as sendable', () => {
      const service = new MessagePermissionService({} as any, {} as any);
      expect(service.describe(null, alice, false)).toMatchObject({ canSend: true, requestState: 'idle' });
    });
  });
});
