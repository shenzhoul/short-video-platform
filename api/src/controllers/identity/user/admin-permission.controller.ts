import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { CurrentUser, Roles } from 'src/common/decorators';
import { RoleGuard } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { DataResponse } from 'src/kernel';
import { UserAccountManagementService } from 'src/services/identity/user/user.service';
import { __t } from 'src/utils/translation';

/**
 * Payload for toggling admin permissions
 */
class ToggleAdminPayload {
  @IsString()
  userId: string;
}

/**
 * Admin Permission Management Controller
 *
 * This controller handles admin permission management operations.
 * Only superadmin (username: 'superadmin') can access these endpoints.
 *
 * Features:
 * - Toggle admin permissions for users
 * - List all admin users
 * - Protect superadmin account from modification
 */
@ApiTags('Admin Permissions')
@ApiSecurity('token-auth')
@Injectable()
@Controller('admin/permissions')
export class AdminPermissionController {
  constructor(
    private readonly userService: UserAccountManagementService
  ) {}

  /**
   * Get all admin users
   * Only accessible by superadmin
   */
  @ApiOperation({
    summary: 'Get all admin users',
    description: 'Retrieve a list of all users with admin permissions. Only accessible by superadmin (username: \'superadmin\').'
  })
  @ApiResponse({
    status: 200,
    description: 'Admin users retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'array',
          items: { $ref: '#/components/schemas/UserDto' }
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
    description: 'Forbidden - Superadmin access required'
  })
  @Get('/admins')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UseGuards(RoleGuard)
  async getAdminUsers(
    @CurrentUser() currentUser: AuthUserDto
  ): Promise<DataResponse<Partial<UserDto>[]>> {
    // Only superadmin can access this endpoint
    if (currentUser.username !== 'superadmin') {
      throw new ForbiddenException(__t('identity.admin_permission.only_superadmin_manage'));
    }

    const adminUsers = await this.userService.findAdminUsers();
    return DataResponse.ok(adminUsers.map((user) => new UserDto(user).toResponse(true)));
  }

  /**
   * Toggle admin permission for a user
   * Only accessible by superadmin
   * Cannot modify superadmin account
   */
  @ApiOperation({
    summary: 'Toggle admin permission for a user',
    description: 'Grant or revoke admin permissions for a user. Only accessible by superadmin. Cannot modify the superadmin account itself.'
  })
  @ApiBody({
    description: 'User ID to toggle admin permissions for',
    schema: {
      type: 'object',
      properties: {
        userId: {
          type: 'string',
          description: 'ID of the user to modify',
          example: '507f1f77bcf86cd799439011'
        }
      },
      required: ['userId']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Admin permissions toggled successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            message: { type: 'string', example: 'Admin permissions granted for user john_doe' },
            user: { $ref: '#/components/schemas/UserDto' }
          }
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
    description: 'Forbidden - Superadmin access required or user not found or cannot modify superadmin'
  })
  @Post('/toggle-admin')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UseGuards(RoleGuard)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async toggleAdminPermission(
    @Body() payload: ToggleAdminPayload,
    @CurrentUser() currentUser: AuthUserDto
  ): Promise<DataResponse<{ message: string; user: Partial<UserDto> }>> {
    // Only superadmin can access this endpoint
    if (currentUser.username !== 'superadmin') {
      throw new ForbiddenException(__t('identity.admin_permission.only_superadmin_manage'));
    }

    const targetUser = await this.userService.findById(payload.userId);
    if (!targetUser) {
      throw new ForbiddenException(__t('errors.user_not_found'));
    }

    // Protect superadmin account from modification
    if (targetUser.username === 'superadmin') {
      throw new ForbiddenException(__t('identity.admin_permission.cannot_modify_superadmin_permissions'));
    }

    // Toggle admin permission
    const newAdminStatus = !targetUser.isAdmin;
    await this.userService.updateAdminStatus(payload.userId, newAdminStatus);

    const updatedUser = await this.userService.findById(payload.userId);
    const action = newAdminStatus ? 'granted' : 'removed';

    return DataResponse.ok({
      message: __t('identity.admin_permission.admin_permissions_toggled', { action, username: targetUser.username }),
      user: new UserDto(updatedUser).toResponse(true)
    });
  }

  /**
   * Get user details for admin management
   * Only accessible by superadmin
   */
  @ApiOperation({
    summary: 'Get user details for admin management',
    description: 'Retrieve detailed user information for admin management purposes. Only accessible by superadmin.'
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'User details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { $ref: '#/components/schemas/UserDto' }
      }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - Invalid authentication'
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Superadmin access required or user not found'
  })
  @Get('/user/:id')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UseGuards(RoleGuard)
  async getUserForAdminManagement(
    @Param('id') userId: string,
    @CurrentUser() currentUser: AuthUserDto
  ): Promise<DataResponse<Partial<UserDto>>> {
    // Only superadmin can access this endpoint
    if (currentUser.username !== 'superadmin') {
      throw new ForbiddenException(__t('identity.admin_permission.only_superadmin_manage'));
    }

    const user = await this.userService.findById(userId);
    if (!user) {
      throw new ForbiddenException(__t('errors.user_not_found'));
    }

    return DataResponse.ok(new UserDto(user).toResponse(true));
  }
}
