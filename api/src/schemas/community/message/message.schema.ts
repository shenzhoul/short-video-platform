import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import {
  MESSAGE_SYSTEM_EVENT_LIST,
  MESSAGE_TYPE_LIST,
  MESSAGE_TYPES
} from 'src/common/constants/community';

/** One message inside a direct conversation. */
@Schema({
  collection: 'messages',
  timestamps: true
})
export class Message {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  conversationId: ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: MESSAGE_TYPE_LIST,
    default: MESSAGE_TYPES.TEXT
  })
  type: string;

  /**
   * Attached file ids, resolved against the file server at read time.
   *
   * An array rather than a single id so a future multi-attachment message does
   * not need a migration, even though the composer sends at most one today.
   */
  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    default: []
  })
  fileIds: ObjectId[];

  @Prop({
    type: String,
    default: '',
    maxlength: 5000
  })
  text: string;

  /**
   * The post this message shares, for `type: 'post'`.
   *
   * A reference, never a copy. The card is built from the post as it stands when
   * the thread is read, so a post that is later deleted or hidden stops
   * rendering; a snapshot stored here would keep showing withdrawn content, and
   * would be the one place in the system that could leak it.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  postId: ObjectId | null;

  /**
   * Who wrote it — `null` for a system notice.
   *
   * Optional rather than required precisely so a notice nobody sent does not
   * have to borrow one of the participants' identities. Attributing it to a
   * participant would be a lie the rest of the system then acts on: `lastSenderId`
   * and the reply detection behind message consent both read this field, and a
   * fake sender there would silently accept a message request nobody answered.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  senderId: ObjectId | null;

  /**
   * Which notice this is, for `type: 'system'`.
   *
   * The wording is not stored. It is resolved per reader at read time, so it
   * stays translatable rather than frozen in whichever language the background
   * job that produced it happened to run in.
   */
  @Prop({
    type: String,
    enum: MESSAGE_SYSTEM_EVENT_LIST,
    required: false
  })
  systemEvent?: string;

  /**
   * Identity of the occurrence this notice records.
   *
   * The de-duplication key, and the only thing standing between "they follow
   * each other now" and one notice per follow-status check. Built from the two
   * follow rows the transition is made of, so a later unfollow-and-refollow is a
   * different occurrence and gets its own notice.
   *
   * Carries no default, and that is load-bearing rather than tidiness. A default
   * of `null` makes Mongoose *persist* the field on every ordinary message, and
   * a stored `null` is a value the unique index happily indexes — so the second
   * text message anyone sent collided with the first. The field must be absent,
   * not empty. The index below is a partial one for the same reason: together
   * they mean an ordinary message cannot participate in this constraint even if
   * some future code path sets the field to null again.
   */
  @Prop({
    type: String,
    required: false
  })
  systemEventKey?: string;

  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;
}

export type MessageDocument = HydratedDocument<Message>;

export const MessageSchema = SchemaFactory.createForClass(Message);

/**
 * MESSAGE HISTORY INDEX
 *
 * Purpose: a conversation's messages, newest first, with cursor pagination.
 *
 * The `_id` tiebreaker is not optional here: two messages sent in the same
 * millisecond are entirely possible in a chat, and without a deterministic
 * second sort key a cursor page can repeat or skip one of them.
 */
MessageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 }, {
  name: 'idx_conversationId_createdAt_id_desc'
});

/**
 * ATTACHMENT LOOKUP INDEX
 *
 * Purpose: resolve a file back to the message referencing it, for ownership
 * checks and for reconciling processing updates from the file server.
 */
MessageSchema.index({ fileIds: 1 }, {
  name: 'idx_fileIds'
});

/**
 * SHARED POST INDEX
 *
 * Purpose: find the messages that reference a given post. Sparse because only
 * shared-post messages carry the field, and they are a small minority of a busy
 * conversation's history.
 */
MessageSchema.index({ postId: 1 }, {
  name: 'idx_postId',
  sparse: true
});

/**
 * SYSTEM NOTICE UNIQUENESS
 *
 * Purpose: one notice per occurrence, enforced by the database rather than by
 * whichever process got there first.
 *
 * This is what makes the mutual-follow notice safe under two follows landing
 * together, a double-clicked button, an API retry, a socket reconnect and two
 * open tabs: every one of them computes the same key, and only the first insert
 * survives. Sparse because ordinary messages carry no key, and unique across
 * conversations because the key already names the occurrence.
 */
MessageSchema.index({ systemEventKey: 1 }, {
  name: 'uniq_systemEventKey',
  unique: true,
  // Partial, not sparse. A sparse unique index skips documents that *lack* the
  // field but still indexes those holding an explicit `null`, so every ordinary
  // message collided on `{ systemEventKey: null }` the moment a second one was
  // written. Restricting the index to actual strings makes the constraint apply
  // to system notices alone, and keeps it that way regardless of what any
  // future write path leaves in the field.
  partialFilterExpression: { systemEventKey: { $type: 'string' } }
});

/**
 * MESSAGE SHAPE CONTRACT
 *
 * A message is either authored by somebody or it is a system notice, and the two
 * shapes must not blur into each other. This hook is what keeps that true at the
 * one place every write goes through, rather than relying on each call site to
 * remember.
 *
 * Ordinary messages have the system fields *removed* rather than rejected. They
 * are meaningless on an authored message, so a stray one is nothing a user
 * should be told about — and refusing the write would turn a harmless internal
 * slip into "you cannot send messages". Removing is also what guarantees the
 * duplicate-key crash cannot come back: no ordinary message can carry the field
 * at all, whatever a future call site passes in.
 *
 * The system branch does throw, because every part of it is load-bearing: a
 * notice without a key is a notice the unique index cannot de-duplicate, and a
 * notice with a sender would be attributed to a participant who never wrote it.
 */
MessageSchema.pre('validate', function enforceMessageShape(next) {
  const message = this as any;

  if (message.type === MESSAGE_TYPES.SYSTEM) {
    if (!message.systemEvent) {
      next(new Error('A system message must name its systemEvent.'));
      return;
    }
    if (typeof message.systemEventKey !== 'string' || !message.systemEventKey.length) {
      next(new Error('A system message must carry a non-empty systemEventKey.'));
      return;
    }
    // Authorship is what the reply detection behind message consent reads. A
    // notice that borrowed a participant's identity would silently accept a
    // message request nobody answered.
    message.senderId = null;
    next();
    return;
  }

  if (!message.senderId) {
    next(new Error('An authored message must have a senderId.'));
    return;
  }

  message.set('systemEvent', undefined);
  message.set('systemEventKey', undefined);
  next();
});
