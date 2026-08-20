import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * A direct conversation between exactly two users.
 *
 * Holds the pair identity, the denormalised preview the conversation list
 * renders, and the one piece of messaging-permission state that cannot be
 * derived from anywhere else. Everything else about permission — whether the
 * pair may talk freely at all — is read live from the follow relation, so a
 * follow or unfollow changes what happens on the next send without touching
 * this document.
 */
@Schema({
  collection: 'conversations',
  timestamps: true
})
export class Conversation {
  /**
   * Both participants, unordered.
   *
   * Kept alongside `hashKey` rather than replaced by it because membership
   * checks and "conversations of this user" queries need an indexed array, and
   * a string key cannot serve either.
   */
  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    required: true
  })
  recipientIds: ObjectId[];

  /**
   * Canonical identity of the pair: both ids sorted and joined.
   *
   * Sorting is what makes the key direction-independent, so "A starts a chat
   * with B" and "B starts a chat with A" compute the same value and the unique
   * index below collapses them into one conversation even when the two requests
   * race.
   */
  @Prop({
    type: String,
    required: true
  })
  hashKey: string;

  /**
   * The participant waiting on an unanswered message request, or null.
   *
   * Only meaningful while `requestAccepted` is false. It is a participant
   * reference rather than a boolean lock because the restriction belongs to a
   * *sender*: the person who received the request must always be able to answer
   * it. It is deliberately not a message count — counts break on deleted
   * messages, on pagination, and on history from a period when the pair was
   * mutual.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  pendingSenderId: ObjectId | null;

  /**
   * Whether the message request has been answered.
   *
   * A non-mutual pair starts closed: the initiator may send one message and
   * then waits. The recipient *replying* accepts the request, and from then on
   * both may message freely — reading it does not, because looking at a request
   * is not agreeing to it.
   *
   * Reset to false when the pair stops being mutual, so a conversation that was
   * free because of a follow does not stay free after the unfollow. That reset
   * is what keeps this from becoming an "unlocked forever" flag.
   */
  @Prop({
    type: Boolean,
    default: false
  })
  requestAccepted: boolean;

  /** Preview text for the conversation list. Truncated at write time. */
  @Prop({
    type: String,
    default: ''
  })
  lastMessage: string;

  /**
   * Type of the last message, so a list row can render "Photo" or "Video"
   * rather than an empty preview for a media-only message.
   */
  @Prop({
    type: String,
    default: null
  })
  lastMessageType: string | null;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  lastSenderId: ObjectId | null;

  /**
   * Activity time used to order the conversation list.
   *
   * Distinct from `updatedAt`, which also moves when only permission state
   * changes and would reorder the list for a non-event.
   */
  @Prop({
    type: Date,
    default: null
  })
  lastMessageCreatedAt: Date | null;

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

export type ConversationDocument = HydratedDocument<Conversation>;

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

/**
 * PAIR UNIQUENESS INDEX
 *
 * Purpose: exactly one direct conversation per pair of users.
 *
 * This is the enforcement point, not the find-then-create in the service: two
 * concurrent "open a chat with this person" requests both see no existing
 * document, and only the unique index can decide which one wins. The service
 * upserts against this key and re-reads on a duplicate-key error.
 */
ConversationSchema.index({ hashKey: 1 }, {
  name: 'uniq_hashKey',
  unique: true
});

/**
 * CONVERSATION LIST INDEX
 *
 * Purpose: "my conversations, most recent activity first".
 *
 * The trailing `_id` matches the cursor sort exactly so pagination is served
 * from the index without a separate sort stage.
 */
ConversationSchema.index({
  recipientIds: 1,
  lastMessageCreatedAt: -1,
  _id: -1
}, {
  name: 'idx_recipientIds_lastMessageCreatedAt_id_desc'
});
