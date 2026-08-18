import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ObjectId } from 'mongodb';
import { Model } from "mongoose";
import { toObjectId } from "src/kernel/helpers/string.helper";
import { EMediaType, PostMedia, PostMediaDocument } from "src/schemas";
import { FileServerService } from "src/services/shared/file-server";

/**
 * Post Media Service
 *
 * Manages media attachments for posts including photos, videos, and other media types.
 * Handles media metadata, ordering, and file associations with post content.
 *
 * Key Features:
 * - Media type detection and classification
 * - Media ordering and organization within posts
 * - Bulk media creation for multi-media posts
 * - Media metadata management
 * - File service integration for media processing
 *
 * Media Types:
 * - Photos (JPEG, PNG, GIF, WebP)
 * - Videos (MP4, WebM, MOV)
 * - Audio files
 * - Documents and other attachments
 *
 * @example Create single media entry
 * ```typescript
 * const media = await postMediaService.createPostMedia(
 *   postId,
 *   userId,
 *   fileId,
 *   EMediaType.PHOTO,
 *   0
 * );
 * ```
 *
 * @example Create multiple media entries
 * ```typescript
 * const mediaItems = [
 *   { fileId: photo1Id, mediaType: EMediaType.PHOTO, ordering: 0 },
 *   { fileId: video1Id, mediaType: EMediaType.VIDEO, ordering: 1 }
 * ];
 * const media = await postMediaService.createMultiplePostMedia(postId, userId, mediaItems);
 * ```
 */
@Injectable()
export class PostMediaService {
  constructor(
    @InjectModel(PostMedia.name) private readonly PostMediaModel: Model<PostMediaDocument>,
    private readonly fileServerService: FileServerService
  ) { }
  /**
     * Create multiple post media entries in bulk
     *
     * Efficiently creates multiple media entries for a post in a single operation.
     * Useful for posts with multiple photos, videos, or mixed media content.
     *
     * @param postId - ID of the post to attach media to
     * @param userId - ID of the user creating the media
     * @param mediaItems - Array of media items with file IDs, types, and ordering
     * @returns Promise resolving to array of created PostMedia documents
     * @example
     * ```typescript
     * const mediaItems = [
     *   { fileId: photo1Id, mediaType: EMediaType.PHOTO, ordering: 0 },
     *   { fileId: photo2Id, mediaType: EMediaType.PHOTO, ordering: 1 },
     *   { fileId: videoId, mediaType: EMediaType.VIDEO, ordering: 2 }
     * ];
     * const media = await postMediaService.createMultiplePostMedia(postId, userId, mediaItems);
     * ```
     */
  async createMultiplePostMedia(
    postId: string | ObjectId,
    userId: string | ObjectId,
    mediaItems: Array<{ fileId: ObjectId; mediaType: EMediaType; ordering: number }>
  ): Promise<PostMedia[]> {
    const postMediaDocs = mediaItems.map((item) => ({
      postId: toObjectId(postId),
      userId: toObjectId(userId),
      fileId: item.fileId,
      mediaType: item.mediaType,
      ordering: item.ordering,
      createdAt: new Date(),
      updatedAt: new Date()
    }));

    return this.PostMediaModel.insertMany(postMediaDocs);
  }

  /**
   * Determine media type from file information
   *
   * Analyzes a file to determine its media type classification (photo, video, etc.).
   * Uses file service to check MIME types and file properties.
   *
   * @param fileId - ID of the file to analyze
   * @returns Promise resolving to determined EMediaType
   * @example
   * ```typescript
   * const mediaType = await postMediaService.determineMediaType(fileId);
   * if (mediaType === EMediaType.VIDEO) {
   *   console.log('This is a video file');
   * }
   * ```
   */
  async determineMediaType(fileId: ObjectId): Promise<EMediaType> {
    const file = await this.fileServerService.getFileInfo(fileId);
    if (!file) return EMediaType.PHOTO; // Default fallback

    if (file.isPhoto()) {
      return EMediaType.PHOTO;
    }

    if (file.isVideo()) {
      return EMediaType.VIDEO;
    }

    return EMediaType.PHOTO;
  }

  /**
   * Delete all media entries for a specific post
   *
   * Removes all media attachments associated with a post when the post is deleted.
   * Used for cleanup operations to maintain data consistency.
   *
   * @param postId - ID of the post to delete all media for
   * @example
   * ```typescript
   * // When deleting a post, clean up all its media entries
   * await postMediaService.deletePostMediaByPostId(postId);
   * ```
   */
  async deletePostMediaByPostId(postId: ObjectId): Promise<void> {
    await this.PostMediaModel.deleteMany({ postId });
  }

  /**
   * Find media entries by post ID and specific file IDs
   *
   * Retrieves media entries that match both the post ID and are in the list of file IDs.
   * Useful for validating media ownership and managing specific media items.
   *
   * @param postId - ID of the post to search within
   * @param fileIds - Array of file IDs to match
   * @returns Promise resolving to array of matching PostMediaDocument objects
   * @example
   * ```typescript
   * const mediaToUpdate = await postMediaService.findByPostAndFileIds(
   *   postId,
   *   [fileId1, fileId2, fileId3]
   * );
   * ```
   */
  async findByPostAndFileIds(postId: ObjectId, fileIds: (string | ObjectId)[]): Promise<PostMediaDocument[]> {
    return this.PostMediaModel.find({
      postId,
      fileId: { $in: fileIds }
    });
  }

  /**
  * Delete media entries by their IDs
  *
  * Removes multiple media entries from the database by their document IDs.
  * Used for cleanup operations and media management.
  *
  * @param ids - Array of media document IDs to delete
  * @example
  * ```typescript
  * await postMediaService.deleteByIds([mediaId1, mediaId2, mediaId3]);
  * ```
  */
  async deleteByIds(ids: (string | ObjectId)[]): Promise<void> {
    await this.PostMediaModel.deleteMany({ _id: { $in: ids } });
  }
}