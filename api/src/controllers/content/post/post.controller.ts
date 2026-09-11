import {
  BadRequestException,
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
import {
  PostRecommendationRequest, PostSearchRequest, PostUnlikePayload, ReactionSearchRequestPayload, RecommendationEventBatchPayload
} from "src/payloads";
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

  @Get('/friends')
  @UseGuards(AuthGuard, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiSecurity('token-auth')
  @ApiOperation({
    summary: 'Get posts from friends',
    description: 'Posts from creators the current user follows who follow them back. "Friend" is mutual follow — the same relationship that lets two people message each other without a request.'
  })
  @ApiQuery({ type: PostSearchRequest })
  async friendPosts(
    @Query() query: PostSearchRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<PageableData<PostDto>>> {
    return DataResponse.ok(await this.contentService.getFriendPosts(query, user) as PageableData<PostDto>);
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
    @Query() query: PostRecommendationRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    const data = await this.contentService.getHomeRecommendedPosts(query, user);
    return DataResponse.ok(data);
  }

  @Post('/recommendation-events')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // Batches of events, not one call per event — see RecommendationEventBatchPayload.
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary: 'Record recommendation telemetry',
    description: 'Batched impression/watch/skip/dwell/detail-open/like/comment/share/follow_after_view events feeding the recommendation engine.'
  })
  @ApiBody({ type: RecommendationEventBatchPayload })
  async recordRecommendationEvents(
    @Body() payload: RecommendationEventBatchPayload,
    @CurrentUser() user?: AuthUserDto
  ): Promise<DataResponse<{ accepted: number; deduped: number; rejected: number }>> {
    const result = await this.contentService.recordRecommendationEvents(payload, user);
    return DataResponse.ok(result);
  }

  @Post('/:id/detail-session')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Open a Post Detail recommendation session',
    description: 'Anchors a next/previous sequence on one post for Home, notification, message and direct-link sources (rules/instructions §13).'
  })
  @ApiParam({ name: 'id', description: 'Anchor post id', type: 'string' })
  async openDetailSession(
    @Param('id') id: string,
    @Query('anonymousId') anonymousId: string | undefined,
    @CurrentUser() user?: AuthUserDto
  ): Promise<DataResponse<{ sessionId: string; postId: string }>> {
    const result = await this.contentService.openPostDetailRecommendationSession(id, user, anonymousId);
    return DataResponse.ok(result);
  }

  @Get('/detail-session/:sessionId/next')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Advance a Post Detail recommendation session' })
  async detailSessionNext(
    @Param('sessionId') sessionId: string,
    @Query('anonymousId') anonymousId: string | undefined,
    // Not a payload class: this handler takes no ValidationPipe, so the raw
    // string is compared explicitly rather than relying on a coercion that
    // would turn 'false' into true (see rules/api.md).
    @Query('videoOnly') videoOnly: string | undefined,
    @CurrentUser() user?: AuthUserDto
  ): Promise<DataResponse<{ postId: string } | null>> {
    const result = await this.contentService.stepPostDetailRecommendationNext(
      sessionId, user, anonymousId, videoOnly === 'true'
    );
    return DataResponse.ok(result);
  }

  @Get('/detail-session/:sessionId/previous')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Step a Post Detail recommendation session back' })
  async detailSessionPrevious(
    @Param('sessionId') sessionId: string,
    @Query('anonymousId') anonymousId: string | undefined,
    @CurrentUser() user?: AuthUserDto
  ): Promise<DataResponse<{ postId: string } | null>> {
    const result = await this.contentService.stepPostDetailRecommendationPrevious(sessionId, user, anonymousId);
    return DataResponse.ok(result);
  }

  /**
   * One creator's posts, in the creator's own order.
   *
   * This exists because `/home-posts` stopped being able to answer it. That
   * route used to run `userSearchPosts`, which honours `userId`, `sortBy` and
   * the pinned-aware cursor; the recommendation work repointed it at the ranked
   * Home feed, which has no notion of a creator filter and whose payload class
   * (`PostRecommendationRequest`, `whitelist: true`) strips `userId` before the
   * service ever sees it. Every caller that asked for "this creator's posts" —
   * the creator profile grid and the Post Detail Videos tab — silently began
   * receiving the whole ranked feed instead, which is how a creator's grid came
   * to hold eight other creators' posts under their name.
   *
   * Declared above `/:id` on purpose: Nest matches routes in declaration order,
   * and `creator-posts` would otherwise be read as a post id.
   */
  @Get('/creator-posts')
  @UseGuards(LoadUser, PaginationGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: "Get one creator's posts",
    description: "Posts belonging to a single creator, pinned first, in the creator's own ordering. Requires `userId`. Pass `creatorOrder=latest` for plain newest-first (the account menu preview)."
  })
  @ApiQuery({ type: PostSearchRequest, description: 'Creator id plus pagination/cursor parameters' })
  @ApiResponse({ status: HttpStatus.OK, description: "The creator's posts" })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Missing or invalid userId' })
  async getCreatorPosts(
    @Query() query: PostSearchRequest,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    // A creator listing with no creator is the bug this route was added to stop
    // — answering it with an unfiltered feed is exactly what went wrong before.
    if (!query.userId) throw new BadRequestException('userId is required');
    return DataResponse.ok(await this.contentService.userSearchPosts(query, user));
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
