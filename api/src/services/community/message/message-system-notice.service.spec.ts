import { ObjectId } from 'mongodb';
import { MESSAGE_SYSTEM_EVENTS, MESSAGE_TYPES } from 'src/common/constants/community';

import { MessageSystemNoticeService } from './message-system-notice.service';
import { resolveSystemNoticeText } from './system-notice-text';

/**
 * The notice has to be exactly one thing: an announcement.
 *
 * Everything below guards against it becoming something else — a message with a
 * borrowed sender, a reply, an accepted request, or one notice per follow-status
 * check.
 */
const NO_FLAGS = {
  blockedByMe: false, blockedMe: false, restrictedByMe: false, restrictedMe: false
};

function createService(overrides: Record<string, any> = {}) {
  const conversationId = new ObjectId();

  // Behaves like the collection behind `uniq_systemEventKey`: a second insert
  // with a key already present is refused, exactly as MongoDB would.
  const rows: any[] = [];
  const messageModel = {
    get rows() { return rows; },
    // The service asks the thread whether it has ever carried this notice, so
    // the fake has to answer it — a stub returning null would test a path the
    // application never takes.
    findOne: jest.fn((filter: any) => ({
      select: () => ({
        lean: async () => rows.find((row) => row.conversationId?.toString() === filter.conversationId?.toString()
          && row.type === filter.type
          && row.systemEvent === filter.systemEvent) || null
      })
    })),
    create: jest.fn(async (doc: any) => {
      if (doc.systemEventKey && rows.some(row => row.systemEventKey === doc.systemEventKey)) {
        // Shaped like a real driver error, `keyPattern` included. The service
        // only treats a collision as idempotent when it can see the collision
        // was on *this* index, so a fake without it would test a path
        // production never takes.
        const error: any = new Error('E11000 duplicate key error');
        error.code = 11000;
        error.keyPattern = { systemEventKey: 1 };
        error.keyValue = { systemEventKey: doc.systemEventKey };
        throw error;
      }
      const stored = { _id: new ObjectId(), ...doc };
      rows.push(stored);
      return stored;
    }),
    ...overrides.messageModel
  };

  const followIds = overrides.followIds ?? [new ObjectId(), new ObjectId()];
  const reactionModel = {
    find: jest.fn(() => ({
      select: () => ({ lean: async () => followIds.map((id: ObjectId) => ({ _id: id })) })
    })),
    ...overrides.reactionModel
  };

  const conversationService = {
    findOrCreateDirectConversation: jest.fn().mockResolvedValue({ _id: conversationId }),
    applyLastMessage: jest.fn(),
    applySystemNotice: jest.fn().mockResolvedValue(undefined),
    ...overrides.conversationService
  };
  const participantService = {
    recordMessage: jest.fn(),
    touchActivity: jest.fn().mockResolvedValue(undefined),
    ...overrides.participantService
  };
  const permissionService = {
    canUsersChatFreely: jest.fn().mockResolvedValue(true),
    ...overrides.permissionService
  };
  const queueMessageService = {
    publish: jest.fn().mockResolvedValue(undefined),
    ...overrides.queueMessageService
  };

  return {
    service: new MessageSystemNoticeService(
      messageModel as any,
      reactionModel as any,
      conversationService as any,
      participantService as any,
      permissionService as any,
      queueMessageService as any
    ),
    messageModel,
    conversationService,
    participantService,
    permissionService,
    queueMessageService,
    conversationId
  };
}

