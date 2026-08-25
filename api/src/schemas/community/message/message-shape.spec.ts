import { model, Model } from 'mongoose';
import { MESSAGE_SYSTEM_EVENTS, MESSAGE_TYPES } from 'src/common/constants/community';
import { ObjectId } from 'mongodb';

import { MessageSchema } from './message.schema';

/**
 * The message shape contract, exercised against the real schema.
 *
 * This is the file that would have caught the outage. `systemEventKey` was
 * declared with `default: null`, so Mongoose wrote the field on every ordinary
 * message; the unique index was `sparse`, which skips *missing* fields but
 * happily indexes an explicit `null`. The first text message in the database
 * claimed `{ systemEventKey: null }` and every later one collided with it.
 *
 * Nothing here talks to MongoDB. These assertions are about the document
 * Mongoose *produces* — whether the field is present at all — because presence
 * is precisely what decides whether the index can see it.
 */
describe('message shape contract', () => {
  let MessageModel: Model<any>;

  beforeAll(() => {
    MessageModel = model(`ShapeContractMessage${Date.now()}`, MessageSchema);
  });

  const authored = (overrides: Record<string, any> = {}) => new MessageModel({
    conversationId: new ObjectId(),
    senderId: new ObjectId(),
    type: MESSAGE_TYPES.TEXT,
    text: 'hello',
    ...overrides
  });

  describe('an authored message', () => {
    it('does not persist systemEventKey at all', async () => {
      const message = authored();
      await message.validate();

      const stored = message.toObject();
      // `toBeUndefined` would also pass for a stored null, which is the exact
      // value that caused the outage. Presence is what the index reacts to.
      expect(Object.prototype.hasOwnProperty.call(stored, 'systemEventKey')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(stored, 'systemEvent')).toBe(false);
    });

    it('does not persist the field even when a caller passes null', async () => {
      // The regression as it actually shipped: a null reaching the document.
      const message = authored({ systemEventKey: null, systemEvent: null });
      await message.validate();

      const stored = message.toObject();
      expect(Object.prototype.hasOwnProperty.call(stored, 'systemEventKey')).toBe(false);
    });

    it('strips a system key a caller wrongly supplies rather than refusing to send', async () => {
      const message = authored({ systemEventKey: 'mutual_follow:abc' });
      await message.validate();

      expect(message.toObject().systemEventKey).toBeUndefined();
    });

    it.each([
      MESSAGE_TYPES.TEXT,
      MESSAGE_TYPES.POST,
      MESSAGE_TYPES.IMAGE
    ])('holds no key for a %s message', async (type) => {
      const message = authored({ type, postId: new ObjectId() });
      await message.validate();

      expect(Object.prototype.hasOwnProperty.call(message.toObject(), 'systemEventKey')).toBe(false);
    });

    it('is refused without a sender', async () => {
      const message = authored({ senderId: null });
      await expect(message.validate()).rejects.toThrow(/senderId/);
    });

    it('leaves no two messages sharing an indexable key', async () => {
      // The collision reproduced at the document level: twenty messages, and
      // not one of them offers the unique index a value to collide on.
      const keys = await Promise.all(
        Array.from({ length: 20 }, async (_, index) => {
          const message = authored({ text: `message ${index}` });
          await message.validate();
          return message.toObject().systemEventKey;
        })
      );

      expect(keys.every((key) => key === undefined)).toBe(true);
    });
  });

  describe('a system notice', () => {
    const notice = (overrides: Record<string, any> = {}) => new MessageModel({
      conversationId: new ObjectId(),
      senderId: null,
      type: MESSAGE_TYPES.SYSTEM,
      systemEvent: MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW,
      systemEventKey: 'mutual_follow:aaa:bbb',
      text: '',
      ...overrides
    });

    it('keeps its non-empty key', async () => {
      const message = notice();
      await message.validate();

      expect(message.toObject().systemEventKey).toBe('mutual_follow:aaa:bbb');
      expect(message.toObject().systemEvent).toBe(MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW);
    });

    it('has no sender, so it cannot be mistaken for a reply', async () => {
      // Consent reads `lastSenderId` to decide whether a send was a reply. A
      // notice with a sender could accept a message request nobody answered.
      const message = notice({ senderId: new ObjectId() });
      await message.validate();

      expect(message.toObject().senderId).toBeNull();
    });

    it.each([
      ['missing', undefined],
      ['null', null],
      ['empty', '']
    ])('is refused with a %s key, which the index could not de-duplicate', async (_label, key) => {
      const message = notice({ systemEventKey: key });
      await expect(message.validate()).rejects.toThrow(/systemEventKey/);
    });

    it('is refused without a systemEvent to name it', async () => {
      const message = notice({ systemEvent: undefined });
      await expect(message.validate()).rejects.toThrow(/systemEvent/);
    });
  });

  describe('the index that enforces it', () => {
    const indexes = () => MessageSchema.indexes()
      .find(([, options]: any) => options?.name === 'uniq_systemEventKey');

    it('is partial on string keys, not sparse', () => {
      const [, options] = indexes() as any;

      expect(options.unique).toBe(true);
      expect(options.partialFilterExpression).toEqual({ systemEventKey: { $type: 'string' } });
      // Sparse is what made an explicit null indexable. The two must not both
      // be present, and sparse must not come back.
      expect(options.sparse).toBeUndefined();
    });
  });
});
