import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({
  collection: 'comments',
  timestamps: true
})
export class Comment {
  /**
   * Comment content text
   * - Typically user-entered text for a post/video/product comment
   * - Stored as plain string; sanitize before display to avoid XSS
   */
  @Prop()
  content: string;

  /**
   * The type of the object this comment refers to
   * - Examples: 'post', 'video', 'product', 'comment' (for replies)
   * - Used as a prefix in indexes for fast filtering by content type
   */
  @Prop()
  objectType: string;

  /**
   * The target object id (Mongo ObjectId)
   * - References the id of the target resource (e.g. postId, videoId)
   * - Indexed together with objectType for fast lookup of comments for an item
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  objectId: ObjectId;

  /**
   * Cached count of replies to this comment
   * - Helps avoid expensive COUNT queries when rendering comment threads
   * - Should be updated transactionally when replies are added/removed
   */
  @Prop()
  totalReply: number;

  /**
   * Cached like/upvote count for the comment
   * - Updated when users like/unlike a comment
   * - Useful for sorting or quick display without aggregation
   */
  @Prop()
  totalLike: number;

  /**
   * Nesting level of the comment
   * - 0 = top-level comment, 1 = reply to comment
   * - Restricted to 0 or 1 to keep threads shallow for performance
   */
  @Prop({
    type: Number,
    default: 0,
    min: 0,
    max: 1
  })
  level: number;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    default: null
  })
  replyToUserId: string;

  @Prop({
    type: String,
    default: ''
  })
  replyToName: string;

  /**
   * Users referenced with @ in the comment text.
   *
   * Distinct from `replyToUserId`, which is thread routing: this is who the
   * author deliberately named, and each of them is notified once.
   */
  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    default: []
  })
  mentionedUserIds: ObjectId[];

  /**
   * Reference to the user who created the comment
   * - Stored as ObjectId to the users collection
   * - Use this for user lookups and permission checks
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  createdBy: ObjectId;

  /**
   * Creation timestamp
   * - Defaults to Date.now at insert time
   * - Used for sorting and cursor-based pagination
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  /**
   * Last update timestamp
   * - Should be set when the comment content or metadata changes
   * - Helpful for caches and sync operations
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;
}

export type CommentDocument = HydratedDocument<Comment>;

export const CommentSchema = SchemaFactory.createForClass(Comment);
/**
 * PRIMARY COMMENT LISTING INDEX FOR CONTENT PAGES WITH INFINITE SCROLL
 *
 * Purpose: Efficiently retrieve comments for specific content with cursor-based pagination
 * Business Logic: Display comments on post/video/product pages sorted by newest first
 *
 * Query Patterns:
 * - Traditional: db.comments.find({ objectType: 'post', objectId: postId }).sort({ createdAt: -1 }).limit(20)
 * - Cursor-based: db.comments.find({ objectType: 'post', objectId: postId, $or: [
 *     { createdAt: { $lt: lastCreatedAt } },
 *     { createdAt: lastCreatedAt, _id: { $lt: lastId } }
 *   ]}).sort({ createdAt: -1, _id: -1 }).limit(20)
 * - Used on every content page to load comments with infinite scroll
 *
 * Performance: Critical for content page load times
 * Sorting: createdAt DESC + _id DESC for deterministic cursor-based pagination
 * Coverage: Covers objectId-only queries as a prefix
 * Cursor Support: Optimized for compound cursor (createdAt + _id) pagination
 */
CommentSchema.index({ objectType: 1, objectId: 1, createdAt: -1 }, {
  name: 'idx_objectType_objectId_createdAt_listing'
});

/**
 * USER COMMENT HISTORY INDEX FOR PROFILE PAGES
 *
 * Purpose: Retrieve user's comment history across all content types
 * Business Logic: "My Comments" page, user activity tracking, moderation tools
 *
 * Query Pattern:
 * - db.comments.find({ createdBy: userId }).sort({ createdAt: -1 }).limit(50)
 * - Used for user profile pages and admin moderation interfaces
 *
 * Performance: Enables efficient user activity queries
 * Sorting: createdAt DESC for recent activity first
 */
CommentSchema.index({ createdBy: 1, createdAt: -1 }, {
  name: 'idx_createdBy_createdAt_user_history'
});

/**
 * CONTENT MODERATION INDEX FOR ADMIN TOOLS
 *
 * Purpose: Efficiently filter comments by content type for moderation
 * Business Logic: Admin tools to review all comments on videos vs posts vs products
 *
 * Query Pattern:
 * - db.comments.find({ objectType: 'video' }).sort({ createdAt: -1 })
 * - Used in admin dashboards for content-specific moderation
 *
 * Performance: Enables fast filtering by content type
 * Use Case: Moderate video comments separately from post comments
 */
CommentSchema.index({ objectType: 1, createdAt: -1 }, {
  name: 'idx_objectType_createdAt_moderation'
});

/**
 * NESTED COMMENT CLEANUP INDEX FOR CONTENT DELETION
 *
 * Purpose: Efficiently find and delete nested comments when parent content is deleted
 * Business Logic: When a comment is deleted, all its replies (level 1) must also be deleted
 *
 * Query Pattern:
 * - db.comments.find({ objectType: 'comment', objectId: parentCommentId })
 * - Used when deleting comments to clean up nested replies
 *
 * Performance: Enables fast cleanup of nested comment structures
 * Use Case: Maintain data integrity when deleting comment threads
 */
CommentSchema.index({ objectType: 1, objectId: 1, level: 1 }, {
  name: 'idx_objectType_objectId_level_cleanup'
});
