import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({
  collection: 'posts',
  timestamps: true
})
export class Post {
  /**
   * Post type: 'text' | 'photo' | 'video' | 'audio' | 'scheduled_stream'
   * - text: plain text with optional formatting (bold/emoji/links)
   * - photo: single or multiple photos
   * - video: single or video carousel with preview & thumbnail
   * - audio: audio upload (play/pause UI)
   * - scheduled_stream: scheduled live stream time + preview
   */
  @Prop()
  type: string;

  /**
   * Media types included in the post (e.g. ['photo'], ['video'], ['audio'])
   */
  @Prop({
    type: [String],
    default: []
  })
  mediaTypes: string[];

  /**
   * User id (author) of the post
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    index: true,
    required: true // Each post must be associated with a user
  })
  userId: ObjectId;

  /**
   * Post title
   */
  @Prop()
  title: string;

  /**
   * Main text/content of the post
   */
  @Prop()
  text: string;

  /**
   * Normalized hashtags extracted from text.
   */
  @Prop({
    type: [String],
    default: []
  })
  tags: string[];

  /**
   * Broad content category chosen by the creator, as a stable key from POST_TOPICS.
   *
   * Optional on purpose: forcing a choice makes creators pick something arbitrary just to submit,
   * which produces worse category data than leaving it unset.
   */
  @Prop({
    type: String,
    default: null,
    index: true
  })
  topicKey: string | null;

  /**
   * A trending hashtag the creator chose to associate this post with ("hotspot" in the UI).
   *
   * Stored as the tag string rather than a reference to a separate Hotspot entity — a trending tag
   * carries the same meaning here without a second collection to maintain.
   */
  @Prop({
    type: String,
    default: null,
    index: true
  })
  associatedTag: string | null;

  /**
   * Users referenced with @ in the post text.
   */
  @Prop({
    type: [MongooseSchema.Types.ObjectId],
    default: []
  })
  mentionedUserIds: ObjectId[];

  /**
   * Attached file ids for the post
   */
  @Prop({
    type: [{
      type: MongooseSchema.Types.ObjectId
    }]
  })
  fileIds: ObjectId[];

  /**
   * Media orientation hint (e.g., 'landscape', 'portrait')
   */
  @Prop()
  orientation: String;

  /**
   * Teaser media id used for previews
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  teaserId: ObjectId;

  /**
   * Thumbnail media id for the post
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  thumbnailId: ObjectId;

  /** Optional custom horizontal cover file. */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  cover4x3Id: ObjectId;

  /** Optional custom vertical cover file. */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  cover3x4Id: ObjectId;

  /** Resolved horizontal cover URL, including generated video thumbnails. */
  @Prop()
  cover4x3Url: string;

  /** Resolved vertical cover URL, including generated video thumbnails. */
  @Prop()
  cover3x4Url: string;

  /** Cover ratio used by Home. */
  @Prop({ default: '4:3', enum: ['4:3', '3:4'] })
  coverDisplayRatio: '4:3' | '3:4';

  /**
   * Post status (e.g., 'active', 'deleted')
   */
  @Prop({
    default: 'active'
  })
  status: String;

  /**
   * Short tagline or excerpt for the post
   */
  @Prop()
  tagline: String;

  /**
   * Total like count for the post
   */
  @Prop({
    default: 0
  })
  totalLike: Number;

  /**
   * Total comment count for the post
   */
  @Prop({
    default: 0
  })
  totalComment: number;

  /**
   * Number of distinct users who have shared the post.
   *
   * Counts share reactions, which are created once per user per post and never
   * removed, so this is a count of unique sharers rather than of share actions.
   */
  @Prop({
    type: Number,
    default: 0,
    min: 0
  })
  totalShare: number;

  /**
   * Total number of times the post detail has been viewed
   */
  @Prop({
    type: Number,
    default: 0,
    min: 0
  })
  totalView: number;

  /**
   * Creation timestamp for the post
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  /**
   * Last update timestamp for the post
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;

  /**
   * Flag set to true when the creator who owns this post has been deleted.
   * Populated by the DeleteCreatorPostListener when a creator account is deleted.
   * Used by search queries to exclude content from deleted creator accounts.
   */
  @Prop({
    default: false
  })
  isCreatorDeleted: boolean;

  /** Whether the creator has pinned this post to the top of creator-owned lists. */
  @Prop({
    type: Boolean,
    default: false
  })
  isPinned: boolean;

  /** Most recent pin time, used to order multiple pinned posts deterministically. */
  @Prop({
    type: Date,
    default: null
  })
  pinnedAt: Date | null;
}

export type PostDocument = HydratedDocument<Post>;

export const PostSchema = SchemaFactory.createForClass(Post);

/**
 * CREATOR POST PAGINATION INDEX
 *
 * Purpose: Cursor-based pagination for creator-specific post queries.
 * Also covers idx_userId_status queries via the prefix rule — no separate
 * 2-field index needed.
 *
 * Query Pattern:
 * - db.posts.find({ userId, status: 'active', $or: [cursor conditions] })
 *     .sort({ createdAt: -1, _id: -1 })
 */
PostSchema.index({
  userId: 1,
  status: 1,
  isPinned: -1,
  pinnedAt: -1,
  createdAt: -1,
  _id: -1
}, {
  name: 'idx_userId_status_pinned_createdAt_id_desc'
});

/**
 * PUBLIC SEARCH INDEX (WITH DELETED-CREATOR FILTER)
 *
 * Purpose: Covers public-facing post searches that filter by status and exclude
 *   posts from deleted creators, sorted by newest first.
 *
 * Replaces the standalone idx_status and idx_isCreatorDeleted sparse indexes.
 *
 * Query Pattern:
 * - db.posts.find({ status: 'active', isCreatorDeleted: { $ne: true } })
 *     .sort({ createdAt: -1, _id: -1 })
 * - Also used as a prefix for status-only queries (idx_status no longer needed).
 *
 * Note: createdAt + _id suffix enables efficient cursor-based pagination
 *   for public feeds that don't filter by a single userId.
 */
PostSchema.index({
  status: 1,
  isCreatorDeleted: 1,
  createdAt: -1,
  _id: -1
}, {
  name: 'idx_status_isCreatorDeleted_createdAt_id_desc'
});

/**
 * HASHTAG STATISTICS INDEX
 *
 * Supports exact reconciliation of summaries after post create, update, and
 * deletion without scanning post text.
 */
PostSchema.index({ tags: 1 }, { name: 'idx_tags' });
