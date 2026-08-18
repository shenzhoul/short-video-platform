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
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { CurrentUser } from 'src/common/decorators';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RoleGuard } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { DataResponse } from 'src/kernel';
import { FileServerService } from 'src/services/shared/file-server';
import { __t } from 'src/utils/translation';

/**
 * Setting File Upload Controller
 *
 * Provides secure file upload functionality for system settings and configuration files.
 * Handles generation of pre-signed upload URLs for images used in platform settings,
 * such as logos, favicons, banners, and other visual assets.
 *
 * Key Features:
 * - Pre-signed URL generation for secure uploads
 * - Image optimization and processing
 * - Admin-only access with role validation
 * - File type and size validation
 * - Automatic image format conversion (WebP)
 * - Public read access for uploaded files
 *
 * Security Considerations:
 * - Admin role required for all operations
 * - RoleGuard protection on all endpoints
 * - File type restrictions (images only)
 * - Size limits enforced by file server
 * - Upload tokens with expiration
 * - Audit logging with uploader information
 *
 * Supported File Types:
 * - Images: PNG, JPG, JPEG, GIF, WebP
 * - Converted to WebP format automatically
 * - Optimized for web delivery
 *
 * Use Cases:
 * - Site logo uploads
 * - Favicon management
 * - Banner image uploads
 * - Brand asset management
 * - Admin interface customization
 *
 * @example Admin interface usage
 * ```typescript
 * // Generate upload URL for logo
 * const uploadUrl = await fetch('/api/admin/settings/files/image/upload', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     filename: 'logo.png',
 *     fileSize: 1024000
 *   })
 * });
 *
 * const { data } = await uploadUrl.json();
 * // Use data.uploadUrl to upload the file directly to storage
 * ```
 */
@Injectable()
@Controller('admin/settings/files')
@ApiTags('Admin Setting Files')
@ApiSecurity('token-auth')
export class SettingFileUploadController {
  constructor(
    private readonly fileServerService: FileServerService
  ) { }

