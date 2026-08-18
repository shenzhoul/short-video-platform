import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { Roles } from 'src/common/decorators';
import { RoleGuard } from 'src/common/guards';
import { SettingDto } from 'src/dtos/system/setting';
import { DataResponse } from 'src/kernel';
import { SettingUpdatePayload } from 'src/payloads/system/setting';
import { SettingService } from 'src/services/system/setting/setting.service';

/**
 * Admin Settings Controller
 *
 * Provides administrative endpoints for managing system-wide settings and configuration.
 * Allows administrators to view and modify platform settings that control various aspects
 * of the application behavior, features, and integrations.
 *
 * Key Features:
 * - Retrieve editable settings by group for admin interface
 * - Update individual settings with validation
 * - Role-based access control (admin only)
 * - Support for different setting types (text, number, boolean, object)
 * - Commission rate validation for financial settings
 *
 * Security Considerations:
 * - Admin role required for all endpoints
 * - RoleGuard protection on all methods
 * - Input validation and sanitization
 * - Audit logging for setting changes (handled by service layer)
 *
 * Setting Groups:
 * - System configuration settings
 * - Payment and commission settings
 * - Email and notification settings
 * - Security and access control settings
 * - Feature flags and toggles
 *
 * @example Admin interface usage
 * ```typescript
 * // Get all system settings
 * const settings = await fetch('/api/admin/settings?group=system');
 *
 * // Update a setting
 * await fetch('/api/admin/settings/site.name', {
 *   method: 'PUT',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ value: 'New Site Name' })
 * });
 * ```
 */
@Injectable()
@Controller('admin/settings')
@ApiTags('Admin Settings')
@ApiSecurity('token-auth')
export class AdminSettingController {
  constructor(private readonly settingService: SettingService) { }

  /**
   * Get editable settings for admin interface
   *
   * Retrieves all settings that can be modified by administrators, optionally filtered by group.
   * Used to populate the admin settings interface with current values and metadata.
   * Only returns settings marked as editable in the system configuration.
   *
   * @param group - Optional group filter (e.g., 'system', 'payment', 'email')
   * @returns Promise<DataResponse<SettingDto[]>> - Array of editable settings with metadata
   *
   * @example Get all settings
   * ```http
   * GET /api/admin/settings
   * ```
   *
   * @example Get settings by group
   * ```http
   * GET /api/admin/settings?group=system
   * ```
   *
   * @example Response format
   * ```json
   * {
   *   "status": 200,
   *   "data": [
   *     {
   *       "_id": "507f1f77bcf86cd799439011",
   *       "key": "site.name",
   *       "value": "My Platform",
   *       "name": "Site Name",
   *       "description": "The name of the platform displayed to users",
   *       "group": "system",
   *       "type": "text",
   *       "public": false,
   *       "visible": true,
   *       "autoload": true,
   *       "meta": { "maxLength": 100 },
   *       "createdAt": "2024-01-01T00:00:00.000Z",
   *       "updatedAt": "2024-01-01T00:00:00.000Z"
   *     }
   *   ]
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
   */
  @Get('')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UseGuards(RoleGuard)
  @ApiOperation({
    summary: 'Get editable admin settings',
    description: 'Retrieves all system settings that can be modified by administrators, optionally filtered by group. Used to populate admin settings interface.'
  })
  @ApiQuery({
    name: 'group',
    required: false,
    description: 'Filter settings by group (e.g., system, payment, email)',
    example: 'system'
  })
  @ApiResponse({
    status: 200,
    description: 'Settings retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'number', example: 200 },
        data: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
              key: { type: 'string', example: 'site.name' },
              value: { type: 'string', example: 'My Platform' },
              name: { type: 'string', example: 'Site Name' },
              description: { type: 'string', example: 'The name of the platform displayed to users' },
              group: { type: 'string', example: 'system' },
              type: { type: 'string', enum: ['text', 'number', 'boolean', 'object'], example: 'text' },
              public: { type: 'boolean', example: false },
              editable: { type: 'boolean', example: true },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' }
            }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid JWT token'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required'
  })
  async getAdminSettings(
    @Query('group') group: string
  ): Promise<DataResponse<SettingDto[]>> {
    const settings = await this.settingService.getEditableSettings(group);
    return DataResponse.ok(settings);
  }

  /**
   * Update a specific setting
   *
   * Modifies the value of a single setting identified by its key. The update is validated
   * based on the setting's type and constraints. Commission rates are validated to be
   * between 0-100%. Changes are audited and may trigger system-wide cache invalidation.
   *
   * @param key - Setting key to update (e.g., 'site.name', 'commission.creator')
   * @param value - New setting value and optional metadata (name, description)
   * @returns Promise<DataResponse<SettingDto>> - Updated setting with new values
   *
   * @example Update site name
   * ```http
   * PUT /api/admin/settings/site.name
   * Content-Type: application/json
   *
   * {
   *   "value": "New Platform Name"
   * }
   * ```
   *
   * @example Update commission rate
   * ```http
   * PUT /api/admin/settings/commission.creator
   * Content-Type: application/json
   *
   * {
   *   "value": 15.5,
   *   "description": "Creator commission rate updated to 15.5%"
   * }
   * ```
   *
   * @example Success response
   * ```json
   * {
   *   "status": 200,
   *   "data": {
   *     "_id": "507f1f77bcf86cd799439011",
   *     "key": "site.name",
   *     "value": "New Platform Name",
   *     "name": "Site Name",
   *     "description": "The name of the platform displayed to users",
   *     "group": "system",
   *     "type": "text",
   *     "updatedAt": "2024-01-15T10:30:00.000Z"
   *   }
   * }
   * ```
   *
   * @example Error response (validation)
   * ```json
   * {
   *   "status": 400,
   *   "message": "Validation failed",
   *   "errors": [
   *     {
   *       "field": "value",
   *       "message": "Commission rate must be between 0% and 100%"
   *     }
   *   ]
   * }
   * ```
   *
   * @example Error response (not found)
   * ```json
   * {
   *   "status": 404,
   *   "message": "Setting not found"
   * }
   * ```
   */
  @Put('/:key')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @UseGuards(RoleGuard)
  @ApiOperation({
    summary: 'Update admin setting',
    description: 'Updates the value of a specific system setting. Validates input based on setting type and constraints.'
  })
  @ApiParam({
    name: 'key',
    description: 'Setting key to update (e.g., site.name, commission.creator)',
    example: 'site.name'
  })
  @ApiResponse({
    status: 200,
    description: 'Setting updated successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'number', example: 200 },
        data: {
          type: 'object',
          properties: {
            _id: { type: 'string', example: '507f1f77bcf86cd799439011' },
            key: { type: 'string', example: 'site.name' },
            value: { type: 'string', example: 'New Platform Name' },
            name: { type: 'string', example: 'Site Name' },
            description: { type: 'string', example: 'The name of the platform displayed to users' },
            group: { type: 'string', example: 'system' },
            type: { type: 'string', example: 'text' },
            updatedAt: { type: 'string', format: 'date-time', example: '2024-01-15T10:30:00.000Z' }
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid setting value or validation failed'
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Missing or invalid JWT token'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Admin role required'
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Setting key does not exist'
  })
  async update(
    @Param('key') key: string,
    @Body() value: SettingUpdatePayload
  ): Promise<DataResponse<SettingDto>> {
    const data = await this.settingService.update(key, value);
    return DataResponse.ok(data);
  }
}
