import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { FileServerService } from "src/services/shared/file-server";
import { ObjectId } from 'mongodb';
import { UserDto } from "src/dtos/identity/user";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { FileServerInfoDto } from "src/dtos/shared/file-server/file-server.dto";
import { __t } from "src/utils/translation";
import {
  PostPhotoDraftDiscardDto,
  PostPhotoDraftDto,
  PostVideoDraftDiscardDto,
  PostVideoDraftDto
} from "src/dtos/content";

/**
 * Content File Service
 *
 * Specialized service for validating and managing files used in content creation.
 * Provides security controls, ownership validation, and file processing coordination
 * for content-related file operations across the platform.
 *
 * Key Features:
 * - File ownership validation and security controls
 * - Content file type validation (images, videos, documents)
 * - File processing coordination (thumbnails, format conversion)
 * - Batch file validation for content creation/updates
 * - Integration with content creation workflows
 *
 * Security Model:
 * - Admin users can use any file
 * - Creators can only use files they uploaded
 * - Creators can use files uploaded by administrators
 * - Cross-creator file usage is prohibited
 *
 * @example Validate files for post creation
 * ```typescript
 * const files = await contentFileService.validateAndRetrieveOwnedFiles(
 *   [imageId1, imageId2, videoId],
 *   currentUser,
 *   'create'
 * );
 * ```
 *
 * @example Validate and process content files
 * ```typescript
 * const { mainFiles, thumbnail, teaser } = await contentFileService.validateAndProcessContentFiles(
 *   { fileIds: [id1, id2], thumbnailId: thumbId },
 *   user
 * );
 * ```
 */
@Injectable()
export class ContentFileService {
  constructor(
    private readonly fileServerService: FileServerService
  ) { }

  private async findOwnedUnreferencedPostPhotoDrafts(
    fileIds: string[],
    user: UserDto | AuthUserDto
  ): Promise<{ files: FileServerInfoDto[]; missingFileIds: string[] }> {
    const files = await this.fileServerService.findByIds(fileIds);
    const fileMap = new Map(files.map(file => [file._id.toString(), file]));
    const missingFileIds = fileIds.filter(fileId => !fileMap.has(fileId));

    files.forEach(file => {
      const isOwner = file.createdBy?.toString() === user._id.toString();
      // `type` is the durable upload-target identity. Image processing normalizes
      // metadata and may remove request-only fields such as category/fileType.
      const isPostPhoto = file.type === 'post-photo';
      if ((!user.isAdmin && !isOwner) || !isPostPhoto) {
        throw new ForbiddenException(__t('errors.post_photo_draft_access_denied'));
      }
      if (file.refItems?.length) {
        throw new ForbiddenException(__t('errors.post_photo_draft_already_attached'));
      }
    });

    return {
      files: fileIds.map(fileId => fileMap.get(fileId)).filter(Boolean),
      missingFileIds
    };
  }

  public async getPostPhotoDrafts(
    fileIds: string[],
    user: UserDto | AuthUserDto
  ): Promise<PostPhotoDraftDto[]> {
    const { files } = await this.findOwnedUnreferencedPostPhotoDrafts(fileIds, user);
    return files.map(file => PostPhotoDraftDto.fromFile(file));
  }

  public async discardPostPhotoDrafts(
    fileIds: string[],
    user: UserDto | AuthUserDto
  ): Promise<PostPhotoDraftDiscardDto> {
    const { files, missingFileIds } = await this.findOwnedUnreferencedPostPhotoDrafts(fileIds, user);
    const existingFileIds = files.map(file => file._id.toString());
    if (existingFileIds.length) {
      const result = await this.fileServerService.deleteManyByIds(existingFileIds);
      if (result.deleted !== existingFileIds.length || result.errors.length > 0) {
        throw new BadRequestException(__t('errors.post_photo_draft_discard_failed'));
      }
    }

    return PostPhotoDraftDiscardDto.create(existingFileIds, missingFileIds);
  }

  private async findOwnedUnreferencedPostVideoDraft(
    fileId: string,
    user: UserDto | AuthUserDto,
    allowMissing = false
  ): Promise<FileServerInfoDto | null> {
    const [file] = await this.fileServerService.findByIds([fileId]);
    if (!file) {
      if (allowMissing) return null;
      throw new NotFoundException(__t('errors.post_video_draft_not_found'));
    }

    const isOwner = file.createdBy?.toString() === user._id.toString();
    if (!user.isAdmin && !isOwner) {
      throw new ForbiddenException(__t('errors.post_video_draft_access_denied'));
    }

    const isPostVideo = file.type === 'post-video'
      && file.metadata?.category === 'post'
      && file.metadata?.fileType === 'video';
    if (!isPostVideo) {
      throw new ForbiddenException(__t('errors.post_video_draft_access_denied'));
    }

    if (file.refItems?.length) {
      throw new ForbiddenException(__t('errors.post_video_draft_already_attached'));
    }

    return file;
  }

  public async getPostVideoDraft(
    fileId: string,
    user: UserDto | AuthUserDto
  ): Promise<PostVideoDraftDto> {
    const file = await this.findOwnedUnreferencedPostVideoDraft(fileId, user);
    return PostVideoDraftDto.fromFile(file);
  }

