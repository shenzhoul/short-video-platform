import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * One user's own view of one conversation.
 *
 * Read state is per participant, so it cannot live on the conversation: the
 * same message is unread for the recipient and read for the sender at the same
 * instant. Keeping it in its own document also means the conversation list and
 * the unread badge are both single indexed queries scoped by `userId`, rather
 * than a scan over conversations filtering an embedded array.
 */
@Schema({
  collection: 'conversation_participants',
  timestamps: true
})
export class ConversationParticipant {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  conversationId: ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  userId: ObjectId;

  /**
   * Messages in this conversation this user has not read.
   *
   * Authoritative. The client never computes it from received message payloads
   * — a replayed socket frame would otherwise be able to re-raise a count the
   * user has already cleared.
   */
  @Prop({
    type: Number,
    default: 0,
    min: 0
  })
  unreadCount: number;

  /**
   * Activity time of this conversation, mirrored per participant so the
   * conversation list sorts from this collection alone.
   */
  @Prop({
    type: Date,
    default: null
  })
  lastMessageAt: Date | null;

  @Prop({
    type: Date,
    default: null
  })
  lastReadAt: Date | null;

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

export type ConversationParticipantDocument = HydratedDocument<ConversationParticipant>;

export const ConversationParticipantSchema = SchemaFactory.createForClass(ConversationParticipant);

/**
 * PARTICIPANT IDENTITY INDEX
 *
 * Purpose: one row per (conversation, user), and the lookup key for every
 * unread increment and mark-read.
 *
 * Unique because those writes are upserts: without it, two concurrent
 * increments for the same recipient could each insert their own row and split
 * the count across two documents.
 */
ConversationParticipantSchema.index({ conversationId: 1, userId: 1 }, {
  name: 'uniq_conversationId_userId',
  unique: true
});

/**
 * CONVERSATION LIST INDEX
 *
 * Purpose: this user's conversations in activity order, with cursor pagination.
 */
ConversationParticipantSchema.index({ userId: 1, lastMessageAt: -1, _id: -1 }, {
  name: 'idx_userId_lastMessageAt_id_desc'
});

/**
 * UNREAD TOTALS INDEX
 *
 * Purpose: the header red dot and the unread totals endpoint.
 *
 * Covers both the "how many conversations are unread" count and the sum
 * aggregate, so neither needs to touch the conversation or message collections.
 */
ConversationParticipantSchema.index({ userId: 1, unreadCount: 1 }, {
  name: 'idx_userId_unreadCount'
});
