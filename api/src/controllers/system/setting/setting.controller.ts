import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Post,
  Query,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import { DataResponse } from 'src/kernel';
import { UploadPolicyService } from 'src/services/shared/file-server';
import { SettingService } from 'src/services/system/setting/setting.service';

/**
 * Public Settings Controller
 *
 * Provides public access to system settings that are safe for client-side consumption.
 * Allows frontend applications to retrieve configuration values, feature flags, and
 * public system information without requiring authentication.
 *
 * Key Features:
 * - Retrieve public settings by group or individually
 * - Batch retrieval of multiple settings by keys
 * - Access to autoload settings for initial app configuration
 * - Security filtering to only expose public and visible settings
 * - Optimized for frontend integration and performance
 *
 * Security Considerations:
 * - Only returns settings marked as 'public' and 'visible'
 * - No authentication required for public access
 * - Input validation on all parameters
 * - Rate limiting should be applied at infrastructure level
 *
 * Use Cases:
 * - Frontend configuration loading
 * - Feature flag checking
 * - Public site information display
 * - Client-side settings management
 *
 * @example Frontend usage
 * ```typescript
 * // Get all public settings
 * const settings = await fetch('/api/settings/public');
 *
 * // Get settings by group
 * const systemSettings = await fetch('/api/settings/public?group=system');
 *
 * // Get specific setting
 * const siteName = await fetch('/api/settings/keys/site.name');
 *
 * // Batch get multiple settings
 * const config = await fetch('/api/settings/keys', {
 *   method: 'POST',
 *   body: JSON.stringify({ keys: ['site.name', 'site.description'] })
 * });
 * ```
 */
@Injectable()
@Controller('settings')
@ApiTags('Public Settings')
export class SettingController {
  constructor(
    private readonly settingService: SettingService,
    private readonly uploadPolicyService: UploadPolicyService
  ) { }

  /**
   * The upload limits currently in force, per durable upload type.
   *
   * ## Why this is not just the raw settings
   *
   * A client could fetch `?group=upload-limits` and get fifty-seven numbers in
   * operator units — megabytes, megapixels, seconds — and would then have to
   * convert them, apply the defaults for whatever is missing, and clamp anything
   * out of range. Three implementations of that, and one of them would be wrong.
   *
   * So the API resolves the effective policy once, with the same function the
   * upload path uses, and returns the finished article: bytes, pixels and
   * milliseconds, complete on every axis, ready to compare a picked file
   * against.
   *
   * ## Public on purpose
   *
   * These are limits, not secrets. The file server names every one of them in a
   * rejection body, and a picker that cannot say "10MB" before the upload is a
   * picker that wastes somebody's transfer to find out.
   *
   * ## Still not enforcement
   *
   * What a client does with this is early feedback. The file server measures the
   * bytes that actually arrive, against the limits bound to the durable record,
   * and is the only side whose answer counts.
   */
  @Get('/upload-policies')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Get effective upload limits',
    description: 'Returns the upload policy in force for every durable upload type, with any admin overrides applied and clamped. Public: these are limits a picker has to show, not secrets.'
  })
  @ApiResponse({
    status: 200,
    description: 'Effective upload policies, keyed by durable upload type'
  })
  async getUploadPolicies(): Promise<DataResponse<Record<string, any>>> {
    return DataResponse.ok(this.uploadPolicyService.allEffectivePolicies());
  }

  /**
   * Get public settings
   *
   * Retrieves all public settings or settings filtered by group. If no group is specified
   * or 'all' is used, returns autoload public settings optimized for initial app loading.
   * Only includes settings marked as public and visible in the system configuration.
   *
   * @param group - Optional group filter ('system', 'payment', etc.) or 'all' for autoload settings
   * @returns Promise<DataResponse<Record<string, any>>> - Object with setting keys as properties
   *
   * @example Get all autoload public settings
   * ```http
   * GET /api/settings/public
   * ```
   *
   * @example Get settings by group
   * ```http
   * GET /api/settings/public?group=system
   * ```
   *
   * @example Response format
   * ```json
   * {
   *   "status": 200,
   *   "data": {
   *     "site.name": "My Platform",
   *     "site.description": "Welcome to our platform",
   *     "features.registration": true,
   *     "payment.enabled": true
   *   }
   * }
   * ```
   */
  @Get('/public')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get public settings',
    description: 'Retrieves public system settings, optionally filtered by group. Returns autoload settings for initial app configuration.'
  })
  @ApiQuery({
    name: 'group',
    required: false,
    description: 'Filter settings by group (system, payment, etc.) or use "all" for autoload settings',
    example: 'system'
  })
  @ApiResponse({
    status: 200,
    description: 'Public settings retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'number', example: 200 },
        data: {
          type: 'object',
          additionalProperties: true,
          example: {
            'site.name': 'My Platform',
            'site.description': 'Welcome to our platform',
            'features.registration': true,
            'payment.enabled': true
          }
        }
      }
    }
  })
  async getPublicSettings(
    @Query('group') group: string
  ): Promise<DataResponse<Record<string, any>>> {
    const data = !group || group === 'all'
      ? await this.settingService.getAutoloadPublicSettingsForUser()
      : await this.settingService.getPublicSettingsForUserByGroup(group);

    return DataResponse.ok(data);
  }

  /**
   * Get multiple public setting values by keys
   *
   * Batch retrieves values for multiple public settings in a single request. More efficient
   * than making multiple individual requests. Returns an object with setting keys as properties
   * and their values. Invalid or non-public keys are silently ignored.
   *
   * @param keys - Array of setting keys to retrieve
   * @returns Promise<DataResponse<Record<string, any>>> - Object with requested setting values
   *
   * @example Batch get multiple settings
   * ```http
   * POST /api/settings/keys
   * Content-Type: application/json
   *
   * {
   *   "keys": ["site.name", "site.description", "features.chat"]
   * }
   * ```
   *
   * @example Response format
   * ```json
   * {
   *   "status": 200,
   *   "data": {
   *     "site.name": "My Platform",
   *     "site.description": "Welcome to our platform",
   *     "features.chat": true
   *   }
   * }
   * ```
   *
   * @example Error response (invalid input)
   * ```json
   * {
   *   "status": 400,
   *   "message": "Keys must be an array"
   * }
   * ```
   */
  @Post('/keys')
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get multiple public settings by keys',
    description: 'Batch retrieves values for multiple public settings in a single request for improved performance.'
  })
  @ApiBody({
    description: 'Array of setting keys to retrieve',
    schema: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of setting keys',
          example: ['site.name', 'site.description', 'features.chat']
        }
      },
      required: ['keys']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Settings retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'number', example: 200 },
        data: {
          type: 'object',
          additionalProperties: true,
          example: {
            'site.name': 'My Platform',
            'site.description': 'Welcome to our platform',
            'features.chat': true
          }
        }
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid input - keys must be an array'
  })
  async getPublicValueByKeys(
    @Body('keys') keys: string[]
  ): Promise<DataResponse<Record<string, any>>> {
    if (!Array.isArray(keys)) return null;
    const data = await this.settingService.getPublicValueByKeys(keys);
    return DataResponse.ok(data);
  }
}
