import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { RELATIONSHIP_TYPE_LIST } from 'src/common/constants/community';

/**
 * A one-way flag one user has set on another: block or restrict.
 *
 * Its own collection rather than another `reactions` row. Follows live in
 * `reactions` because a follow is a public-ish relation, and reaction documents
 * are read by listing endpoints; a block is the opposite — it must never be
 * discoverable by the person it is set on, and putting it where reactions are
 * queried would make that a matter of remembering to filter it out everywhere.
 *
 * `userId` is always the actor and `targetId` always the subject, in both types.
 * Block is symmetric in *effect* but still stored one-way, so "who blocked whom"
 * survives an unblock by either side.
 */
@Schema({
  collection: 'user_relationships',
  timestamps: true
})
export class UserRelationship {
  /** Who set the flag. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  userId: ObjectId;

  /** Who it is set on. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  targetId: ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: RELATIONSHIP_TYPE_LIST
  })
  type: string;

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

export type UserRelationshipDocument = HydratedDocument<UserRelationship>;

export const UserRelationshipSchema = SchemaFactory.createForClass(UserRelationship);

/**
 * UNIQUE RELATIONSHIP INDEX
 *
 * Purpose: one row per (actor, subject, type), so setting a flag twice is
 * idempotent instead of accumulating duplicates that an unset would have to
 * clean up one at a time.
 *
 * Also the index that answers the permission question, which always names the
 * actor: "has A blocked B", "has A restricted B".
 */
UserRelationshipSchema.index({ userId: 1, targetId: 1, type: 1 }, {
  name: 'uniq_userId_targetId_type',
  unique: true
});

/**
 * REVERSE LOOKUP INDEX
 *
 * Purpose: "who has flagged me", which the send path needs in the other
 * direction — a message is refused because the *recipient* blocked the sender,
 * and that query starts from `targetId`.
 */
UserRelationshipSchema.index({ targetId: 1, type: 1 }, {
  name: 'idx_targetId_type'
});
