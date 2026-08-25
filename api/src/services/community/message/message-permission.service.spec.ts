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
  /** Who sent the previous message, which is how a reply is recognised. */
  lastSenderId?: ObjectId | null;
}) {
  const doc: any = {
    _id: initial._id,
    pendingSenderId: initial.pendingSenderId ?? null,
    requestAccepted: initial.requestAccepted ?? false,
    lastSenderId: initial.lastSenderId ?? null
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
    findOne: jest.fn((filter: any) => {
      // `canUsersChatFreely` looks the conversation up by its participants
      // rather than by id, which this stub answers with the one document it has.
      if (filter.recipientIds) return chain({ ...doc });
      return chain(matches(filter) ? { ...doc } : null);
    }),
    updateOne: jest.fn((filter: any, update: any) => {
      const matched = matches(filter);
      if (matched) Object.assign(doc, update.$set);
      return Promise.resolve({ modifiedCount: matched ? 1 : 0 });
    })
  };
}

/** No flags set, which is how nearly every pair starts. */
const NO_FLAGS = {
  blockedByMe: false, blockedMe: false, restrictedByMe: false, restrictedMe: false
};

function createService(
  model: ReturnType<typeof createConversationModel>,
  isMutualFollow: boolean | (() => boolean),
  relationship: Partial<typeof NO_FLAGS> = {}
) {
  const followService = {
    areMutuallyFollowing: jest.fn(async () => (
      typeof isMutualFollow === 'function' ? isMutualFollow() : isMutualFollow
    ))
  };
  const relationshipService = {
    getState: jest.fn(async () => ({ ...NO_FLAGS, ...relationship }))
  };
  return {
    service: new MessagePermissionService(
      model as any,
      followService as any,
      relationshipService as any
    ),
    followService,
    relationshipService
  };
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
      expect(service.describe(model.current, alice, false, NO_FLAGS)).toMatchObject({
        canSend: false, requestState: 'waiting', awaitingReplyFrom: 'me'
      });
      expect(service.describe(model.current, bob, false, NO_FLAGS)).toMatchObject({
        canSend: true, requestState: 'waiting', awaitingReplyFrom: 'them'
      });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: false });
      expect(model.current.requestAccepted).toBe(false);
    });

    it('keeps acceptance across a reload, because it is stored', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, false);

      // A fresh read of the stored document still reports both sides free.
      expect(service.describe(model.current, alice, false, NO_FLAGS)).toMatchObject({ canSend: true, requestState: 'accepted' });
      expect(service.describe(model.current, bob, false, NO_FLAGS)).toMatchObject({ canSend: true, requestState: 'accepted' });
    });
  });

  describe('follow-state transitions', () => {
    it('keeps an accepted conversation open after an unfollow', async () => {
      // Consent is not the follow. Two people who agreed to talk stay able to
      // talk when one of them stops following the other; withdrawing it here is
      // what made the rule impossible to explain, and left no way to stop
      // somebody short of blocking them.
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, false);

      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'accepted'
      });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'accepted'
      });
      expect(model.current.requestAccepted).toBe(true);
    });

    it('returns a pair who only ever had a mutual follow to one request', async () => {
      // Nothing was ever accepted here: the mutual follow was the permission, so
      // losing it leaves an ordinary unanswered conversation rather than a
      // consent that has to be revoked.
      const model = createConversationModel({ _id: conversationId });
      let mutual = true;
      const { service } = createService(model, () => mutual);

      await service.claimSendSlot(conversationId, alice, bob);
      expect(model.current.requestAccepted).toBe(false);

      mutual = false;
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'waiting'
      });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({ allowed: false });
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

  describe('consent earned while mutual', () => {
    it('records acceptance when a mutual follower replies', async () => {
      // The exchange itself is the consent. Leaving it unrecorded because the
      // pair happened to be mutual at the time is what dropped them back to a
      // fresh request the moment either of them unfollowed.
      const model = createConversationModel({ _id: conversationId });
      const { service } = createService(model, true);

      await service.claimSendSlot(conversationId, alice, bob);
      expect(model.current.requestAccepted).toBe(false);

      // Alice's message is now the last one; Bob answering it is a reply.
      model.current.lastSenderId = alice;
      await service.claimSendSlot(conversationId, bob, alice);

      expect(model.current.requestAccepted).toBe(true);
    });

    it('keeps a mutual pair free after an unfollow once they have both spoken', async () => {
      const model = createConversationModel({ _id: conversationId });
      let mutual = true;
      const { service } = createService(model, () => mutual);

      await service.claimSendSlot(conversationId, alice, bob);
      model.current.lastSenderId = alice;
      await service.claimSendSlot(conversationId, bob, alice);

      mutual = false;
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'accepted'
      });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'accepted'
      });
    });

    it('does not record acceptance while only one of them has spoken', async () => {
      // Same rule the migration backfill uses: one-way traffic is not consent,
      // however much of it there is.
      const model = createConversationModel({ _id: conversationId });
      let mutual = true;
      const { service } = createService(model, () => mutual);

      await service.claimSendSlot(conversationId, alice, bob);
      model.current.lastSenderId = alice;
      await service.claimSendSlot(conversationId, alice, bob);
      model.current.lastSenderId = alice;

      expect(model.current.requestAccepted).toBe(false);

      mutual = false;
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'waiting'
      });
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: false
      });
    });

    it('undoes an acceptance whose message was never written', async () => {
      const model = createConversationModel({ _id: conversationId, lastSenderId: alice });
      const { service } = createService(model, true);

      const claim = await service.claimSendSlot(conversationId, bob, alice);
      expect(model.current.requestAccepted).toBe(true);

      await service.releaseSendSlot(conversationId, bob, claim);
      expect(model.current.requestAccepted).toBe(false);
    });
  });

  describe('block and restrict', () => {
    it('refuses both directions once either side has blocked', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, true, { blockedMe: true });

      // Accepted *and* mutual, and still refused: a block sits above both.
      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: false, requestState: 'blocked', restrictionReason: 'blocked'
      });
    });

    it('refuses the blocker too, not only the person they blocked', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, true, { blockedByMe: true });

      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: false, requestState: 'blocked'
      });
    });

    it('stops a restricted sender even when the pair follow each other', async () => {
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, true, { restrictedMe: true });

      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: false, requestState: 'restricted', restrictionReason: 'restricted'
      });
    });

    it('leaves the person who restricted free to write', async () => {
      // Restrict is one-way. Silencing the restricter as well would make it a
      // block with extra steps.
      const model = createConversationModel({ _id: conversationId, requestAccepted: true });
      const { service } = createService(model, false, { restrictedByMe: true });

      await expect(service.claimSendSlot(conversationId, alice, bob)).resolves.toMatchObject({
        allowed: true, requestState: 'accepted'
      });
    });

    it('does not lift a restriction because the restricter replied', async () => {
      const model = createConversationModel({ _id: conversationId });
      // Alice restricted Bob and then wrote to him; from Bob's side nothing changed.
      const alicesView = createService(model, false, { restrictedByMe: true });
      await alicesView.service.claimSendSlot(conversationId, alice, bob);

      const bobsView = createService(model, false, { restrictedMe: true });
      await expect(bobsView.service.claimSendSlot(conversationId, bob, alice)).resolves.toMatchObject({
        allowed: false, requestState: 'restricted'
      });
    });

    it('describes a blocked pair without offering a send', () => {
      const service = new MessagePermissionService({} as any, {} as any, {} as any);
      expect(service.describe(null, alice, true, { ...NO_FLAGS, blockedByMe: true }))
        .toMatchObject({ canSend: false, requestState: 'blocked', blockedByMe: true });
    });
  });

  describe('canUsersChatFreely', () => {
    /** Read-only, so it takes the relationship as the viewer A would see it. */
    const freelyService = (mutual: boolean, relationship: Partial<typeof NO_FLAGS> = {}, doc = {}) => {
      const model = createConversationModel({ _id: conversationId, ...doc });
      return { ...createService(model, mutual, relationship), model };
    };

    it('is true for mutual followers with no flags', async () => {
      const { service } = freelyService(true);
      await expect(service.canUsersChatFreely(alice, bob)).resolves.toBe(true);
    });

    it('is true for an accepted conversation, even without a follow', async () => {
      const { service } = freelyService(false, {}, { requestAccepted: true });
      await expect(service.canUsersChatFreely(alice, bob)).resolves.toBe(true);
    });

    it('is false when the viewer restricted the other person', async () => {
      // One-way, and it is the *other* side that loses the ability to send —
      // which a single-sided check would miss entirely.
      const { service } = freelyService(true, { restrictedByMe: true });
      await expect(service.canUsersChatFreely(alice, bob)).resolves.toBe(false);
    });

    it('is false when the other person restricted the viewer', async () => {
      const { service } = freelyService(true, { restrictedMe: true });
      await expect(service.canUsersChatFreely(alice, bob)).resolves.toBe(false);
    });

    it('is false for a block in either direction', async () => {
      const byMe = freelyService(true, { blockedByMe: true });
      const onMe = freelyService(true, { blockedMe: true });

      await expect(byMe.service.canUsersChatFreely(alice, bob)).resolves.toBe(false);
      await expect(onMe.service.canUsersChatFreely(alice, bob)).resolves.toBe(false);
    });

    it('is false for strangers with an unspent request', async () => {
      // `canSend` is true for them, but one message from being refused is not
      // "freely" — and a notice saying so would be wrong.
      const { service } = freelyService(false);
      await expect(service.canUsersChatFreely(alice, bob)).resolves.toBe(false);
    });

    it('is false while somebody is waiting on a reply', async () => {
      const { service } = freelyService(false, {}, { pendingSenderId: alice });
      await expect(service.canUsersChatFreely(alice, bob)).resolves.toBe(false);
    });

    it('is false for a user and themselves', async () => {
      const { service } = freelyService(true);
      await expect(service.canUsersChatFreely(alice, alice)).resolves.toBe(false);
    });

    it('changes nothing it looks at', async () => {
      // No claim, no pending request, no acceptance — it must be safe to call
      // from anywhere that only wants to describe the pair.
      const { service, model } = freelyService(false);
      const before = { ...model.current };

      await service.canUsersChatFreely(alice, bob);

      expect(model.current.pendingSenderId).toEqual(before.pendingSenderId);
      expect(model.current.requestAccepted).toBe(before.requestAccepted);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(model.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('describe', () => {
    it('reports mutual regardless of stored request state', () => {
      const service = new MessagePermissionService({} as any, {} as any, {} as any);
      expect(service.describe({ pendingSenderId: alice, requestAccepted: false }, alice, true, NO_FLAGS))
        .toEqual({
          isMutualFollow: true, canSend: true, requestState: 'mutual',
          awaitingReplyFrom: null, restrictionReason: null,
          blockedByMe: false, restrictedByMe: false
        });
    });

    it('reports an untouched conversation as sendable', () => {
      const service = new MessagePermissionService({} as any, {} as any, {} as any);
      expect(service.describe(null, alice, false, NO_FLAGS)).toMatchObject({ canSend: true, requestState: 'idle' });
    });
  });
});
