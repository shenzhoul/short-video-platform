import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { MESSAGE_TYPE_LIST, MESSAGE_TYPES } from 'src/common/constants/community';

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

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  senderId: ObjectId;

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