describe('MessageSystemNoticeService', () => {
  const alice = new ObjectId();
  const bob = new ObjectId();

  it('writes one notice when the pair became mutual', async () => {
    const { service, messageModel } = createService();

    const notice = await service.announceMutualFollow(alice, bob);

    expect(notice).not.toBeNull();
    expect(messageModel.rows).toHaveLength(1);
    expect(messageModel.rows[0]).toMatchObject({
      type: MESSAGE_TYPES.SYSTEM,
      systemEvent: MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW
    });
  });

  it('does not borrow either participant as the sender', async () => {
    // A fake sender would be a lie the consent rules then act on.
    const { service, messageModel } = createService();

    await service.announceMutualFollow(alice, bob);

    expect(messageModel.rows[0].senderId).toBeNull();
  });

  it('says nothing while only one of them follows', async () => {
    const { service, messageModel } = createService({ followIds: [new ObjectId()] });

    await expect(service.announceMutualFollow(alice, bob)).resolves.toBeNull();
    expect(messageModel.create).not.toHaveBeenCalled();
    expect(messageModel.rows).toHaveLength(0);
  });

  it('writes one notice when both requests arrive at the same instant', async () => {
    const { service, messageModel } = createService();

    const outcomes = await Promise.all([
      service.announceMutualFollow(alice, bob),
      service.announceMutualFollow(bob, alice)
    ]);

    expect(messageModel.rows).toHaveLength(1);
    expect(outcomes.filter(Boolean)).toHaveLength(1);
  });

  it('is a no-op when called again for the same transition', async () => {
    // A repeated follow request, a retry, a reconnect, a second tab — all of
    // them recompute the same key and find the notice already there.
    const { service, messageModel } = createService();

    await service.announceMutualFollow(alice, bob);
    await service.announceMutualFollow(alice, bob);
    await service.announceMutualFollow(alice, bob);

    expect(messageModel.rows).toHaveLength(1);
  });

  describe('one notice per conversation, for its whole lifetime', () => {
    it('does not announce again after they unfollow and follow back', async () => {
      // The identity is the conversation, not the follow rows. Re-following is
      // the same two people in the same thread, and telling them again that
      // they can start chatting reads as a bug to the people in it.
      const { service, messageModel } = createService();

      await service.announceMutualFollow(alice, bob);
      // A re-follow: brand new follow records, same pair, same conversation.
      messageModel.create.mockClear();
      await service.announceMutualFollow(alice, bob);

      expect(messageModel.rows).toHaveLength(1);
      expect(messageModel.create).not.toHaveBeenCalled();
    });

    it('keys the notice by the conversation, so follow churn cannot move it', async () => {
      const { service, messageModel, conversationId } = createService();

      await service.announceMutualFollow(alice, bob);

      expect(messageModel.rows[0].systemEventKey)
        .toBe(`${MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW}:${conversationId.toString()}`);
      // Nothing from the follow rows may appear in it, or a re-follow would
      // change the identity again.
      expect(messageModel.rows[0].systemEventKey.split(':')).toHaveLength(2);
    });

    it('computes the same key whichever way round it is asked', async () => {
      // A conversation is already the unordered identity of a pair, so A/B and
      // B/A resolve to the same row and therefore the same key.
      const forwards = createService();
      const backwards = createService();
      await forwards.service.announceMutualFollow(alice, bob);
      await backwards.service.announceMutualFollow(bob, alice);

      const keyOf = (subject: any) => subject.messageModel.rows[0].systemEventKey
        .replace(subject.conversationId.toString(), '<conversation>');

      expect(keyOf(backwards)).toBe(keyOf(forwards));
    });

    it('recognises a notice written under the old per-follow key', async () => {
      // Rows predating the stable key carry an epoch key the new one would not
      // collide with. Without the existence check they would be announced a
      // second time the first time anything re-triggered this.
      const { service, messageModel, conversationId } = createService();
      messageModel.rows.push({
        _id: new ObjectId(),
        conversationId,
        type: MESSAGE_TYPES.SYSTEM,
        systemEvent: MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW,
        systemEventKey: `${MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW}:${new ObjectId()}:${new ObjectId()}`
      });

      await expect(service.announceMutualFollow(alice, bob)).resolves.toBeNull();
      expect(messageModel.rows).toHaveLength(1);
    });

    it('a no-op touches nothing at all', async () => {
      // Lifting a restriction on a thread that was already told must not bump
      // the conversation, mark anything unread, or emit an event.
      const {
        service, conversationService, participantService, queueMessageService, messageModel
      } = createService();

      await service.announceMutualFollow(alice, bob);
      conversationService.applySystemNotice.mockClear();
      participantService.touchActivity.mockClear();
      queueMessageService.publish.mockClear();

      await expect(service.announceMutualFollow(alice, bob)).resolves.toBeNull();

      expect(messageModel.rows).toHaveLength(1);
      expect(conversationService.applySystemNotice).not.toHaveBeenCalled();
      expect(participantService.touchActivity).not.toHaveBeenCalled();
      expect(queueMessageService.publish).not.toHaveBeenCalled();
    });

    it('treats a genuine key collision as an idempotent no-op', async () => {
      // Two writers can both read "no notice yet" and both proceed; the index is
      // what makes only one of them win, and losing must read as success.
      const conversationId = new ObjectId();
      const { service } = createService({
        conversationService: {
          findOrCreateDirectConversation: jest.fn().mockResolvedValue({ _id: conversationId })
        },
        messageModel: {
          findOne: () => ({ select: () => ({ lean: async () => null }) }),
          create: jest.fn(async () => {
            const error: any = new Error('E11000 duplicate key error');
            error.code = 11000;
            error.keyPattern = { systemEventKey: 1 };
            error.keyValue = { systemEventKey: 'mutual_follow:' + conversationId };
            throw error;
          })
        }
      });

      await expect(service.announceMutualFollow(alice, bob)).resolves.toBeNull();
    });

    it('does not swallow a duplicate key on some other index', async () => {
      // Reporting an unrelated collision as success would claim a notice was
      // written when none was.
      const { service } = createService({
        messageModel: {
          findOne: () => ({ select: () => ({ lean: async () => null }) }),
          create: jest.fn(async () => {
            const error: any = new Error('E11000 duplicate key error');
            error.code = 11000;
            error.keyPattern = { conversationId: 1, createdAt: -1 };
            throw error;
          })
        }
      });

      await expect(service.announceMutualFollow(alice, bob)).rejects.toThrow('E11000');
    });

    it('survives many restrict and block cycles with one notice', async () => {
      const { service, messageModel, permissionService } = createService();

      await service.announceMutualFollow(alice, bob);

      for (let cycle = 0; cycle < 5; cycle += 1) {
        // Flag up: refused, nothing written.
        permissionService.canUsersChatFreely.mockResolvedValueOnce(false);
        // eslint-disable-next-line no-await-in-loop
        await service.announceMutualFollow(alice, bob);
        // Flag lifted: the thread has already been told.
        // eslint-disable-next-line no-await-in-loop
        await service.announceMutualFollow(alice, bob);
      }

      expect(messageModel.rows).toHaveLength(1);
    });
  });

  describe('it announces nothing it cannot back up', () => {
    // One refusal covers block in either direction and restrict in either
    // direction: the permission service answers the whole question, and the
    // notice's job is to believe it rather than re-derive the rule.
    const refused = () => createService({
      permissionService: { canUsersChatFreely: jest.fn().mockResolvedValue(false) }
    });

    it('writes no message when the pair cannot chat freely', async () => {
      const { service, messageModel } = refused();

      await expect(service.announceMutualFollow(alice, bob)).resolves.toBeNull();
      expect(messageModel.rows).toHaveLength(0);
      expect(messageModel.create).not.toHaveBeenCalled();
    });

    it('touches no preview, no activity and no socket', async () => {
      const { service, conversationService, participantService, queueMessageService } = refused();

      await service.announceMutualFollow(alice, bob);

      expect(conversationService.applySystemNotice).not.toHaveBeenCalled();
      expect(participantService.touchActivity).not.toHaveBeenCalled();
      expect(queueMessageService.publish).not.toHaveBeenCalled();
    });

    it('burns no event key, so it can still be announced later', async () => {
      // A refused announcement must not consume the epoch: lifting the flag has
      // to be able to produce the notice that was correctly withheld.
      const { service, messageModel, permissionService } = refused();

      await service.announceMutualFollow(alice, bob);
      expect(messageModel.rows).toHaveLength(0);

      permissionService.canUsersChatFreely.mockResolvedValue(true);
      await service.announceMutualFollow(alice, bob);

      expect(messageModel.rows).toHaveLength(1);
    });

    it('asks about the pair, both ways', async () => {
      const { service, permissionService } = createService();

      await service.announceMutualFollow(alice, bob);

      expect(permissionService.canUsersChatFreely).toHaveBeenCalledWith(alice, bob);
    });

    it('does not announce twice when the flag is lifted after a valid notice', async () => {
      const { service, messageModel } = createService();

      await service.announceMutualFollow(alice, bob);
      // Whatever triggers a second attempt — an unrestrict, an unblock — the key
      // already exists for this epoch.
      await service.announceMutualFollow(alice, bob);

      expect(messageModel.rows).toHaveLength(1);
    });
  });

  describe('consent safety', () => {
    it('never writes lastSenderId', async () => {
      // That field decides whether a send counts as a reply. A notice landing
      // there could accept a message request nobody answered.
      const { service, conversationService } = createService();

      await service.announceMutualFollow(alice, bob);

      expect(conversationService.applyLastMessage).not.toHaveBeenCalled();
      expect(conversationService.applySystemNotice).toHaveBeenCalledTimes(1);
    });

    it('does not raise unread for either participant', async () => {
      const { service, participantService } = createService();

      await service.announceMutualFollow(alice, bob);

      expect(participantService.recordMessage).not.toHaveBeenCalled();
      expect(participantService.touchActivity).toHaveBeenCalledTimes(1);
    });

    it('stores no wording, so the reader decides the language', async () => {
      const { service, messageModel } = createService();

      await service.announceMutualFollow(alice, bob);

      expect(messageModel.rows[0].text).toBe('');
    });

    it('sends the wording on the realtime payload', async () => {
      // The row stores none, so a blank payload would arrive as an invisible
      // notice until somebody refetched the thread.
      const { service, queueMessageService } = createService();

      await service.announceMutualFollow(alice, bob);

      const [, payload] = queueMessageService.publish.mock.calls[0];
      // Compared against the resolver rather than an English sentence: outside a
      // Nest context i18n has nothing to look the key up in, and hard-coding the
      // copy here would make this test fail the day the wording is translated.
      expect(payload.data.message.text)
        .toBe(resolveSystemNoticeText(MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW));
      expect(payload.data.message.text).toBeTruthy();
      expect(payload.data.participantIds).toHaveLength(2);
    });

    it('refuses to announce a pair with itself', async () => {
      const { service, messageModel } = createService();

      await expect(service.announceMutualFollow(alice, alice)).resolves.toBeNull();
      expect(messageModel.rows).toHaveLength(0);
    });
  });
});