  public async discardPostVideoDraft(
    fileId: string,
    user: UserDto | AuthUserDto
  ): Promise<PostVideoDraftDiscardDto> {
    const file = await this.findOwnedUnreferencedPostVideoDraft(fileId, user, true);
    if (!file) return PostVideoDraftDiscardDto.create(fileId, false);

    const result = await this.fileServerService.deleteManyByIds([fileId]);
    if (result.deleted !== 1 || result.errors.length > 0) {
      throw new BadRequestException(__t('errors.post_video_draft_discard_failed'));
    }

    return PostVideoDraftDiscardDto.create(fileId, true);
  }

  /**
   * Validates file ownership and returns the validated files
   *
   * This optimized version reduces duplicate database queries by returning the files
   * after validation. Combines ownership validation with file retrieval for efficiency.
   *
   * @param fileIds Array of file IDs to validate
   * @param user Current user performing the operation
   * @param operation Operation type for error messages ('create' | 'update')
   * @returns Array of validated FileServerInfoDto objects
   * @throws ForbiddenException if user doesn't have permission to use any file
   */
  public async validateAndRetrieveOwnedFiles(
    fileIds: Array<string | ObjectId>,
    user: UserDto | AuthUserDto,
    operation: 'create' | 'update' = 'create'
  ): Promise<FileServerInfoDto[]> {
    const checkIds = fileIds.filter((id) => !!id);
    if (!checkIds.length) return [];

    // Admin users can use any file
    if (user.isAdmin) {
      return this.fileServerService.findByIds(checkIds as any);
    }

    // Get file details to check ownership
    const files = await this.fileServerService.findByIds(checkIds as any);

    // Check if any files are missing
    if (files.length !== checkIds.length) {
      throw new ForbiddenException(__t('errors.files_missing_for_operation', { operation }));
    }

    // Check ownership for each file
    const unauthorizedFiles = files.filter((file) => {
      // Allow files created by the current user
      if (file.createdBy && file.createdBy.toString() === user._id.toString()) {
        return false;
      }

      // Allow files created by admin (createdBy is null or equal 'admin')
      // Admin files typically have createdBy as null when uploaded via admin interface
      // or have createdBy set to 'admin'
      if (!file.createdBy || file.createdBy === 'admin') {
        return false;
      }

      // This file was created by another user (not admin, not current user)
      return true;
    });

    if (unauthorizedFiles.length > 0) {
      throw new ForbiddenException(__t('errors.no_permission_to_use_files', { operation, count: unauthorizedFiles.length }));
    }

    return files;
  }

  /**
   * Validates file ownership for post-specific files and returns validated files
   * Optimized version that reduces duplicate database queries
   *
   * @param payload Post payload containing file IDs
   * @param user Current user performing the operation
   * @param operation Operation type for error messages
   * @returns Object containing arrays of validated files by type
   * TODO - move to file server call
   */
  public async validatePostFileOwnershipAndReturn(
    payload: {
      fileIds?: (string | ObjectId)[];
      thumbnailId?: string | ObjectId | null;
      cover4x3Id?: string | ObjectId | null;
      cover3x4Id?: string | ObjectId | null;
      teaserId?: string | ObjectId | null;
    },
    user: UserDto | AuthUserDto,
    operation: 'create' | 'update' = 'create'
  ): Promise<{
    mainFiles: FileServerInfoDto[];
    thumbnail: FileServerInfoDto | null;
    cover4x3: FileServerInfoDto | null;
    cover3x4: FileServerInfoDto | null;
    teaser: FileServerInfoDto | null;
  }> {
    const allFileIds: (string | ObjectId)[] = [];

    // Collect all file IDs and track their types
    if (payload.fileIds && payload.fileIds.length > 0) {
      payload.fileIds.forEach((id) => {
        allFileIds.push(id);
      });
    }

    if (payload.thumbnailId) {
      allFileIds.push(payload.thumbnailId);
    }

    if (payload.cover4x3Id) {
      allFileIds.push(payload.cover4x3Id);
    }

    if (payload.cover3x4Id) {
      allFileIds.push(payload.cover3x4Id);
    }

    if (payload.teaserId) {
      allFileIds.push(payload.teaserId);
    }

    // Validate all files at once
    const uniqueFileIds = [...new Map(allFileIds.map(id => [id.toString(), id])).values()];
    const validatedFiles = await this.validateAndRetrieveOwnedFiles(uniqueFileIds, user, operation);

    // Separate files by type
    const mainFiles: FileServerInfoDto[] = [];
    let thumbnail: FileServerInfoDto | null = null;
    let cover4x3: FileServerInfoDto | null = null;
    let cover3x4: FileServerInfoDto | null = null;
    let teaser: FileServerInfoDto | null = null;

    const findFile = (id?: string | ObjectId | null) => id
      ? validatedFiles.find(file => file._id.toString() === id.toString()) || null
      : null;
    const mainIdSet = new Set((payload.fileIds || []).map(id => id.toString()));
    mainFiles.push(...validatedFiles.filter(file => mainIdSet.has(file._id.toString())));
    thumbnail = findFile(payload.thumbnailId);
    cover4x3 = findFile(payload.cover4x3Id);
    cover3x4 = findFile(payload.cover3x4Id);
    teaser = findFile(payload.teaserId);

    return { mainFiles, thumbnail, cover4x3, cover3x4, teaser };
  }
}
