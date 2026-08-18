import { Injectable } from "@nestjs/common";
import { PostDto } from "src/dtos/content";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { UserDto } from "src/dtos/identity/user";
import { FileServerInfoDto } from "src/dtos/shared/file-server/file-server.dto";
import { PostCreatePayload } from "src/payloads";
import { ObjectId } from 'mongodb';
import { PostCrudService } from "src/services/content/post/post-crud.service";
import { Post, PostDocument } from "src/schemas";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";

export interface IPopulatePostOptions {
  user?: UserDto | AuthUserDto;
  /**
   * request IP address
   */
  ip?: string;
}

/**
 * Post Service
 *
 * Core service for managing content posts including posts, photos, videos, and polls.
 * Handles post creation, media processing, access control, and social interactions
 * with comprehensive file management and cleanup capabilities.
 *
 * Key Features:
 * - Multi-media post creation (text, photos, videos, polls)
 * - Premium content with pay-per-view and subscription access
 * - File attachment management with automatic cleanup
 * - Hashtag extraction and statistics tracking
 * - Vote/poll functionality integration
 * - Creator subscription and payment validation
 * - Post search and filtering capabilities
 * - Automated file reference cleanup (daily cron job)
 *
 * Post Types:
 * - Text posts with optional media
 * - Photo galleries with multiple images
 * - Video content with thumbnails
 * - Polls with voting functionality
 * - Premium content requiring payment/subscription
 *
 * Access Control:
 * - Public posts (free access)
 * - Subscription-only posts (creator subscribers)
 * - Pay-per-view posts (individual purchase)
 * - Creator-only posts (private content)
 *
 * File Management:
 * - Automatic file reference tracking
 * - Daily cleanup of unreferenced files (1:00 AM cron job)
 * - File ownership validation
 * - Media processing and optimization
 *
 * Integration:
 * - Payment system for premium content
 * - Subscription system for access control
 * - Hashtag statistics tracking
 * - Poll voting system
 * - File storage and CDN
 *
 * @example Create a text post
 * ```typescript
 * const post = await postService.create({
 *   text: 'Hello world!',
 *   type: 'text',
 *   status: 'active'
 * }, creator);
 * ```
 *
 * @example Create premium post with media
 * ```typescript
 * const post = await postService.create({
 *   text: 'Exclusive content!',
 *   type: 'photo',
 *   fileIds: [imageId1, imageId2],
 *   price: 9.99,
 *   status: 'active'
 * }, creator);
 * ```
 */
@Injectable()
export class PostService {
  constructor(
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    private readonly postCrudService: PostCrudService,
  ) { }
  /**
   * Find post by ID
   *
   * Retrieves a post by ID with basic validation. Returns raw post data without population.
   * Population should be handled by ContentService for proper separation of concerns.
   *
   * @param id - Post ID to retrieve
   * @returns Promise resolving to raw PostDocument
   * @throws EntityNotFoundException if post not found
   */
  public async findOne(id: string | ObjectId): Promise<PostDto> {
    return this.postCrudService.findOne(id);
  }

  public async findByIds(ids: Array<string | ObjectId>): Promise<PostDto[]> {
    return this.postCrudService.findByIds(ids);
  }

  /**
   * Create a new post
   *
   * Creates a new post with comprehensive validation, file processing, and metadata extraction.
   * Handles media type detection, hashtag parsing, poll creation, and file reference management.
   *
   * Process:
   * 1. Validates creator exists and permissions
   * 2. Uses pre-validated files from controller, or retrieves files from fileServerService
   * 3. Determines media types from uploaded files
   * 4. Extracts and normalizes hashtags from text
   * 5. Creates poll if provided
   * 6. Updates tag statistics
   * 7. Creates post media entries
   * 8. Adds file references for cleanup tracking
   * 9. Publishes creation event
   *
   * Note: File ownership validation is handled at the controller level
   *
   * @param payload - Post creation data including content, files, and settings
   * @param user - User creating the post (creator or admin)
   * @param preValidatedFiles - Optional pre-validated files from controller to avoid duplicate queries
   * @returns Promise resolving to created PostDto
   * @throws EntityNotFoundException if creator not found
   * @example
   * ```typescript
   * const post = await postService.create({
   *   type: 'media',
   *   text: 'Check out my new content! #photography #art',
   *   fileIds: [imageFileId, videoFileId],
   *   price: 9.99,
   *   isSale: false
   * }, currentUser, validatedFiles);
   * ```
   */
  public async create(
    payload: PostCreatePayload,
    user: UserDto | AuthUserDto,
    preValidatedFiles?: { mainFiles: FileServerInfoDto[]; thumbnail: FileServerInfoDto | null; cover4x3: FileServerInfoDto | null; cover3x4: FileServerInfoDto | null; teaser: FileServerInfoDto | null }
  ): Promise<PostDto> {
    return this.postCrudService.create(payload, user, preValidatedFiles);
  }

