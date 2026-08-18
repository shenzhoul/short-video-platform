import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({
  collection: 'reactions',
  timestamps: true
})
export class Reaction {
  /**
   * Action type performed by the user on a content item
   * - Examples: 'like', 'favourite', 'bookmark', 'love', 'haha'
   * - Used to group and count reaction types per object
   */
  @Prop()
  action: string;

  /**
   * The type of object the reaction targets
   * - Examples: 'post', 'video', 'product', 'stream'
   * - Helps disambiguate ids that live in different collections
   */
  @Prop()
  objectType: string;

  /**
   * ID of the target object (references the collection indicated by `objectType`)
   * - Stored as ObjectId for efficient joins and aggregation
   * - Indexed by compound indexes declared below for aggregation and lookups
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  objectId: ObjectId;

  /**
   * User who performed the reaction
   * - References the users/creators collection
   * - Used for per-user lookups (e.g., "which items did the user like?")
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  createdBy: ObjectId;

  /**
   * When the reaction was created
   * - Defaults to now
   * - Used for sorting user's collections and recent activity
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  /**
   * When the reaction was last updated
   * - Kept in sync for potential future features (e.g., reaction edits)
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;
}

export type ReactionDocument = HydratedDocument<Reaction>;

export const ReactionSchema = SchemaFactory.createForClass(Reaction);

/**
 * UNIQUE CONSTRAINT INDEX FOR REACTION DEDUPLICATION
 *
 * Purpose: Prevents duplicate reactions from the same user on the same content
 * Business Logic: Each user can only have one reaction of each type per content item
 *
 * Query Pattern: Used for upsert operations and duplicate checking
 * Example: User tries to "like" a post they already liked
 *
 * Performance: O(log n) lookup for duplicate detection
 * Storage: ~24 bytes per document (3 ObjectIds)
 */
ReactionSchema.index(
  { objectType: 1, objectId: 1, action: 1, createdBy: 1 },
  { name: 'uniq_objectType_objectId_action_createdBy', unique: true }
);

/**
 * CONTENT AGGREGATION INDEX FOR REACTION COUNTS
 *
 * Purpose: Efficiently aggregate reaction counts by content and type
 * Business Logic: Display "X likes, Y bookmarks" on content items
 *
 * Query Pattern:
 * - db.reactions.aggregate([{ $match: { objectId, objectType } }, { $group: { _id: '$action', count: { $sum: 1 } } }])
 * - Used in post/video/product listing to show reaction counts
 *
 * Performance: Enables efficient grouping operations for statistics
 * Coverage: Covers single objectId queries as a prefix
 */
ReactionSchema.index({ objectType: 1, objectId: 1, action: 1 }, {
  name: 'idx_objectType_objectId_action_aggregation'
});

/**
 * USER REACTION LOOKUP INDEX FOR BULK OPERATIONS
 *
 * Purpose: Find user's reactions across multiple content items efficiently
 * Business Logic: Show which items user has liked/bookmarked in post listings
 *
 * Query Pattern:
 * - db.reactions.find({ createdBy: userId, objectId: { $in: [postId1, postId2, ...] } })
 * - Used when displaying 20+ posts to show user's reaction status
 *
 * Performance: Critical for post performance - prevents N+1 queries
 * Alternative: Without this index, would need separate query per content item
 */
ReactionSchema.index({ createdBy: 1, objectId: 1 }, {
  name: 'idx_createdBy_objectId_bulk_lookup'
});

/**
 * USER COLLECTIONS INDEX FOR FAVORITES/BOOKMARKS
 *
 * Purpose: Efficiently retrieve user's collections (favorites, bookmarks, watch later)
 * Business Logic: "My Favorites" page, "Watch Later" list, "Bookmarked Posts"
 *
 * Query Pattern:
 * - db.reactions.find({ createdBy: userId, action: 'favourite' }).sort({ createdAt: -1 })
 * - Used for user's personal collection pages with pagination
 *
 * Performance: Enables fast retrieval of user's curated content lists
 * Sorting: createdAt DESC for "recently added" ordering
 */
ReactionSchema.index({ createdBy: 1, action: 1, createdAt: -1 }, {
  name: 'idx_createdBy_action_createdAt_collections'
});

ReactionSchema.index({ createdBy: 1, objectType: 1, action: 1, createdAt: -1, _id: -1 }, {
  name: 'idx_createdBy_objectType_action_createdAt_following'
});
