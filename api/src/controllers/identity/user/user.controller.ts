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
  Put,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { USER_STATUS } from 'src/common/constants';
import { Roles } from 'src/common/decorators';
import { CurrentUser } from 'src/common/decorators/auth-user.decorator';
import { AuthGuard, CustomThrottlerGuard, LoadUser, PaginationGuard, RoleGuard } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { DataResponse, EntityNotFoundException } from 'src/kernel';
import { PageableData, SearchRequest } from 'src/kernel/common';
import { CreatorSelfUpdatePayload } from 'src/payloads';
import { FollowService, IdentityFileService } from 'src/services';
import { AuthService, BaseUserService, UserAccountManagementService } from 'src/services/identity';
import { FileServerService } from 'src/services/shared/file-server';
import { __t } from 'src/utils/translation';

@ApiTags('Users')
@ApiSecurity('token-auth')
@Injectable()
@Controller('users')
export class UserController {
  constructor(
    private readonly baseService: BaseUserService,
    private readonly userService: UserAccountManagementService,
    private readonly fileServerService: FileServerService,
    private readonly identityFileService: IdentityFileService,
    private readonly authService: AuthService,
    private readonly followService: FollowService
  ) { }
  @ApiOperation({
    summary: 'Get current user details',
    description: 'Retrieve detailed information about the currently authenticated user. Returns different data based on whether the user is a creator or regular user.'
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
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async me(
    @CurrentUser() current: AuthUserDto
  ): Promise<DataResponse<Partial<UserDto>>> {
    const user = await this.baseService.getMe(current._id);
    return DataResponse.ok(user.toResponse(true));
  }

  @Put('/manager')
  @Roles('user')
  @UseGuards(RoleGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 profile updates per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Update creator profile',
    description: 'Update the current creator\'s profile information. Requires creator role.'
  })
  @ApiBody({
    type: CreatorSelfUpdatePayload,
    description: 'Creator profile update data',
    examples: {
      'update-profile': {
        summary: 'Update creator profile',
        value: {
          name: 'John Doe',
          bio: 'Updated bio',
          website: 'https://new-website.com',
          password: 'newpassword123'
        }
      }
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Creator profile updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: {
          type: 'object',
          description: 'Updated creator profile information'
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
    status: 400,
    description: 'Bad request - Invalid profile data'
  })
  async updateUser(
    @Body() payload: CreatorSelfUpdatePayload,
    @CurrentUser() currentUser: AuthUserDto
  ): Promise<DataResponse<Partial<UserDto>>> {
    await this.userService.selfUpdate(currentUser._id, payload);
    const creator = await this.userService.getDetails(currentUser._id);
    if (payload.password) {
      await this.authService.createAuthPassword({
        userId: creator._id,
        type: 'password',
        key: creator.email,
        value: payload.password
      });
    }
    return DataResponse.ok(creator.toResponse(true, false));
  }

  @Get('/following')
  @UseGuards(AuthGuard, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'List creators followed by the current user' })
  async following(
    @Query() query: SearchRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<Partial<UserDto>>>> {
    return DataResponse.ok(await this.followService.getFollowingUsers(user._id, query) as PageableData<Partial<UserDto>>);
  }

  @Get('/:id/followings')
  @UseGuards(LoadUser, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'List creators followed by a user' })
  @ApiParam({ name: 'id', description: 'User id' })
  async followings(
    @Param('id') userId: string,
    @Query() query: SearchRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<Partial<UserDto>>>> {
    return DataResponse.ok(
      await this.followService.getFollowingUsers(userId, query, user?._id) as PageableData<Partial<UserDto>>
    );
  }

  @Get('/:id/followers')
  @UseGuards(LoadUser, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'List users following a creator' })
  @ApiParam({ name: 'id', description: 'Creator id' })
  async followers(
    @Param('id') creatorId: string,
    @Query() query: SearchRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<Partial<UserDto>>>> {
    return DataResponse.ok(
      await this.followService.getFollowerUsers(creatorId, query, user?._id) as PageableData<Partial<UserDto>>
    );
  }

  @Delete('/me/followers/:id')
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove one of the current user\'s followers' })
  @ApiParam({ name: 'id', description: 'Follower user id' })
  async removeFollower(
    @Param('id') followerId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ isFollowed: false; removed: boolean }>> {
    // Dropping a follower is the same relation as that follower unfollowing the current user.
    return DataResponse.ok(await this.followService.unfollow(followerId, user._id) as { isFollowed: false; removed: boolean });
  }

  @Post('/:id/follow')
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Follow a creator once' })
  async follow(
    @Param('id') creatorId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ isFollowed: true; created: boolean }>> {
    return DataResponse.ok(await this.followService.follow(user._id, creatorId) as { isFollowed: true; created: boolean });
  }

  @Delete('/:id/follow')
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop following a creator' })
  async unfollow(
    @Param('id') creatorId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ isFollowed: false; removed: boolean }>> {
    return DataResponse.ok(await this.followService.unfollow(user._id, creatorId) as { isFollowed: false; removed: boolean });
  }

  @ApiOperation({
    summary: 'Get creator details by username',
    description: 'Retrieve detailed information about a specific creator by their username. Rate limited to 20 requests per minute. Includes subscription status and blocking checks.'
  })
  @ApiParam({
    name: 'username',
    description: 'Creator\'s username',
    example: 'creator123'
  })
  @ApiResponse({
    status: 200,
    description: 'Creator details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        data: { $ref: '#/components/schemas/CreatorDto' }
      }
    }
  })
  @ApiResponse({
    status: 404,
    description: 'Creator not found'
  })
  @ApiResponse({
    status: 400,
    description: 'Account is suspended'
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests - Rate limit exceeded (60 requests per minute)'
  })
  @Get('/:username')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 creator detail requests per minute
  @HttpCode(HttpStatus.OK)
  async getDetails(
    @Param('username') creatorUsername: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<Partial<UserDto>>> {
    const creator = await this.userService.findByUsername(creatorUsername);

    // Validate creator status
    if (!creator) throw new EntityNotFoundException();
    if (creator.status === USER_STATUS.DELETED) {
      throw new HttpException(__t('identity.creator.account_no_longer_available'), 410);
    }
    if (creator.status === USER_STATUS.INACTIVE) {
      throw new HttpException(__t('identity.creator.account_suspended'), 400);
    }
    if (
      creator.status !== USER_STATUS.ACTIVE && (!user || user._id.toString() !== creator._id.toString())
    ) {
      throw new HttpException(__t('identity.creator.account_suspended'), 400);
    }

    creator.isFollowed = user && user._id.toString() !== creator._id.toString()
      ? (await this.followService.getFollowingCreatorIdSet(user._id, [creator._id])).has(creator._id.toString())
      : false;

    // Note: Profile view tracking moved to separate CreatorStatsController
    // Client should call POST /creator-stats/:creatorId/view endpoint

    return DataResponse.ok(creator.toPublicDetailsResponse());
  }

  @Put('/cover')
  @HttpCode(HttpStatus.OK)
  @Roles('user')
  @UseGuards(RoleGuard)
  @ApiOperation({
    summary: 'Update creator cover image',
    description: 'Update the current creator\'s cover image. Requires creator role and file ownership validation.'
  })
  @ApiBody({
    description: 'Cover image update data',
    schema: {
      type: 'object',
      properties: {
        coverId: {
          type: 'string',
          description: 'Cover image file ID',
          example: '507f1f77bcf86cd799439011'
        }
      },
      required: ['coverId']
    }
  })
  @ApiResponse({
    status: 200,
    description: 'Cover image updated successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        url: {
          type: 'string',
          description: 'Cover image URL',
          example: 'https://cdn.example.com/cover.jpg'
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
    status: 404,
    description: 'File not found'
  })
  async updateCover(
    @Body('coverId') coverId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<any> {
    // Validate file ownership
    await this.identityFileService.validateIdentityDocumentOwnership([coverId], user, 'update');

    const cover = await this.fileServerService.getFileInfo(coverId);
    if (!cover) throw new EntityNotFoundException();
    await this.userService.updateCover(user, cover);
    return DataResponse.ok({
      success: true,
      url: cover.url,
      coverBgColor: cover.metadata?.coverBgColor
    });
  }

  @ApiOperation({
    summary: 'Update user avatar',
    description: 'Update the current user\'s avatar using an uploaded file ID. Validates file ownership and updates file references.'
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
    status: 404,
    description: 'File not found'
  })
  @Put('/me/avatar')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard)
  async updateUserAvatar(
    @Body('avatarId') avatarId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<any> {
    // Validate file ownership
    await this.identityFileService.validateIdentityDocumentOwnership([avatarId], user, 'update');

    const avatar = await this.fileServerService.getFileInfo(avatarId);
    if (!avatar) throw new EntityNotFoundException();

    // Add file reference before updating avatar
    await this.fileServerService.updateFileOwnership({
      fileIds: [avatarId],
      createdBy: user._id.toString(),
      ref: {
        itemId: user._id,
        itemType: 'user'
      }
    });

    await this.userService.updateAvatar(user, avatar);
    return DataResponse.ok({
      success: true,
      url: avatar.url
    });
  }
}