  /**
   * Update an existing post
   *
   * Updates post content with comprehensive validation, file management, and metadata updates.
   * Handles media type changes, file reference updates, and tag statistics maintenance.
   *
   * Process:
   * 1. Validates post exists and user has permission
   * 2. Uses pre-validated files from controller, or retrieves files from fileServerService
   * 3. Updates media types based on new files
   * 4. Manages file references (add new, remove old)
   * 5. Updates tag statistics
   * 6. Handles poll updates if provided
   * 7. Publishes update event
   *
   * Note: File ownership validation is handled at the controller level
   *
   * @param id - Post ID to update
   * @param user - User performing the update (owner or admin)
   * @param payload - Updated post data
   * @returns Promise resolving to updated PostDto
   * @throws EntityNotFoundException if post not found or no permission
   * @throws HttpException if validation fails
   * @example
   * ```typescript
   * const updatedPost = await postService.updatePost(postId, currentUser, {
   *   text: 'Updated content with new hashtags #updated #content',
   *   fileIds: [newImageId, newVideoId],
   *   price: 12.99
   * });
   * ```
   */
  public async updatePost(
    id: string,
    user: UserDto | AuthUserDto,
    payload: PostCreatePayload,
    preValidatedFiles?: { mainFiles: FileServerInfoDto[]; thumbnail: FileServerInfoDto | null; cover4x3: FileServerInfoDto | null; cover3x4: FileServerInfoDto | null; teaser: FileServerInfoDto | null }
  ): Promise<PostDto> {
    return this.postCrudService.updatePost(id, user, payload, preValidatedFiles);
  }

  /**
   * Delete a post with comprehensive cleanup
   *
   * Deletes a post and performs complete cleanup including associated files,
   * media entries, polls, and file references. Only the post creator or admin
   * can delete posts. Publishes deletion event for downstream processing.
   *
   * Cleanup Process:
   * 1. Validates post exists and user has permission
   * 2. Deletes associated post media entries
   * 3. Removes post from database
   * 4. Deletes all associated files from storage
   * 5. Removes file references for cleanup tracking
   * 6. Deletes associated poll if exists
   * 7. Publishes deletion event for real-time updates
   *
   * @param id - Post ID to delete
   * @param user - User requesting deletion (must be creator or admin)
   * @returns Promise resolving to success confirmation
   * @throws EntityNotFoundException if post not found
   * @throws ForbiddenException if user doesn't own post and isn't admin
   * @example
   * ```typescript
   * const result = await postService.deletePost(postId, currentUser);
   * if (result.success) {
   *   console.log('Post and all associated data deleted successfully');
   * }
   * ```
   */
  public async deletePost(id: string | ObjectId, user: UserDto | AuthUserDto) {
    return this.postCrudService.deletePost(id, user);
  }

  public async setPinned(
    id: string | ObjectId,
    user: UserDto | AuthUserDto,
    isPinned: boolean
  ): Promise<PostDto> {
    return this.postCrudService.setPinned(id, user, isPinned);
  }

  /**
   * Count posts created by a specific creator
   *
   * Returns the total number of posts created by a creator,
   * with optional filtering conditions.
   *
   * @param userId - Creator's user ID
   * @param options - Additional query options for filtering
   * @returns Promise resolving to post count
   * @example
   * ```typescript
   * const totalPosts = await postService.countPostsByCreator(creatorId);
   * const activePosts = await postService.countPostsByCreator(creatorId, { status: 'active' });
   * ```
   */
  public async countPostsByCreator(userId: string | ObjectId, options = {}) {
    return this.postCrudService.countPostsByCreator(userId, options);
  }

  /**
   * Update comment count statistics for a post
   *
   * Increments or decrements the total comment count for a post when comments
   * are added or removed. Maintains accurate comment statistics for post analytics
   * and display purposes.
   *
   * @param postId - Post ID to update statistics for
   * @param num - Number to increment by (default: 1, can be negative for decrements)
   * @example
   * ```typescript
   * // Add comment
   * await postService.updateCommentCount(postId, 1);
   *
   * // Remove comment
   * await postService.updateCommentCount(postId, -1);
   * ```
   */
  public async updateCommentCount(postId: string, num = 1): Promise<void> {
    await this.PostModel.updateOne(
      { _id: postId },
      [
        {
          $set: {
            totalComment: {
              $max: [0, { $add: [{ $ifNull: ['$totalComment', 0] }, num] }]
            }
          }
        }
      ],
      { upsert: false }
    );
  }
}
