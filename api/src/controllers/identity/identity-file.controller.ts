import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Injectable,
  Post,
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
import { DataResponse } from "src/kernel";
import { FileServerService } from "src/services/shared/file-server";
import { __t } from "src/utils/translation";

@Injectable()
@Controller('identity/files')
@ApiTags('Identity File Upload')
@ApiSecurity('token-auth')
export class IdentityFileController {
  constructor(
    private readonly fileServerService: FileServerService
  ) { }
  // User file upload URL generation

  /**
   * Get upload URL for user avatar
   *
   * Generates a secure upload URL for user avatar uploads using the file server.
   * This endpoint provides upload URLs for avatar image files with thumbnail generation.
   *
   * @param filename - Original filename for the avatar
   * @param fileSize - Size of the file in bytes (required for TUS uploads)
   * @returns Upload URL data including token and upload endpoint
   */
  @Post('user/avatar/upload')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 file uploads per minute
  @ApiOperation({
    summary: 'Generate user avatar upload URL',
    description: 'Generates a secure upload URL for user avatar uploads. Rate limited to 10 uploads per minute. Requires authentication.'
  })
  @ApiBody({
    description: 'File upload information',
    schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Original filename for the avatar',
          example: 'avatar.jpg'
        },
        fileSize: {
          type: 'number',
          description: 'Size of the file in bytes',
          example: 1024000
        }
      },
      required: ['filename', 'fileSize']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Upload URL generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          description: 'Upload URL and metadata'
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid authentication'
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests - Rate limit exceeded (10 uploads per minute)'
  })
  async generateUserAvatarUploadUrl(
    @Body() body: { filename: string; fileSize: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    try {
      const uploadData = await this.fileServerService.generateUploadUrl({
        filename: body.filename,
        fileSize: body.fileSize,
        mediaType: 'image',
        type: 'avatar',
        acl: 'public-read',
        processingOptions: {
          generateThumbnail: false,
          generateBlurImage: false,
          resizeWidth: 450,
          imageFormat: 'webp',
          immediateProcess: true
        },
        metadata: {
          uploadedBy: user._id
        },
        createdBy: user.isAdmin ? 'admin' : user._id,
        uploadType: 'tus'
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
   * Get upload URL for creator cover
   *
   * Generates a secure upload URL for creator cover uploads using the file server.
   * This endpoint provides upload URLs for cover image files with processing options.
   *
   * @param filename - Original filename for the cover
   * @param fileSize - Size of the file in bytes (required for TUS uploads)
   * @returns Upload URL data including token and upload endpoint
   */
  @Post('creator/cover/upload')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @UseGuards(AuthGuard, RoleGuard)
  @Roles('user')
  @Throttle({ default: { limit: 5, ttl: 60000 } }) // 5 file uploads per minute
  @ApiOperation({
    summary: 'Generate creator cover upload URL',
    description: 'Generates a secure upload URL for creator cover uploads. Requires creator role. Rate limited to 5 uploads per minute.'
  })
  @ApiBody({
    description: 'File upload information',
    schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Original filename for the cover',
          example: 'cover.jpg'
        },
        fileSize: {
          type: 'number',
          description: 'Size of the file in bytes',
          example: 2048000
        }
      },
      required: ['filename', 'fileSize']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Upload URL generated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          description: 'Upload URL and metadata'
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid authentication'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Creator role required'
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests - Rate limit exceeded (5 uploads per minute)'
  })
  async generateCreatorCoverUploadUrl(
    @Body() body: { filename: string; fileSize: number },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    try {
      const uploadData = await this.fileServerService.generateUploadUrl({
        filename: body.filename,
        fileSize: body.fileSize,
        mediaType: 'image',
        type: 'cover',
        acl: 'public-read',
        processingOptions: {
          generateThumbnail: false,
          generateBlurImage: false,
          resizeWidth: 1200,
          imageFormat: 'webp',
          immediateProcess: true
        },
        metadata: {
          uploadedBy: user._id
        },
        createdBy: user.isAdmin ? 'admin' : user._id,
        uploadType: 'tus'
      });

      return DataResponse.ok(uploadData);
    } catch {
      throw new HttpException(
        'Failed to generate upload URL',
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}