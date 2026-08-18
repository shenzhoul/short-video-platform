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
import { FILE_REFERENCE_TYPES } from 'src/common/constants';
import { CurrentUser, Roles } from 'src/common/decorators';
import { RoleGuard } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { DataResponse, EntityNotFoundException } from 'src/kernel';
import { IdentityFileService } from 'src/services';
import { UserAccountManagementService } from 'src/services/identity/user/user.service';
import { FileServerService } from 'src/services/shared/file-server';

@ApiTags('Admin User Avatars')
@ApiSecurity('token-auth')
@Injectable()
@Controller('admin/users')
export class AdminAvatarController {
  constructor(
    private readonly userService: UserAccountManagementService,
    private readonly fileServerService: FileServerService,
    private readonly identityFileService: IdentityFileService
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

    // Validate file ownership (admin users can use any file)
    await this.identityFileService.validateIdentityDocumentOwnership([avatarId], currentUser, 'update');

    const avatar = await this.fileServerService.getFileInfo(avatarId);
    if (!avatar) throw new EntityNotFoundException();

    await this.userService.updateAvatar(new UserDto(user), avatar);

    // Add file reference before updating avatar
    await this.fileServerService.updateFileOwnership({
      fileIds: [avatarId],
      createdBy: userId,
      ref: {
        itemId: userId,
        itemType: FILE_REFERENCE_TYPES.USER
      }
    });

    return DataResponse.ok({
      success: true,
      url: avatar.url
    });
  }
}
