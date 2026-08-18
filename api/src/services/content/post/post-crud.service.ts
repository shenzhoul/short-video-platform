import { ForbiddenException, HttpException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { PostDto } from "src/dtos/content";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { UserDto } from "src/dtos/identity/user";
import { FileServerInfoDto } from "src/dtos/shared/file-server/file-server.dto";
import { EntityNotFoundException, QueueMessageService } from "src/kernel";
import { PostCreatePayload } from "src/payloads";
import { Post, PostDocument } from "src/schemas";
import { ObjectId } from 'mongodb';
import { FILE_REFERENCE_TYPES, POST_CHANNELS, POST_TYPES } from "src/common/constants";
import { __t } from "src/utils/translation";
import { extractAndNormalizeHashtags } from "src/common/utils/hashtag.util";
import { EVENT } from "src/kernel/constants";
import { UserAccountManagementService } from "src/services/identity";
import { PostMediaService } from './post-media.service';
import { FileServerService } from "src/services/shared/file-server";
import { TagStatisticsService } from "src/services/content/tag";
import { difference } from "lodash";

/**
 * PostCrudService
 *
 * Handles basic CRUD operations for posts including:
 * - Creating new posts
 * - Reading/finding posts by ID or multiple IDs
 * - Updating existing posts
 * - Deleting posts
 * - Data population and enrichment
 *
 * This service focuses on core database operations and data management
 * without complex business logic or search functionality.
 */
@Injectable()
export class PostCrudService {
  constructor(
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    private readonly postMediaService: PostMediaService,
    private readonly userService: UserAccountManagementService,
    private readonly fileServerService: FileServerService,
    private readonly queueMessageService: QueueMessageService,
    private readonly tagStatisticsService: TagStatisticsService,
  ) { }
  /**
  * Find post by ID
  *
  * Retrieves a single post by its unique identifier.
  * Returns null if post is not found.
  *
  * @param id - Post ID to search for
  * @returns Promise resolving to PostDto or null
  * @example
  * ```typescript
  * const post = await postService.findById('507f1f77bcf86cd799439011');
  * if (post) {
  *   console.log(`Found post: ${post.title}`);
  * }
  * ```
  */
  public async findById(id: string | ObjectId): Promise<PostDto | null> {
    const data = await this.PostModel.findById(id);
    if (!data) return null;
    return PostDto.fromModel(data);
  }

  /**
   * Reduce client-supplied mention ids to accounts that actually exist.
   *
   * The client picks mentions from an autocomplete, but the ids arrive as plain request data, so
   * they are re-checked here rather than trusted. Unknown ids are dropped instead of throwing: a
   * mention that no longer resolves (deleted account, stale suggestion) should not block publishing.
   */
  private async resolveMentionedUserIds(ids?: string[]): Promise<ObjectId[]> {
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if (!uniqueIds.length) return [];

    const users = await this.userService.findByIds(uniqueIds);
    return users.map(user => new ObjectId(user._id));
  }

  /**
   * Normalize an associated hashtag, keeping it only if that tag actually exists.
   *
   * The client picks from a trending list, but the value arrives as free text, so it is checked
   * here rather than trusted — otherwise a post could claim association with any arbitrary string.
   */
  private async resolveAssociatedTag(tag?: string | null): Promise<string | null> {
    const normalized = (tag || '').trim().replace(/^#/, '').toLowerCase();
    if (!normalized) return null;

    const exists = await this.tagStatisticsService.tagExists(normalized);
    return exists ? normalized : null;
  }

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
    const post = await this.findById(id);
    if (!post) {
      throw new EntityNotFoundException();
    }
    return post;
  }

  public async findByIds(ids: Array<string | ObjectId>): Promise<PostDto[]> {
    if (!ids.length) return [];
    const posts = await this.PostModel.find({ _id: { $in: ids } });
    return posts.map((post) => PostDto.fromModel(post));
  }

  /** Pin or unpin an owned post. Repeating the same operation is intentionally idempotent. */
  public async setPinned(
    id: string | ObjectId,
    user: UserDto | AuthUserDto,
    isPinned: boolean
  ): Promise<PostDto> {
    const post = await this.findById(id);
    if (!post) throw new EntityNotFoundException();
    if (post.userId.toString() !== user._id.toString()) {
      throw new ForbiddenException();
    }
    if (Boolean(post.isPinned) === isPinned) return post;

    const pinnedAt = isPinned ? new Date() : null;
    const updated = await this.PostModel.findByIdAndUpdate(
      id,
      { $set: { isPinned, pinnedAt, updatedAt: new Date() } },
      { new: true }
    );
    if (!updated) throw new EntityNotFoundException();
    return PostDto.fromModel(updated);
  }


  /**
   * Detect media orientation from a list of files.
   *
   * Reads width/height of the first file with valid dimensions
   * (image or video) and classifies the post as:
   * - 'landscape' when width > height
   * - 'portrait'  when height > width
   * - 'square'    when width === height
   *
   * Returns `null` when no file with usable dimensions is found
   * (e.g. text posts, audio-only, or files still being processed).
   *
   * @param files - Validated main media files for the post
   * @returns Orientation string or null when undetectable
   */
  private detectOrientation(files: FileServerInfoDto[]): string | null {
    if (!files?.length) return null;

    // Pick the first media file (image/video) that has dimensions
    const reference = files.find(
      (file) => (file.isImage?.() || file.isVideo?.() || file.mimeType?.startsWith('image/') || file.mimeType?.startsWith('video/'))
        && typeof file.width === 'number'
        && typeof file.height === 'number'
        && file.width > 0
        && file.height > 0
    );

    if (!reference) return null;

    const width = Number(reference?.width || 0)
    const height = Number(reference?.height || 0)

    if (width > height) return 'landscape';
    if (height > width) return 'portrait';
    return 'square';
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
    const userId = user.isAdmin && payload.userId ? new ObjectId(payload.userId) : user._id;
    const creator = await this.userService.findById(userId); ``
    if (!creator) throw new EntityNotFoundException();

    // Use pre-validated files if provided (from controller), otherwise get files from fileServerService
    let mainFiles: FileServerInfoDto[] = [];
    if (preValidatedFiles) {
      mainFiles = preValidatedFiles.mainFiles;
    } else if (payload.fileIds && payload.fileIds.length > 0) {
      mainFiles = await this.fileServerService.findByIds(payload.fileIds);
    }

    // Type-specific validation and mediaTypes
    const mediaTypes: string[] = [];
    switch (payload.type) {
      case POST_TYPES.PHOTO:
        if (!payload.fileIds || payload.fileIds.length === 0) {
          throw new HttpException(__t('errors.media_posts_must_contain_file'), 400);
        }
        if (mainFiles.some((f) => !f.isImage())) {
          throw new HttpException(__t('errors.media_posts_only_image_video'), 400);
        }
        mediaTypes.push('photo');
        break;
      case POST_TYPES.VIDEO:
        if (!payload.fileIds || payload.fileIds.length === 0) {
          throw new HttpException(__t('errors.media_posts_must_contain_file'), 400);
        }
        if (mainFiles.some((f) => !f.isVideo())) {
          throw new HttpException(__t('errors.media_posts_only_image_video'), 400);
        }
        mediaTypes.push('video');
        break;
      case POST_TYPES.TEXT:
      default:
        if (mainFiles.length > 0) {
          const hasPhotos = mainFiles.some((f) => f.isImage());
          if (hasPhotos) mediaTypes.push('photo');
        }
        break;
    }

    // Detect orientation from actual media dimensions (landscape/portrait/square).
    // Only meaningful for media posts; defaults to null otherwise.
    const orientation = payload.type === 'media' ? this.detectOrientation(mainFiles) : null;

    // Parse hashtags from description
    const tags = payload.text ? extractAndNormalizeHashtags(payload.text) : [];
    const mentionedUserIds = await this.resolveMentionedUserIds(payload.mentionedUserIds);
    const associatedTag = await this.resolveAssociatedTag(payload.associatedTag);

    const generatedCoverUrls = FileServerInfoDto.normalizeThumbnailUrls(mainFiles[0]?.thumbnails);
    const generatedCover = generatedCoverUrls[payload.coverThumbnailIndex ?? 0]
      || generatedCoverUrls[0];
    const cover4x3Url = preValidatedFiles?.cover4x3?.url
      || preValidatedFiles?.thumbnail?.url
      || generatedCover;
    const cover3x4Url = preValidatedFiles?.cover3x4?.url || generatedCover || cover4x3Url;
    const persistedPayload: any = { ...payload };
    delete persistedPayload.coverThumbnailIndex;

    const postData: any = {
      ...persistedPayload,
      tags,
      mentionedUserIds,
      associatedTag,
      topicKey: payload.topicKey || null,
      mediaTypes,
      orientation,
      cover4x3Url,
      cover3x4Url,
      coverDisplayRatio: payload.coverDisplayRatio || '4:3',
      userId,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    const post = new this.PostModel(postData);

    await post.save();

    // Update tag statistics
    if (tags.length > 0) {
      await this.tagStatisticsService.reconcileTagStatistics(tags);
    }

    if (post.fileIds && post.fileIds.length) {
      const mediaItems = await Promise.all(
        post.fileIds.map(async (fileId, index) => ({
          fileId,
          mediaType: await this.postMediaService.determineMediaType(fileId),
          ordering: index
        }))
      );

      await this.postMediaService.createMultiplePostMedia(
        post._id,
        userId,
        mediaItems
      );

      // Use batch addRef for better performance - collect all file IDs
      const allFileIds = [...post.fileIds];
      if (post.teaserId) allFileIds.push(post.teaserId);
      if (post.thumbnailId) allFileIds.push(post.thumbnailId);
      if (post.cover4x3Id) allFileIds.push(post.cover4x3Id);
      if (post.cover3x4Id) allFileIds.push(post.cover3x4Id);

      if (allFileIds.length > 0) {
        await this.fileServerService.updateFileOwnership({
          fileIds: [...new Set(allFileIds.map(id => id.toString()))],
          createdBy: creator._id.toString(),
          ref: {
            itemId: post._id,
            itemType: FILE_REFERENCE_TYPES.POST
          }
        });
      }
    } else {
      // Handle teaser and thumbnail separately if no main files
      const singleFileIds = [];
      if (post.teaserId) singleFileIds.push(post.teaserId);
      if (post.thumbnailId) singleFileIds.push(post.thumbnailId);
      if (post.cover4x3Id) singleFileIds.push(post.cover4x3Id);
      if (post.cover3x4Id) singleFileIds.push(post.cover3x4Id);

      if (singleFileIds.length > 0) {
        await this.fileServerService.updateFileOwnership({
          fileIds: [...new Set(singleFileIds.map(id => id.toString()))],
          createdBy: creator._id.toString(),
          ref: {
            itemId: post._id,
            itemType: FILE_REFERENCE_TYPES.POST
          }
        });
      }
    }

    const dto = PostDto.fromModel(post);
    await this.queueMessageService.publish(POST_CHANNELS.CREATOR_POST, {
      eventName: EVENT.CREATED,
      data: dto
    });

    return dto;
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
    const post = await this.PostModel.findById(id);
    if (!post || (!user.isAdmin && post.userId.toString() !== user._id.toString())) throw new EntityNotFoundException();

    // Use pre-validated files if provided (from controller), otherwise get files from fileServerService
    let mainFiles: FileServerInfoDto[] = [];
    if (preValidatedFiles) {
      mainFiles = preValidatedFiles.mainFiles;
    } else if (payload.fileIds && payload.fileIds.length > 0) {
      mainFiles = await this.fileServerService.findByIds(payload.fileIds);
    }

    // Type-specific validation and mediaTypes
    const mediaTypes: string[] = [];
    switch (payload.type) {
      case POST_TYPES.PHOTO:
        if (!payload.fileIds || payload.fileIds.length === 0) {
          throw new HttpException(__t('errors.media_posts_must_contain_file'), 400);
        }
        if (mainFiles.some((f) => !f.isImage())) {
          throw new HttpException(__t('errors.media_posts_only_image_video'), 400);
        }
        mediaTypes.push('photo');
        break;
      case POST_TYPES.VIDEO:
        if (!payload.fileIds || payload.fileIds.length === 0) {
          throw new HttpException(__t('errors.media_posts_must_contain_file'), 400);
        }
        if (mainFiles.some((f) => !f.isVideo())) {
          throw new HttpException(__t('errors.media_posts_only_image_video'), 400);
        }
        mediaTypes.push('video');
        break;
      case POST_TYPES.TEXT:
      default:
        if (mainFiles.length > 0) {
          const hasPhotos = mainFiles.some((f) => f.isImage());
          if (hasPhotos) mediaTypes.push('photo');
        }
        break;
    }

    // Handle thumbnail and teaser removal/replacement - collect files to delete for batch operation
    const filesToDelete = [];

    if (post.thumbnailId && payload.thumbnailId === null) {
      // Only remove thumbnail if explicitly set to null
      filesToDelete.push(post.thumbnailId);
    } else if (post.thumbnailId && payload.thumbnailId && payload.thumbnailId !== post.thumbnailId.toString()) {
      // Replace existing thumbnail with new one
      filesToDelete.push(post.thumbnailId);
    }

    if (post.cover4x3Id && payload.cover4x3Id === null) {
      filesToDelete.push(post.cover4x3Id);
    } else if (post.cover4x3Id && payload.cover4x3Id && payload.cover4x3Id !== post.cover4x3Id.toString()) {
      filesToDelete.push(post.cover4x3Id);
    }

    if (post.cover3x4Id && payload.cover3x4Id === null) {
      filesToDelete.push(post.cover3x4Id);
    } else if (post.cover3x4Id && payload.cover3x4Id && payload.cover3x4Id !== post.cover3x4Id.toString()) {
      filesToDelete.push(post.cover3x4Id);
    }

    if (post.teaserId && payload.teaserId === null) {
      // Only remove teaser if explicitly set to null
      filesToDelete.push(post.teaserId);
    } else if (post.teaserId && payload.teaserId && payload.teaserId !== post.teaserId.toString()) {
      // Replace existing teaser with new one
      filesToDelete.push(post.teaserId);
    }

    // Delete files in batch if any
    if (filesToDelete.length > 0) {
      const retainedFileIds = new Set([
        ...(payload.fileIds ?? post.fileIds ?? []),
        payload.thumbnailId === undefined ? post.thumbnailId : payload.thumbnailId,
        payload.cover4x3Id === undefined ? post.cover4x3Id : payload.cover4x3Id,
        payload.cover3x4Id === undefined ? post.cover3x4Id : payload.cover3x4Id,
        payload.teaserId === undefined ? post.teaserId : payload.teaserId
      ].filter(Boolean).map(fileId => fileId.toString()));
      const deletableFileIds = [...new Set(filesToDelete.map(fileId => fileId.toString()))]
        .filter(fileId => !retainedFileIds.has(fileId));
      if (deletableFileIds.length) {
        await this.fileServerService.deleteManyByIds(deletableFileIds);
      }
    }

    const previousTags = extractAndNormalizeHashtags(post.text || '');

    // Parse hashtags from description
    const tags = payload.text ? extractAndNormalizeHashtags(payload.text) : [];

    // Recompute orientation from updated media. Clear it for non-media posts.
    const orientation = payload.type === 'media' ? this.detectOrientation(mainFiles) : null;

    const persistedPayload: any = { ...payload };
    delete persistedPayload.coverThumbnailIndex;
    const data: any = {
      ...persistedPayload,
      tags,
      mediaTypes,
      orientation
    };
    // Only touch these when the client actually sent them, so a partial update cannot silently
    // clear a post's existing topic or mentions.
    if (payload.mentionedUserIds !== undefined) {
      data.mentionedUserIds = await this.resolveMentionedUserIds(payload.mentionedUserIds);
    }
    if (payload.topicKey !== undefined) {
      data.topicKey = payload.topicKey || null;
    }
    if (payload.associatedTag !== undefined) {
      data.associatedTag = await this.resolveAssociatedTag(payload.associatedTag);
    }
    const generatedCoverUrls = FileServerInfoDto.normalizeThumbnailUrls(mainFiles[0]?.thumbnails);
    const generatedCover = generatedCoverUrls[payload.coverThumbnailIndex ?? 0]
      || generatedCoverUrls[0];
    if (payload.coverThumbnailIndex !== undefined) {
      data.cover4x3Url = generatedCover || post.cover4x3Url;
      data.cover3x4Url = generatedCover || post.cover3x4Url;
    }
    if (preValidatedFiles?.cover4x3) data.cover4x3Url = preValidatedFiles.cover4x3.url;
    if (preValidatedFiles?.cover3x4) data.cover3x4Url = preValidatedFiles.cover3x4.url;

    // Handle explicit null values for removal
    if (payload.thumbnailId === null || payload.thumbnailId === '') {
      data.thumbnailId = null;
    }
    if (payload.cover4x3Id === null || payload.cover4x3Id === '') {
      data.cover4x3Id = null;
      data.cover4x3Url = generatedCover || null;
    }
    if (payload.cover3x4Id === null || payload.cover3x4Id === '') {
      data.cover3x4Id = null;
      data.cover3x4Url = generatedCover || data.cover4x3Url || null;
    }
    if (payload.teaserId === null || payload.teaserId === '') {
      data.teaserId = null;
    }

    // Handle type changes — clear incompatible files when switching to text or to a different media type
    const needsMediaClear = payload.type === POST_TYPES.TEXT;
    const wasMediaType = [POST_TYPES.PHOTO, POST_TYPES.VIDEO, 'media'].includes(post.type as string);
    if (post.type !== payload.type && wasMediaType && needsMediaClear) {
      const typeChangeFilesToDelete = [...(post.fileIds || [])];
      if (post.thumbnailId) {
        typeChangeFilesToDelete.push(post.thumbnailId);
        data.thumbnailId = null;
      }
      if (post.cover4x3Id) {
        typeChangeFilesToDelete.push(post.cover4x3Id);
        data.cover4x3Id = null;
        data.cover4x3Url = null;
      }
      if (post.cover3x4Id) {
        typeChangeFilesToDelete.push(post.cover3x4Id);
        data.cover3x4Id = null;
        data.cover3x4Url = null;
      }
      if (post.teaserId) {
        typeChangeFilesToDelete.push(post.teaserId);
        data.teaserId = null;
      }
      data.fileIds = [];
      data.mediaTypes = [];
      if (typeChangeFilesToDelete.length > 0) {
        await this.fileServerService.deleteManyByIds([...new Set(typeChangeFilesToDelete.map(fileId => fileId.toString()))]);
      }
    }

    const oldStatus = post.status;
    const updateResult = await this.PostModel.updateOne(
      { _id: id, status: { $ne: EVENT.DELETED } },
      { ...data },
      { upsert: false, timestamps: false }
    );
    if (!updateResult.matchedCount) {
      throw new EntityNotFoundException();
    }

    const affectedTags = [...new Set([...previousTags, ...tags])];
    if (affectedTags.length > 0) {
      await this.tagStatisticsService.reconcileTagStatistics(affectedTags);
    }

    const newFileIds = (data.fileIds ?? payload.fileIds) || [];
    const oldFileIds = (post.fileIds || []).map((fId) => fId.toString());

    const toAdd = difference(newFileIds, oldFileIds);
    const toRemove = difference(oldFileIds, newFileIds);

    if (toRemove.length) {
      const mediaToRemove = await this.postMediaService.findByPostAndFileIds(post._id, toRemove);
      const fileIdsToRemove = mediaToRemove.map((m) => m.fileId);
      await this.postMediaService.deleteByIds(mediaToRemove.map((m) => m._id));
      // Use batch delete for better performance
      await this.fileServerService.deleteManyByIds(fileIdsToRemove);
    }

    if (toAdd.length) {
      const mediaItems = await Promise.all(
        toAdd.map(async (fileId, index) => ({
          fileId: new ObjectId(fileId),
          mediaType: await this.postMediaService.determineMediaType(new ObjectId(fileId)),
          ordering: oldFileIds.length + index
        }))
      );
      await this.postMediaService.createMultiplePostMedia(
        post._id,
        post.userId,
        mediaItems
      );
      // Use batch addRef for better performance
      await this.fileServerService.updateFileOwnership({
        fileIds: toAdd.map(id => id.toString()),
        createdBy: post.userId.toString(),
        ref: {
          itemId: post._id,
          itemType: FILE_REFERENCE_TYPES.POST
        }
      });
    }

    const previousAccessoryIds = new Set([
      post.thumbnailId,
      post.cover4x3Id,
      post.cover3x4Id,
      post.teaserId
    ].filter(Boolean).map(fileId => fileId.toString()));
    const accessoryIdsToAdd = [
      payload.thumbnailId,
      payload.cover4x3Id,
      payload.cover3x4Id,
      payload.teaserId
    ]
      .filter(Boolean)
      .map(fileId => fileId.toString())
      .filter(fileId => !previousAccessoryIds.has(fileId));

    if (accessoryIdsToAdd.length) {
      await this.fileServerService.updateFileOwnership({
        fileIds: [...new Set(accessoryIdsToAdd)],
        createdBy: post.userId.toString(),
        ref: {
          itemId: post._id,
          itemType: FILE_REFERENCE_TYPES.POST
        }
      });
    }

    const newData = PostDto.fromModel(await this.findById(post._id));
    await this.queueMessageService.publish(POST_CHANNELS.CREATOR_POST, {
      eventName: EVENT.UPDATED,
      data: {
        ...newData,
        oldStatus
      }
    });

    return newData;
  }

  /**
     * Delete a post with comprehensive cleanup
     *
     * Tombstones a post and publishes a durable deletion event. The subscribed
     * cleanup service then removes the post and all dependent data idempotently.
     *
     * Cleanup Process:
     * 1. Validates post exists and user has permission
     * 2. Marks the post deleted so it disappears from active queries
     * 3. Publishes a versioned snapshot for retryable cleanup
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
    // Phase 1: load the complete event snapshot and enforce ownership before any
    // visible state changes.
    const post = await this.findById(id);
    if (!post) {
      throw new EntityNotFoundException();
    }
    if (!user.isAdmin && post.userId.toString() !== user._id.toString()) throw new ForbiddenException();

    // Phase 2: tombstone first so active feeds hide the post even while the
    // asynchronous worker is cleaning dependent collections and files.
    await this.PostModel.updateOne(
      { _id: id },
      { $set: { status: EVENT.DELETED, updatedAt: new Date() } }
    );

    // Phase 3: publish every value required by retries. cleanupVersion allows a
    // future worker to branch safely if the event contract changes.
    await this.queueMessageService.publish(POST_CHANNELS.CREATOR_POST, {
      eventName: EVENT.DELETED,
      data: {
        ...post,
        status: EVENT.DELETED,
        cleanupVersion: 1
      }
    });
    return { success: true };
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
    return this.PostModel.countDocuments({
      userId,
      ...options
    });
  }
}
