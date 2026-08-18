import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/**
 * Media Type Enumeration - Supported content types for posts
 *
 * Defines the types of media that can be attached to posts.
 * Supports photo, video, and audio content.
 */
export enum EMediaType {
  VIDEO = 'VIDEO',
  PHOTO = 'PHOTO'
}

/**
 * Post Media Schema - Media attachments for posts
 *
 * This schema manages media files (videos and photos) that are attached to posts.
 * Each media item belongs to a specific post and user, with ordering for display sequence.
 * Links to the file storage system for actual media content.
 */
@Schema({
  collection: 'post_media',
  timestamps: true
})
export class PostMedia {
  /**
   * Reference to the post this media belongs to
   * Links to Post collection
   * Required for associating media with content
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Post',
    required: true
  })
  postId: ObjectId;

  /**
   * Reference to the user who uploaded this media
   * Links to User collection
   * Required for ownership and permissions
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true
  })
  userId: ObjectId;

  /**
   * Type of media content
   * Must be one of the supported EMediaType values
   * Determines how the media is processed and displayed
   */
  @Prop({
    type: String,
    enum: Object.values(EMediaType),
    required: true
  })
  mediaType: EMediaType;

  /**
   * Reference to the actual file in storage
   * Links to File collection for metadata and access
   * Required for retrieving the media content
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  fileId: ObjectId;

  /**
   * Display order within the post
   * Determines the sequence of media items when multiple exist
   * Lower numbers appear first (0, 1, 2, etc.)
   */
  @Prop({
    type: Number,
    default: 0
  })
  ordering: number;

  /**
   * Timestamp when this media was uploaded
   * Automatically set to current date when created
   * Used for sorting and chronological ordering
   */
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

export type PostMediaDocument = HydratedDocument<PostMedia>;
export const PostMediaSchema = SchemaFactory.createForClass(PostMedia);

/**
 * POST MEDIA RETRIEVAL INDEX
 *
 * Purpose: Efficiently retrieve media files for specific posts with ordering
 * Business Logic: Post media display, media gallery functionality
 *
 * Query Pattern:
 * - db.post_media.find({ postId: postId }).sort({ ordering: 1 })
 * - Used for displaying media files in posts
 *
 * Performance: Enables efficient post media retrieval with proper ordering
 * Use Case: Post display, media gallery
 */
PostMediaSchema.index({ postId: 1, ordering: 1 }, {
  name: 'idx_postId_ordering_retrieval'
});

/**
 * USER MEDIA TYPE FILTERING INDEX
 *
 * Purpose: Efficiently filter user's media by type for content management
 * Business Logic: User media management, type-based filtering
 *
 * Query Pattern:
 * - db.post_media.find({ userId: userId, mediaType: 'VIDEO' }).sort({ createdAt: -1 })
 * - Used for user media management and type filtering
 *
 * Performance: Enables efficient user media type queries
 * Use Case: User media management, content organization
 */
PostMediaSchema.index({ userId: 1, mediaType: 1, createdAt: -1 }, {
  name: 'idx_userId_mediaType_createdAt_management'
});

/**
 * MEDIA FILE REFERENCE INDEX
 *
 * Purpose: Efficiently find media records by file ID for cleanup operations
 * Business Logic: File cleanup, media reference management
 *
 * Query Pattern:
 * - db.post_media.find({ fileId: fileId })
 * - Used for file cleanup and reference management
 *
 * Performance: Enables efficient file reference queries
 * Use Case: File cleanup, media management
 */
PostMediaSchema.index({ fileId: 1 }, {
  name: 'idx_fileId_reference'
});
