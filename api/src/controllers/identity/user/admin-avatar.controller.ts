import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Injectable,
  Param,
  Put,
  UseGuards
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Roles } from 'src/common/decorators';
import { RoleGuard } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { DataResponse, EntityNotFoundException } from 'src/kernel';
import { UserAccountManagementService } from 'src/services/identity/user/user.service';

@ApiTags('Admin User Avatars')
@ApiSecurity('token-auth')
@Injectable()
@Controller('admin/users')
export class AdminAvatarController {
  constructor(
    private readonly userService: UserAccountManagementService
  ) { }

  @ApiOperation({
    summary: 'Update user avatar (Admin)',
    description: 'Update a user\'s avatar using an uploaded file ID. Requires admin role. Validates file ownership and updates file references.'
  })
  @ApiParam({
    name: 'id',
    description: 'User ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiBody({
    description: 'Avatar update information',
    schema: {
      type: 'object',
      properties: {
        avatarId: {
          type: 'string',
          description: 'File ID of the uploaded avatar image',
          example: 'file_507f1f77bcf86cd799439011'
        }
      },
      required: ['avatarId']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'User avatar updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            url: { type: 'string', example: 'https://cdn.example.com/avatar.jpg' }
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
    description: 'Forbidden - Admin role required'
  })
  @ApiResponse({
    status: 404,
    description: 'User or file not found'
  })
  @Put('/:id/avatar')
  @HttpCode(HttpStatus.OK)
  @Roles('admin')
  @UseGuards(RoleGuard)
  async updateUserAvatar(
    @Param('id') userId: string,
    @Body('avatarId') avatarId: string,
    @CurrentUser() currentUser: AuthUserDto
  ): Promise<any> {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new EntityNotFoundException();
    }

    // The admin is passed as the actor, separately from the profile being
    // changed: an avatar an admin uploaded is stamped `createdBy: 'admin'`, and
    // only an admin may spend one on somebody else's profile. Everything else —
    // the file exists, it is an `avatar` upload, its processing succeeded, it is
    // not already on another profile — is checked inside updateAvatar against
    // the file server's own record.
    //
    // The claim also happens there, before the profile points at the image. It
    // used to happen here, *after* the profile had already been updated, which
    // left a window where the unused-file sweeper could collect a live avatar.
    const avatar = await this.userService.updateAvatar(new UserDto(user), avatarId, currentUser);

    return DataResponse.ok({
      success: true,
      url: avatar.url
    });
  }
}
