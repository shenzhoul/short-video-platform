import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from 'src/common/decorators/auth-user.decorator';
import { CustomThrottlerGuard } from 'src/common/guards/throttler.guard';
import { CommentDto } from 'src/dtos/community/comment';
import { ReactionDto } from 'src/dtos/community/reaction/reaction.dto';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { AuthGuard, LoadUser, PaginationGuard } from '../../common/guards';
import { DataResponse } from '../../kernel';
import { PageableData } from 'src/kernel/common';
import {
  CommentCreatePayload,
  CommentCreateRequestPayload,
  CommentEditPayload,
  CommentSearchRequestPayload,
  ReactionCreatePayload,
  ReactionCreateRequestPayload
} from 'src/payloads';
import { CommunicationService } from 'src/services';

/**
 * Social Controller
 *
 * Handles social interaction API endpoints following the pattern:
 * /api/social/{contentType}/{contentId}/{action}
 *
 * Currently implements comment functionality with permission validation.
 */
@ApiTags('Social')
@ApiSecurity('token-auth')
@Controller('social')
export class SocialController {
  constructor(private readonly communicationService: CommunicationService) { }

  /**
   * Create a comment on content
   * POST /api/social/{contentType}/{contentId}/comments
   */
  @Post(':contentType/:contentId/comments')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 comments per minute
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Create comment',
    description: 'Create a new comment on specified content. Supports nested replies and mentions. Rate limited to 10 comments per minute.'
  })
  @ApiParam({
    name: 'contentType',
    description: 'Type of content being commented on (e.g., post, video, photo)',
    example: 'post'
  })
  @ApiParam({
    name: 'contentId',
    description: 'ID of the content being commented on',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiBody({
    type: CommentCreateRequestPayload,
    description: 'Comment creation data including content and optional parent comment ID'
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Comment created successfully',
    type: DataResponse<CommentDto>
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid comment data or validation error'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded (10 comments per minute)'
  })
  async createComment(
    @Param('contentType') contentType: string,
    @Param('contentId') contentId: string,
    @Body() payload: CommentCreateRequestPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<CommentDto>> {
    // Build the full payload with URL parameters
    const fullPayload: CommentCreatePayload = {
      content: payload.content,
      objectType: contentType,
      objectId: contentId,
      replyToUserId: payload.replyToUserId,
      replyToName: payload.replyToName,
      mentionedUserIds: payload.mentionedUserIds
    };

    const comment = await this.communicationService.createComment(
      contentType,
      contentId,
      fullPayload,
      user
    );
    return DataResponse.ok(comment);
  }

  /**
   * Get comments for content
   * GET /api/social/{contentType}/{contentId}/comments
   */
  @Get(':contentType/:contentId/comments')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoadUser, PaginationGuard)
  @ApiOperation({
    summary: 'Get comments',
    description: 'Retrieve paginated comments for specified content. Supports filtering, sorting, and nested replies.'
  })
  @ApiParam({
    name: 'contentType',
    description: 'Type of content to get comments for (e.g., post, video, photo)',
    example: 'post'
  })
  @ApiParam({
    name: 'contentId',
    description: 'ID of the content to get comments for',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiQuery({
    type: CommentSearchRequestPayload,
    description: 'Query parameters for filtering and pagination'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Comments retrieved successfully',
    type: DataResponse<PageableData<CommentDto>>
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid query parameters'
  })
  async getComments(
    @Param('contentType') contentType: string,
    @Param('contentId') contentId: string,
    @Query() searchPayload: CommentSearchRequestPayload,
    @CurrentUser() user?: AuthUserDto
  ): Promise<DataResponse<PageableData<CommentDto>>> {
    const comments = await this.communicationService.getComments(
      contentType,
      contentId,
      searchPayload,
      user
    );
    return DataResponse.ok(comments);
  }

  /**
   * Update a comment
   * PUT /api/social/comments/{commentId}
   *
   * Note: This endpoint doesn't follow the full pattern since we're updating
   * a comment directly by its ID, not through content type/ID
   */
  /**
   * Resolve a single comment for notification deep-linking
   * GET /api/social/comments/{commentId}/target
   */
  @Get('comments/:commentId/target')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Resolve a comment target',
    description: 'Returns one comment by id together with the root comment of its thread, so a notification can deep-link to it without paging through the comment list. Reports found=false when the comment has been deleted rather than erroring.'
  })
  @ApiParam({
    name: 'commentId',
    description: 'ID of the comment a notification points at',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Target resolved, or reported as missing' })
  async resolveCommentTarget(
    @Param('commentId') commentId: string
  ): Promise<DataResponse<{ found: boolean; comment: CommentDto | null; root: CommentDto | null }>> {
    return DataResponse.ok(await this.communicationService.resolveCommentTarget(commentId));
  }

  /**
   * The post's hot comment, for its owner
   * GET /api/social/post/{postId}/hot-comment
   */
  @Get(':contentType/:contentId/hot-comment')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @ApiOperation({
    summary: 'Get the hot comment',
    description: 'Returns the single most-liked top-level comment on a post, for the post owner only. Null when nothing reaches the like threshold or the viewer does not own the post.'
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Hot comment resolved, or null' })
  async getHotComment(
    @Param('contentId') contentId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ comment: CommentDto | null }>> {
    return DataResponse.ok(await this.communicationService.getHotComment(contentId, user._id?.toString()));
  }

  @Put('comments/:commentId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 comment updates per minute
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({
    summary: 'Update comment',
    description: 'Update an existing comment. Only the comment author can update their own comments. Rate limited to 10 updates per minute.'
  })
  @ApiParam({
    name: 'commentId',
    description: 'ID of the comment to update',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiBody({
    type: CommentEditPayload,
    description: 'Updated comment content'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Comment updated successfully',
    type: DataResponse<CommentDto>
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid comment data or validation error'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User is not the author of the comment'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Comment not found'
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded (10 updates per minute)'
  })
  async updateComment(
    @Param('commentId') commentId: string,
    @Body() payload: CommentEditPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<CommentDto>> {
    const comment = await this.communicationService.updateComment(
      commentId,
      payload,
      user
    );
    return DataResponse.ok(comment);
  }

  /**
   * Delete a comment
   * DELETE /api/social/comments/{commentId}
   *
   * Note: This endpoint doesn't follow the full pattern since we're deleting
   * a comment directly by its ID, not through content type/ID
   */
  @Delete('comments/:commentId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 comment deletions per minute
  @ApiOperation({
    summary: 'Delete comment',
    description: 'Delete an existing comment. Only the comment author or administrators can delete comments. Rate limited to 10 deletions per minute.'
  })
  @ApiParam({
    name: 'commentId',
    description: 'ID of the comment to delete',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Comment deleted successfully',
    type: DataResponse<{ deleted: boolean }>
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.FORBIDDEN,
    description: 'User is not the author of the comment and not an administrator'
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Comment not found'
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded (10 deletions per minute)'
  })
  async deleteComment(
    @Param('commentId') commentId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ deleted: boolean }>> {
    const deleted = await this.communicationService.deleteComment(commentId, user);
    return DataResponse.ok({ deleted });
  }

  /**
   * Toggle a reaction on content (add if not exists, remove if exists)
   * POST /api/social/{contentType}/{contentId}/reactions/toggle
   */
  @Post(':contentType/:contentId/reactions/toggle')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 reactions per minute
  @UsePipes(new ValidationPipe({ transform: true, forbidNonWhitelisted: true }))
  @ApiOperation({
    summary: 'Toggle reaction',
    description: 'Toggle a reaction on content - adds the reaction if it doesn\'t exist, removes it if it does. Rate limited to 20 reactions per minute.'
  })
  @ApiParam({
    name: 'contentType',
    description: 'Type of content being reacted to (e.g., post, video, photo, comment)',
    example: 'post'
  })
  @ApiParam({
    name: 'contentId',
    description: 'ID of the content being reacted to',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiBody({
    type: ReactionCreateRequestPayload,
    description: 'Reaction data including the action type (like, love, etc.)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Reaction toggled successfully',
    type: DataResponse<{ action: 'added' | 'removed'; reaction?: ReactionDto }>
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid reaction data or validation error'
  })
  @ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'User not authenticated'
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded (20 reactions per minute)'
  })
  async toggleReaction(
    @Param('contentType') contentType: string,
    @Param('contentId') contentId: string,
    @Body() reactionData: ReactionCreateRequestPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ action: 'added' | 'removed'; reaction?: ReactionDto }>> {
    // Build the full payload with URL parameters
    const fullPayload: ReactionCreatePayload = {
      action: reactionData.action,
      objectType: contentType as any,
      objectId: contentId
    };

    const result = await this.communicationService.toggleReaction(
      contentType,
      contentId,
      fullPayload,
      user
    );
    return DataResponse.ok(result);
  }

  /**
   * Record a share of content
   * POST /api/social/{contentType}/{contentId}/share
   */
  @Post(':contentType/:contentId/share')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard, CustomThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 shares per minute
  @ApiOperation({
    summary: 'Record a share',
    description: 'Records that the authenticated user shared this content, so the owner can be notified. Sharing itself happens on the client (native share or link copy); this endpoint only stores the fact. Idempotent — repeat shares of the same content by the same user record and notify once. `created` reports whether this call added a new distinct sharer, so the client can move its share counter in step with the stored statistic.'
  })
  @ApiParam({ name: 'contentType', description: 'Type of content shared', example: 'post' })
  @ApiParam({ name: 'contentId', description: 'ID of the content shared', example: '507f1f77bcf86cd799439011' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Share recorded successfully' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Content type does not support shares' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'User not authenticated' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Rate limit exceeded (20 shares per minute)' })
  async recordShare(
    @Param('contentType') contentType: string,
    @Param('contentId') contentId: string,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<{ recorded: boolean; created: boolean }>> {
    const result = await this.communicationService.recordShare(contentType, contentId, user);
    return DataResponse.ok(result);
  }
}
