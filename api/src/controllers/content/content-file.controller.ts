import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Param,
  Post,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe
} from "@nestjs/common";
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser, Roles } from "src/common/decorators";
import { AuthGuard, CustomThrottlerGuard, RoleGuard } from "src/common/guards";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import {
  PostPhotoDraftDiscardDto,
  PostPhotoDraftDto,
  PostVideoDraftDiscardDto,
  PostVideoDraftDto
} from "src/dtos/content";
import { DataResponse } from "src/kernel";
import { PostPhotoDraftsPayload, PostVideoDraftPayload } from "src/payloads/content/post";
import { ContentFileService, ContentService } from "src/services/content";
import { FileServerService } from "src/services/shared/file-server";
import { __t } from "src/utils/translation";

@Injectable()
@ApiTags('Content Files')
@ApiSecurity('token-auth')
@Controller('content/files')
export class ContentFileController {
  constructor(
    private readonly fileServerService: FileServerService,
    private readonly contentService: ContentService,
    private readonly contentFileService: ContentFileService
  ) { }
  // Post file upload URL generation

  /**
   * Get upload URL for post photo
   *
   * Generates a secure upload URL for post photo uploads using the file server.
   * This endpoint provides upload URLs for image files with appropriate processing options.
   *
   * @param filename - Original filename for the photo
   * @param fileSize - Size of the file in bytes (required for TUS uploads)
   * @returns Upload URL data including token and upload endpoint
   */
  @Post('post/photo/upload')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @Roles('user', 'admin')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 upload URL requests per minute
  @ApiOperation({
    summary: 'Get post photo upload URL',
    description: 'Generate a secure upload URL for post photo uploads. Requires creator/admin role and document verification. Images are processed with thumbnails and blur versions.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Original filename for the photo', example: 'my-photo.jpg' },
        fileSize: { type: 'number', description: 'Size of the file in bytes (required for TUS uploads)', example: 2048576 }
      },
      required: ['filename']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upload URL generated successfully',
    type: DataResponse
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Document verification required or insufficient permissions'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to generate upload URL'
  })
  async getPostPhotoUploadUrl(
    @Body() body: { filename: string; fileSize?: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // Check creator content permission (verified documents)
    const hasPermission = await this.contentService.checkCreatorContentPermission(user);
    if (!hasPermission) {
      throw new HttpException(
        __t('errors.document_verification_required_upload'),
        HttpStatus.FORBIDDEN
      );
    }

    try {
      const uploadData = await this.fileServerService.generateImageUploadUrl({
        filename: body.filename,
        fileSize: body.fileSize,
        type: 'post-photo',
        acl: 'public-read',
        processingOptions: {
          generateThumbnail: true,
          generateBlurImage: true,
          quality: 90,
          imageFormat: 'webp',
          immediateProcess: true
        },
        metadata: {
          category: 'post',
          fileType: 'photo',
          uploadedBy: user._id
        },
        createdBy: user.isAdmin ? 'admin' : user._id
      });

      return DataResponse.ok(uploadData);
    } catch (error) {
      throw new HttpException(
        __t('errors.failed_to_generate_upload_url', { reason: error.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get upload URL for post teaser video
   *
   * Generates a secure upload URL for post teaser video uploads using the file server.
   * This endpoint provides upload URLs for video files with appropriate processing options.
   *
   * @param filename - Original filename for the video
   * @param fileSize - Size of the file in bytes (required for TUS uploads)
   * @returns Upload URL data including token and upload endpoint
   */
  @Post('post/teaser/upload')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @Roles('user', 'admin')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 upload URL requests per minute
  @ApiOperation({
    summary: 'Get post teaser video upload URL',
    description: 'Generate a secure upload URL for post teaser video uploads. Requires creator/admin role and document verification. Videos are processed in background with thumbnails and blur versions.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Original filename for the video', example: 'teaser-video.mp4' },
        fileSize: { type: 'number', description: 'Size of the file in bytes (required for TUS uploads)', example: 10485760 }
      },
      required: ['filename']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upload URL generated successfully',
    type: DataResponse
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Document verification required or insufficient permissions'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to generate upload URL'
  })
  async getPostTeaserUploadUrl(
    @Body() body: { filename: string; fileSize?: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // Check creator content permission (verified documents)
    const hasPermission = await this.contentService.checkCreatorContentPermission(user);
    if (!hasPermission) {
      throw new HttpException(
        __t('errors.document_verification_required_upload'),
        HttpStatus.FORBIDDEN
      );
    }

    try {
      const uploadData = await this.fileServerService.generateVideoUploadUrl({
        filename: body.filename,
        fileSize: body.fileSize,
        type: 'post-teaser',
        acl: 'public-read',
        processingOptions: {
          generateThumbnail: true,
          generateBlurImage: true,
          immediateProcess: false // Videos are processed in background
        },
        metadata: {
          category: 'post',
          fileType: 'video',
          uploadedBy: user._id
        },
        createdBy: user.isAdmin ? 'admin' : user._id
      });

      return DataResponse.ok(uploadData);
    } catch (error) {
      throw new HttpException(
        __t('errors.failed_to_generate_upload_url', { reason: error.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  /**
   * Get upload URL for post video
   *
   * Generates a secure upload URL for post video uploads using the file server.
   * This endpoint provides upload URLs for video files with appropriate processing options.
   *
   * @param filename - Original filename for the video
   * @param fileSize - Size of the file in bytes (required for TUS uploads)
   * @returns Upload URL data including token and upload endpoint
   */
  @Post('post/video/upload')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @Roles('user', 'admin')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 upload URL requests per minute
  @ApiOperation({
    summary: 'Get post video upload URL',
    description: 'Generate a secure upload URL for post video uploads. Requires creator/admin role and document verification. Videos are processed in background with thumbnails and blur versions.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Original filename for the video', example: 'main-video.mp4' },
        fileSize: { type: 'number', description: 'Size of the file in bytes (required for TUS uploads)', example: 52428800 }
      },
      required: ['filename']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upload URL generated successfully',
    type: DataResponse
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Document verification required or insufficient permissions'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to generate upload URL'
  })
  async getPostVideoUploadUrl(
    @Body() body: { filename: string; fileSize?: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // Check creator content permission (verified documents)
    const hasPermission = await this.contentService.checkCreatorContentPermission(user);
    if (!hasPermission) {
      throw new HttpException(
        __t('errors.document_verification_required_upload'),
        HttpStatus.FORBIDDEN
      );
    }

    try {
      const uploadData = await this.fileServerService.generateVideoUploadUrl({
        filename: body.filename,
        fileSize: body.fileSize,
        type: 'post-video',
        acl: 'public-read',
        processingOptions: {
          generateThumbnail: true,
          generateBlurImage: true,
          immediateProcess: false // Videos are processed in background
        },
        metadata: {
          category: 'post',
          fileType: 'video',
          uploadedBy: user._id
        },
        createdBy: user.isAdmin ? 'admin' : user._id
      });

      return DataResponse.ok(uploadData);
    } catch (error) {
      throw new HttpException(
        __t('errors.failed_to_generate_upload_url', { reason: error.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  @Get('post/photo/drafts')
  @Roles('user', 'admin')
  @UseGuards(AuthGuard, RoleGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Restore unpublished post photo drafts',
    description: 'Returns safe preview metadata for owned, unreferenced post photos.'
  })
  async getPostPhotoDrafts(
    @Query() { fileIds }: PostPhotoDraftsPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PostPhotoDraftDto[]>> {
    const drafts = await this.contentFileService.getPostPhotoDrafts(fileIds, user);
    return DataResponse.ok(drafts);
  }

  @Delete('post/photo/drafts')
  @Roles('user', 'admin')
  @UseGuards(AuthGuard, RoleGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Discard unpublished post photo drafts',
    description: 'Deletes owned, unreferenced post photo records and their physical files.'
  })
  async discardPostPhotoDrafts(
    @Body() { fileIds }: PostPhotoDraftsPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PostPhotoDraftDiscardDto>> {
    const result = await this.contentFileService.discardPostPhotoDrafts(fileIds, user);
    return DataResponse.ok(result);
  }

  @Get('post/video/draft/:fileId')
  @Roles('user', 'admin')
  @UseGuards(AuthGuard, RoleGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get an unpublished post video draft',
    description: 'Returns safe preview metadata for an unreferenced post video owned by the current creator.'
  })
  async getPostVideoDraft(
    @Param() { fileId }: PostVideoDraftPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PostVideoDraftDto>> {
    const draft = await this.contentFileService.getPostVideoDraft(fileId, user);
    return DataResponse.ok(draft);
  }

  @Delete('post/video/draft/:fileId')
  @Roles('user', 'admin')
  @UseGuards(AuthGuard, RoleGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Discard an unpublished post video draft',
    description: 'Deletes an owned, unreferenced post video record and all associated physical files.'
  })
  async discardPostVideoDraft(
    @Param() { fileId }: PostVideoDraftPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PostVideoDraftDiscardDto>> {
    const result = await this.contentFileService.discardPostVideoDraft(fileId, user);
    return DataResponse.ok(result);
  }

  /**
   * Get upload URL for post thumbnail
   *
   * Generates a secure upload URL for post thumbnail uploads using the file server.
   * This endpoint provides upload URLs for thumbnail images with public access.
   *
   * @param filename - Original filename for the thumbnail
   * @param fileSize - Size of the file in bytes (required for TUS uploads)
   * @returns Upload URL data including token and upload endpoint
   */
  @Post('post/thumbnail/upload')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @Roles('user', 'admin')
  @UseGuards(CustomThrottlerGuard, RoleGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 upload URL requests per minute
  @ApiOperation({
    summary: 'Get post thumbnail upload URL',
    description: 'Generate a secure upload URL for post thumbnail uploads. Requires creator/admin role and document verification. Thumbnails are processed immediately with public access.'
  })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        filename: { type: 'string', description: 'Original filename for the thumbnail', example: 'thumbnail.jpg' },
        fileSize: { type: 'number', description: 'Size of the file in bytes (required for TUS uploads)', example: 1024000 }
      },
      required: ['filename']
    }
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Upload URL generated successfully',
    type: DataResponse
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Document verification required or insufficient permissions'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    description: 'Failed to generate upload URL'
  })
  async getPostThumbnailUploadUrl(
    @Body() body: { filename: string; fileSize?: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // Check creator content permission (verified documents)
    const hasPermission = await this.contentService.checkCreatorContentPermission(user);
    if (!hasPermission) {
      throw new HttpException(
        __t('errors.document_verification_required_upload'),
        HttpStatus.FORBIDDEN
      );
    }

    try {
      const uploadData = await this.fileServerService.generateImageUploadUrl({
        filename: body.filename,
        fileSize: body.fileSize,
        type: 'post-thumbnail',
        acl: 'public-read',
        processingOptions: {
          generateThumbnail: false,
          generateBlurImage: false,
          quality: 85,
          imageFormat: 'webp',
          immediateProcess: true
        },
        metadata: {
          category: 'post',
          fileType: 'thumbnail',
          uploadedBy: user._id
        },
        createdBy: user.isAdmin ? 'admin' : user._id
      });

      return DataResponse.ok(uploadData);
    } catch (error) {
      throw new HttpException(
        __t('errors.failed_to_generate_upload_url', { reason: error?.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
