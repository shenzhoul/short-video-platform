import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * Interaction notification.
 *
 * Stores only semantic references — who received it, who caused it, what kind of
 * interaction it was, and which resources it points at. The rendered message,
 * icon, thumbnail and navigation target are all derived at read time, so
 * wording, routing and locale can change without touching stored rows.
 */
@Schema({
  collection: 'notifications',
  timestamps: true
})
export class Notification {
  /**
   * User who receives the notification. Every query is scoped by this field,
   * which is why it leads each index below.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  recipientId: ObjectId;

  /** User whose action produced the notification. */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  actorId: ObjectId;

  /** One of NOTIFICATION_TYPES. */
  @Prop({
    type: String,
    required: true
  })
  type: string;

  /**
   * Identity of the notification group, built by NOTIFICATION_GROUP_KEYS.
   *
   * Different types mean different things by "the same notification": likes
   * group by resource, mentions are unique per resource, follows are reusable
   * per actor, comments have both an individual and an aggregate form. Encoding
   * that as one string lets a single unique index express every policy, instead
   * of a fixed field tuple that only suited per-actor de-duplication.
   */
  @Prop({
    type: String,
    required: true
  })
  groupKey: string;

  /**
   * Whether this row stands for several events rather than one.
   *
   * Only meaningful for the adaptive comment/reply types, where individual rows
   * and an aggregate row coexist for the same resource.
   */
  @Prop({
    type: Boolean,
    default: false
  })
  isAggregate: boolean;

  /**
   * Events represented by this row.
   *
   * Always 1 for individual rows. For adaptive aggregates it counts only the
   * events the aggregate itself represents — the individual rows created before
   * the threshold was crossed remain separate history and are never counted
   * twice. Like aggregates ignore this and derive their count from the
   * authoritative reaction statistic instead.
   */
  @Prop({
    type: Number,
    default: 1,
    min: 0
  })
  activityCount: number;

  /**
   * Resource the type aggregates on: the post for POST_COMMENT, the root
   * comment for COMMENT_REPLY.
   *
   * Written on individual rows as well as aggregates so crossing the threshold
   * is a single indexed count rather than a scan.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  aggregateResourceId: ObjectId | null;

  /**
   * The domain event last folded into this row — a reaction id for likes, a
   * comment id for comments and replies.
   *
   * Queue jobs retry, so an aggregate update has to be able to recognise a
   * redelivery of an event it already counted; without this a retry would both
   * inflate the count and resurface a row the recipient had already read.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  lastEventId: ObjectId | null;

  /**
   * Post the notification points at, when there is one.
   *
   * Defaults to null rather than being left absent so the unique de-duplication
   * index below compares a concrete value: MongoDB treats a missing field and an
   * explicit null as equal, and mixing the two makes uniqueness ambiguous.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  postId: ObjectId | null;

  /**
   * Comment the notification points at. For POST_COMMENT this is the new
   * comment; for COMMENT_REPLY it is the reply. Null for the other types.
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    default: null
  })
  commentId: ObjectId | null;

  @Prop({
    type: Boolean,
    default: false
  })
  read: boolean;

  @Prop({
    type: Date,
    default: null
  })
  readAt: Date | null;

  /**
   * Time of the most recent occurrence of this interaction.
   *
   * De-duplicated repeats (unlike then like again) update this instead of
   * `createdAt`, so `createdAt` keeps its meaning as "first time this happened"
   * while the list still surfaces the notification at the top. Listing, cursor
   * pagination and the panel timestamp all read this field.
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  lastActivityAt: Date;

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

export type NotificationDocument = HydratedDocument<Notification>;

export const NotificationSchema = SchemaFactory.createForClass(Notification);

/**
 * NOTIFICATION LIST INDEX
 *
 * Purpose: the recipient's notification panel, newest activity first.
 *
 * Query Pattern:
 * - db.notifications.find({ recipientId, $or: [cursor conditions] })
 *     .sort({ lastActivityAt: -1, _id: -1 })
 *
 * The trailing `lastActivityAt, _id` pair matches the cursor sort exactly, so
 * pagination is served entirely from the index.
 */
NotificationSchema.index({
  recipientId: 1,
  lastActivityAt: -1,
  _id: -1
}, {
  name: 'idx_recipientId_lastActivityAt_id_desc'
});

/** Serves category filters (`type: { $in: [...] }`) in activity order. */
NotificationSchema.index({
  recipientId: 1,
  type: 1,
  lastActivityAt: -1,
  _id: -1
}, {
  name: 'idx_recipientId_type_lastActivityAt_id_desc'
});

/**
 * UNREAD COUNT INDEX
 *
 * Purpose: the header badge count, which runs on every authenticated page load.
 *
 * Query Pattern:
 * - db.notifications.countDocuments({ recipientId, read: false })
 */
NotificationSchema.index({
  recipientId: 1,
  read: 1
}, {
  name: 'idx_recipientId_read'
});

/**
 * GROUP IDENTITY INDEX
 *
 * Purpose: one row per (recipient, group) where the group is whatever that
 * notification type considers "the same notification".
 *
 * This replaces a fixed (recipient, actor, type, post, comment) tuple, which
 * could only express per-actor de-duplication. Aggregates need the actor to
 * change on the same row, mentions need uniqueness per resource, and comments
 * need an individual and an aggregate row to coexist — all of which this
 * expresses through the key each policy builds.
 *
 * Being unique is what makes aggregation concurrency-safe: simultaneous likes on
 * one post all upsert against this key, so exactly one group can exist and no
 * caller needs a find-then-create.
 */
NotificationSchema.index({
  recipientId: 1,
  groupKey: 1
}, {
  name: 'uniq_recipient_groupKey',
  unique: true
});

/**
 * ADAPTIVE THRESHOLD INDEX
 *
 * Purpose: count how many individual notifications a recipient already holds for
 * one resource, to decide whether the next event stays individual or starts an
 * aggregate.
 *
 * Query Pattern:
 * - db.notifications.countDocuments({ recipientId, type, aggregateResourceId, isAggregate: false })
 *
 * `recipientId` leading the key is what keeps the threshold per-recipient: a
 * busy thread with replies aimed at several people never pushes any one of them
 * into aggregate mode on someone else's activity.
 */
NotificationSchema.index({
  recipientId: 1,
  type: 1,
  aggregateResourceId: 1,
  isAggregate: 1
}, {
  name: 'idx_recipient_type_resource_isAggregate'
});