  /**
   * Generate upload URL for setting image files
   *
   * Creates a pre-signed upload URL for uploading image files used in system settings.
   * The generated URL allows direct upload to cloud storage without exposing credentials.
   * Uploaded images are automatically optimized and converted to WebP format.
   *
   * Upload Process:
   * 1. Generate pre-signed URL with admin validation
   * 2. Client uploads file directly to storage service
   * 3. File is processed and optimized automatically
   * 4. File becomes publicly accessible via returned URL
   *
   * File Processing:
   * - Automatic WebP conversion for better compression
   * - No thumbnail generation (full-size images only)
   * - No blur image generation
   * - Immediate processing for instant availability
   *
   * @param body - Upload request containing filename and file size
   * @param user - Current authenticated admin user
   * @returns Promise<DataResponse<any>> - Upload URL data with tokens and endpoints
   *
   * @example Generate upload URL for site logo
   * ```http
   * POST /api/admin/settings/files/image/upload
   * Authorization: Bearer <admin-jwt-token>
   * Content-Type: application/json
   *
   * {
   *   "filename": "site-logo.png",
   *   "fileSize": 2048000
   * }
   * ```
   *
   * @example Success response
   * ```json
   * {
   *   "status": 200,
   *   "data": {
   *     "uploadUrl": "https://storage.example.com/upload?token=abc123...",
   *     "fileUrl": "https://cdn.example.com/files/setting-file/logo.webp",
   *     "token": "upload-token-xyz789",
   *     "expiresAt": "2024-01-15T11:30:00.000Z",
   *     "maxSize": 5242880,
   *     "allowedTypes": ["image/png", "image/jpeg", "image/webp"]
   *   }
   * }
   * ```
   *
   * @example Client upload process
   * ```typescript
   * // 1. Get upload URL
   * const { data } = await fetch('/api/admin/settings/files/image/upload', {
   *   method: 'POST',
   *   headers: { 'Authorization': `Bearer ${token}` },
   *   body: JSON.stringify({ filename: 'logo.png', fileSize: 1024000 })
   * }).then(r => r.json());
   *
   * // 2. Upload file directly to storage
   * const formData = new FormData();
   * formData.append('file', fileInput.files[0]);
   *
   * await fetch(data.uploadUrl, {
   *   method: 'POST',
   *   body: formData
   * });
   *
   * // 3. File is now available at data.fileUrl
   * console.log('Uploaded file URL:', data.fileUrl);
   * ```
   *
   * @example Error response (invalid file size)
   * ```json
   * {
   *   "status": 400,
   *   "message": "File size exceeds maximum allowed size"
   * }
   * ```
   *
   * @example Error response (unauthorized)
   * ```json
   * {
   *   "status": 403,
   *   "message": "Forbidden resource"
   * }
   * ```
   *
   * TODO: Add file validation before URL generation
   * TODO: Add support for multiple file uploads
   * TODO: Add upload progress tracking
   * TODO: Add file replacement functionality
   * TODO: Add bulk delete operations
   */
  @Post('image/upload')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({
    transform: true,
    whitelist: true
  }))
  @Roles('admin')
  @UseGuards(RoleGuard)
  @ApiOperation({
    summary: 'Generate upload URL for setting images',
    description: 'Creates a pre-signed upload URL for uploading image files used in system settings with automatic WebP conversion and optimization.'
  })
  @ApiBody({
    description: 'Image upload request parameters',
    schema: {
      type: 'object',
      properties: {
        filename: {
          type: 'string',
          description: 'Original filename for the image file',
          example: 'site-logo.png',
          minLength: 1,
          maxLength: 255
        },
        fileSize: {
          type: 'number',
          description: 'File size in bytes (must be positive)',
          example: 2048000,
          minimum: 1,
          maximum: 52428800
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
        status: { type: 'number', example: 200 },
        data: {
          type: 'object',
          properties: {
            uploadUrl: {
              type: 'string',
              description: 'Pre-signed upload URL for direct file upload',
              example: 'https://storage.example.com/upload?token=abc123...'
            },
            fileUrl: {
              type: 'string',
              description: 'Final public URL where the file will be accessible',
              example: 'https://cdn.example.com/files/setting-file/logo.webp'
            },
            token: {
              type: 'string',
              description: 'Upload authorization token',
              example: 'upload-token-xyz789'
            },
            expiresAt: {
              type: 'string',
              format: 'date-time',
              description: 'Upload URL expiration timestamp',
              example: '2024-01-15T11:30:00.000Z'
            },
            maxSize: {
              type: 'number',
              description: 'Maximum allowed file size in bytes',
              example: 52428800
            },
            allowedTypes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Allowed MIME types for upload',
              example: ['image/png', 'image/jpeg', 'image/webp']
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid filename or file size parameters',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 400 },
        message: {
          type: 'array',
          items: { type: 'string' },
          example: ['filename must be a string', 'fileSize must be a positive number']
        },
        error: { type: 'string', example: 'Bad Request' }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid JWT token',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 401 },
        message: { type: 'string', example: 'Unauthorized' }
      }
    }
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 403 },
        message: { type: 'string', example: 'Forbidden resource' },
        error: { type: 'string', example: 'Forbidden' }
      }
    }
  })
  @ApiResponse({
    status: 413,
    description: 'Payload Too Large - File size exceeds maximum allowed limit',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 413 },
        message: { type: 'string', example: 'File size exceeds maximum allowed size' }
      }
    }
  })
  @ApiResponse({
    status: 415,
    description: 'Unsupported Media Type - File type not allowed for setting images',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 415 },
        message: { type: 'string', example: 'Unsupported file type for setting images' }
      }
    }
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error - Failed to generate upload URL or connect to file server',
    schema: {
      type: 'object',
      properties: {
        statusCode: { type: 'number', example: 500 },
        message: { type: 'string', example: 'Failed to generate upload URL: Connection timeout' }
      }
    }
  })
  async generateSettingFileUploadUrl(
    @Body() body: { filename: string; fileSize: number; metadata?: Record<string, any> },
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    try {
      const uploadData = await this.fileServerService.generateUploadUrl({
        uploadType: 'normal', // do not use 'chunked' for setting files
        filename: body.filename,
        fileSize: body.fileSize,
        mediaType: 'image',
        type: 'setting-file',
        acl: 'public-read',
        processingOptions: {
          generateThumbnail: false,
          generateBlurImage: false,
          imageFormat: 'webp',
          immediateProcess: true
        },
        metadata: {
          uploadedBy: user._id
        },
        createdBy: user._id
      });

      return DataResponse.ok(uploadData);
    } catch (error) {
      throw new HttpException(
        __t('errors.failed_to_generate_upload_url', { reason: error.message }),
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }
}
