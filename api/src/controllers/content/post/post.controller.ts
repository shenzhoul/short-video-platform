import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Injectable, Param, Post, Query, UseGuards, UsePipes, ValidationPipe
} from "@nestjs/common";
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { CurrentUser } from "src/common/decorators";
import { AuthGuard, CustomThrottlerGuard, LoadUser, PaginationGuard } from "src/common/guards";
import { PostDto } from "src/dtos/content";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { DataResponse } from "src/kernel";
import { PageableData } from "src/kernel/common";
import { PostRecommendationRequest, PostSearchRequest, PostUnlikePayload, ReactionSearchRequestPayload } from "src/payloads";
import { PostStatisticsService } from "src/services";
import { ContentService } from "src/services/content";

@Injectable()
@Controller('/posts')
@ApiTags('Public Posts')
export class UserPostController {
  constructor(
    private readonly contentService: ContentService,
    private readonly postStatisticsService: PostStatisticsService
  ) { }

  @Post('/:id/view')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Record a post view',
    description: 'Increments the view counter when a visitor opens post details. Owner views are excluded.'
  })
  @ApiParam({ name: 'id', description: 'Unique identifier of the post', type: 'string' })
  async recordView(
    @Param('id') id: string,
    @CurrentUser() user?: AuthUserDto
  ): Promise<DataResponse<{ totalView: number }>> {
    const totalView = await this.postStatisticsService.handleViewStat(id, 1, user?._id);
    return DataResponse.ok({ totalView });
  }

  @Get('/liked')
  @UseGuards(AuthGuard, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiSecurity('token-auth')
  @ApiOperation({ summary: 'Get posts liked by the current user' })
  @ApiQuery({ type: ReactionSearchRequestPayload })
  async likedPosts(
    @Query() query: ReactionSearchRequestPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<PostDto>>> {
    return DataResponse.ok(await this.contentService.getLikedPosts(query, user) as PageableData<PostDto>);
  }

  @Delete('/liked')
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @ApiSecurity('token-auth')
  @ApiOperation({ summary: 'Unlike one or more posts' })
  @ApiBody({ type: PostUnlikePayload })
  async unlikePosts(
    @Body() payload: PostUnlikePayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ removedPostIds: string[] }>> {
    const removedPostIds = await this.contentService.unlikePosts(payload.postIds, user);
    return DataResponse.ok({ removedPostIds });
  }

  @Get('/recommended')
  @UseGuards(LoadUser, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get recommended videos',
    description: 'Returns a cursor-paginated video feed ranked by engagement and recency.'
  })
  @ApiQuery({ type: PostRecommendationRequest })
  async getRecommendedPosts(
    @Query() query: PostRecommendationRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    return DataResponse.ok(await this.contentService.recommendPosts(query, user));
  }

  @Get('/following')
  @UseGuards(AuthGuard, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiSecurity('token-auth')
  @ApiOperation({ summary: 'Get posts from followed creators' })
  @ApiQuery({ type: PostSearchRequest })
  async followingPosts(
    @Query() query: PostSearchRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<PostDto>>> {
    return DataResponse.ok(await this.contentService.getFollowingPosts(query, user) as PageableData<PostDto>);
  }

  @Get('/home-posts')
  @UseGuards(LoadUser, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } }) // 120 home posts requests per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get personalized home posts',
    description: 'Retrieves posts from creators, providing personalized content based on preferences and interests.'
  })
  @ApiQuery({
    type: PostSearchRequest,
    description: 'Search parameters including filters and pagination for personalized content'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Personalized home posts retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Paginated posts from creators'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid search parameters'
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded (120 requests per minute)'
  })
  /**
   * Get personalized home posts
   *
   * Retrieves posts from creators the user is subscribed to for personalized home post.
   * Provides content tailored to the user's subscription preferences and interests.
   *
   * @param query Search parameters including filters and pagination
   * @param user Current user context for subscription filtering
   * @param countryCode User's country code for blocking checks
   * @returns Promise resolving to personalized home post content
   */
  async getPersonalizedHomePosts(
    @Query() query: PostSearchRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    const data = await this.contentService.userSearchPosts(query, user);
    return DataResponse.ok(data);
  }

  @Get('/:id')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } }) // 120 post detail requests per minute
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Get post details by ID',
    description: 'Retrieves detailed information about a specific post by its ID, including blocking checks and content filtering.'
  })
  @ApiSecurity('token-auth')
  @ApiParam({
    name: 'id',
    description: 'Unique identifier of the post',
    type: 'string',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Post details retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Complete post details with creator, files, and metadata. May include isCreatorDeleted flag if creator account is deleted.'
        }
      }
    }
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Post not found'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'Post is blocked or not available (inactive status). Note: Deleted creator posts are viewable but isCreatorDeleted flag will be set.'
  })
  async details(
    @Param('id') id: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // Service method should handle blocking checks (similar to creator controller optimization)
    const details = await this.contentService.findPostDetails(id, user);
    return DataResponse.ok(details);
  }
}
