import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { CommentDto } from 'src/dtos/community/comment';
import { ReactionDto } from 'src/dtos/community/reaction/reaction.dto';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user/user.dto';
import { __t } from 'src/utils/translation';
import {
  COMMENT_OBJECT_TYPES,
  REACTION_TARGET_TYPES,
  REACTION_TYPES,
} from '../../common/constants/community';
import {
  CommentCreatePayload,
  CommentEditPayload,
  CommentSearchRequestPayload
} from '../../payloads/community';
import {
  ReactionCreatePayload,
} from '../../payloads/community/reaction';
import { CommentService } from './comment/comment.service';
import { ReactionService } from './reaction/reaction.service';
import { ContentPermissionService } from 'src/services/community/content-permission.service';
import { PostCrudService } from 'src/services/content/post/post-crud.service';
import { PageableData } from 'src/kernel/common';

/**
 * Communication Service
 *
 * This service acts as an orchestrator for social communication features (comments, reactions, reports).
 * It provides permission checking and coordinates between multiple community services to avoid
 * circular dependencies and provide a clean API for social interactions.
 *
 * 🚨 IMPORTANT: CIRCULAR DEPENDENCY PREVENTION
 *
 * DO NOT inject this service into:
 * - CommentService
 * - ReactionService
 * - ReportService
 * - Any service that this CommunicationService depends on
 *
 * This service should only be injected into:
 * - Controllers
 * - Other high-level orchestrator services
 * - Services that don't have dependencies on community services
 *
 * ARCHITECTURE PATTERN:
 *
 * Controllers/High-level services
 *         ↓
 *   CommunicationService (this service)
 *         ↓
 * CommentService + ReactionService + ReportService
 *         ↓
 * Database Models & External APIs
 *
 * USAGE EXAMPLES:
 *
 * ✅ CORRECT - In Controllers:
 * ```typescript
 * @Controller('social')
 * export class SocialController {
 *   constructor(private readonly communicationService: CommunicationService) {}
 *
 *   async createComment() {
 *     return this.communicationService.createComment(payload, user);
 *   }
 * }
 * ```
 *
 * ❌ INCORRECT - In CommentService:
 * ```typescript
 * @Injectable()
 * export class CommentService {
 *   constructor(private readonly communicationService: CommunicationService) {} // CIRCULAR DEPENDENCY!
 * }
 * ```
 *
 * PURPOSE:
 * - Handles all social communication features with proper permission checking
 * - Acts as a layer between controllers and core services
 * - Ensures users have proper permissions before performing social actions
 * - Prevents circular dependencies between community services
 */
@Injectable()
export class CommunicationService {
  constructor(
    private readonly commentService: CommentService,
    private readonly reactionService: ReactionService,
    private readonly contentPermissionService: ContentPermissionService,
    // Imported by direct path, not through a services barrel: a barrel here
    // previously pulled this module into an import cycle that broke Nest boot.
    private readonly postCrudService: PostCrudService
  ) { }
  /**
   * Create a comment on content with permission validation
   *
   * @param contentType - Type of content (post, video, gallery, etc.)
   * @param contentId - ID of the content to comment on
   * @param payload - Comment creation payload
   * @param user - User creating the comment
   * @returns Promise<CommentDto> - Created comment
   */
  async createComment(
    contentType: string,
    contentId: string | ObjectId,
    payload: CommentCreatePayload,
    user: UserDto | AuthUserDto
  ): Promise<CommentDto> {
    // Validate content type
    if (!this.isValidContentType(contentType)) {
      throw new BadRequestException(`Invalid content type: ${contentType}`);
    }

    // Check if user has permission to comment
    const canComment = await this.contentPermissionService.canComment(contentId, user);
    if (!canComment) {
      throw new ForbiddenException(__t('errors.access_denied'));
    }

    // TODO: Verify content exists and is active
    // This will be implemented when we integrate with specific content services
    await this.verifyContentExists(contentType, contentId);

    // Create comment with proper object type and ID
    const commentPayload: CommentCreatePayload = {
      ...payload,
      objectId: contentId,
      objectType: contentType as any // Cast to match the expected type
    };

    return this.commentService.createUserComment(commentPayload, user);
  }

  /**
   * Get comments for content with permission validation
   *
   * HYBRID SEARCH: Combines infinite scroll with traditional search capabilities.
   * This method provides the best of both worlds by intelligently choosing
   * the optimal pagination strategy based on the request parameters.
   *
   * Features:
   * - Use cursor pagination when available for performance
   * - Fall back to offset pagination for backward compatibility
   * - Support all existing search filters and options
   * - Automatic optimization based on request type
   *
   * @param contentType - Type of content
   * @param contentId - ID of the content
   * @param searchPayload - Search/pagination parameters
   * @param user - User requesting comments (optional for public content)
   * @returns Promise<PageableData<CommentDto>> - Comments with pagination
   */
  /**
   * Resolve the comment a notification points at, plus its thread root.
   *
   * Thin pass-through to the comment service: deep-linking needs no permission
   * branch of its own because the containing post's own guard already governs
   * whether the modal opens at all, and a missing comment is reported rather
   * than thrown.
   */
  async resolveCommentTarget(commentId: string) {
    return this.commentService.resolveTarget(commentId);
  }

  /**
   * The post's hot comment, for the post owner only.
   *
   * Ownership is enforced here rather than trusted from the client: the slot is
   * an owner-facing view of their own post's engagement, so a non-owner asking
   * for it gets nothing rather than a hidden extra comment.
   */
  async getHotComment(postId: string, viewerId?: string) {
    const post = await this.postCrudService.findById(postId);
    if (!post?.userId || !viewerId) return { comment: null };
    if (post.userId.toString() !== viewerId.toString()) return { comment: null };

    return { comment: await this.commentService.findHotComment(postId) };
  }

  async getComments(
    contentType: string,
    contentId: string,
    searchPayload: CommentSearchRequestPayload,
    user?: UserDto | AuthUserDto
  ): Promise<PageableData<CommentDto>> {
    // Validate content type
    if (!this.isValidContentType(contentType)) {
      throw new BadRequestException(`Invalid content type: ${contentType}`);
    }

    // Check if user has permission to view content
    const canView = await this.contentPermissionService.canView(contentId);
    if (!canView) {
      throw new ForbiddenException(__t('errors.access_denied'));
    }

    // TODO: Verify content exists and is active
    await this.verifyContentExists(contentType, contentId);

    // Set up search payload with object type and ID
    const commentSearchPayload: CommentSearchRequestPayload = {
      ...searchPayload,
      objectId: contentId,
      objectType: contentType as any
    };

    // Use infinite scroll if cursor parameters are provided
    if (searchPayload.cursor && searchPayload.lastCreatedAt) {
      return this.getCommentsWithInfiniteScroll(commentSearchPayload, user);
    }

    // Fall back to traditional search for backward compatibility
    return this.commentService.search(commentSearchPayload, user);
  }

  /**
   * Update a comment with permission validation
   *
   * @param commentId - ID of the comment to update
   * @param payload - Comment update payload
   * @param user - User updating the comment
   * @returns Promise<CommentDto> - Updated comment
   */
  async updateComment(
    commentId: string | ObjectId,
    payload: CommentEditPayload,
    user: UserDto | AuthUserDto
  ): Promise<CommentDto> {
    // The existing comment service handles ownership validation
    return this.commentService.updateUserComment(commentId, payload, user);
  }

  /**
   * Delete a comment with permission validation
   *
   * @param commentId - ID of the comment to delete
   * @param user - User deleting the comment
   * @returns Promise<boolean> - Success status
   */
  async deleteComment(commentId: string | ObjectId, user: UserDto | AuthUserDto): Promise<boolean> {
    // The existing comment service handles ownership validation
    const result = await this.commentService.deleteUserComment(commentId, user);
    return result.deleted;
  }

  async toggleReaction(
    contentType: string,
    contentId: string | ObjectId,
    reactionData: ReactionCreatePayload,
    user: UserDto | AuthUserDto
  ): Promise<{ action: 'added' | 'removed'; reaction?: ReactionDto }> {
    // Check if user can react to this content
    if (!await this.contentPermissionService.canReact(contentId, user)) {
      throw new ForbiddenException(__t('errors.access_denied'));
    }

    // Validate content type against allowed reaction targets
    const validTargetTypes = Object.values(REACTION_TARGET_TYPES);
    if (!validTargetTypes.includes(contentType as any)) {
      throw new BadRequestException(`Invalid content type for reactions: ${contentType}`);
    }

    // First try to remove existing reaction
    const removePayload: ReactionCreatePayload = {
      objectType: contentType as any,
      objectId: contentId,
      action: reactionData.action
    };

    const removed = await this.reactionService.remove(removePayload, user);

    if (removed) {
      return { action: 'removed' };
    }

    // If no existing reaction found, create new one
    const createPayload: ReactionCreatePayload = {
      ...reactionData,
      objectType: contentType as any,
      objectId: contentId
    };

    const { reaction } = await this.reactionService.create(createPayload, user);
    return { action: 'added', reaction };
  }

  /**
   * Record that a user shared a piece of content.
   *
   * Sharing remains a client-side link copy or native share; this only stores
   * the fact that it happened so the owner can be notified. `ReactionService.create`
   * is idempotent, so re-sharing the same post returns the existing record and
   * publishes nothing — the owner is notified once per sharer, not once per share.
   */
  async recordShare(
    contentType: string,
    contentId: string | ObjectId,
    user: UserDto | AuthUserDto
  ): Promise<{ recorded: boolean; created: boolean }> {
    if (contentType !== REACTION_TARGET_TYPES.POST) {
      throw new BadRequestException(`Invalid content type for shares: ${contentType}`);
    }

    if (!await this.contentPermissionService.canView(contentId)) {
      throw new ForbiddenException(__t('errors.access_denied'));
    }

    const { created } = await this.reactionService.create({
      objectType: REACTION_TARGET_TYPES.POST,
      objectId: contentId,
      action: REACTION_TYPES.SHARE
    }, user);

    // `created` tells the caller whether this share added a new distinct sharer.
    // The client needs it to move its counter in step with the stored statistic
    // instead of counting every share action.
    return { recorded: true, created };
  }

  // ========== Private Helper Methods ==========

  /**
   * Validate if content type is supported
   *
   * @param contentType - Content type to validate
   * @returns boolean - true if valid content type
   */
  private isValidContentType(contentType: string): boolean {
    const validTypes = Object.values(COMMENT_OBJECT_TYPES);
    return validTypes.includes(contentType as any);
  }

  /**
   * Verify that content exists and is active
   * This is a placeholder that will be implemented when integrating
   * with specific content services
   *
   * @param contentType - Type of content
   * @param contentId - ID of the content
   * @returns Promise<void> - Throws if content doesn't exist or is inactive
   */
  private async verifyContentExists(contentType: string, contentId: string | ObjectId): Promise<void> {
    // Validate MongoDB ObjectId format
    if (!ObjectId.isValid(contentId)) {
      throw new BadRequestException(__t('errors.invalid_content_id_format'));
    }

    // TODO: Implement content verification based on type
    // This will check with appropriate services (PostService, VideoService, etc.)
    // and throw NotFoundException if content doesn't exist or is inactive

    // For now, we'll assume content exists
    // In production, this would look like:
    // switch (contentType) {
    //   case COMMENT_OBJECT_TYPES.POST:
    //     const post = await this.postService.findById(contentId);
    //     if (!post || post.status !== 'active') {
    //       throw new NotFoundException('Post not found or inactive');
    //     }
    //     break;
    //   case COMMENT_OBJECT_TYPES.VIDEO:
    //     // Similar check for video
    //     break;
    //   // ... other content types
    // }

    // Placeholder validation - just check if contentId is valid
    if (!contentId || typeof contentId !== 'string') {
      throw new NotFoundException(__t('errors.content_not_found'));
    }
  }

  /**
   * Get comments with infinite scroll pagination and permission validation
   *
   * Provides cursor-based pagination for smooth infinite scrolling experience.
   * Includes all permission checks and content validation.
   *
   * @param searchPayload - Search request with cursor pagination parameters
   * @param user - Optional user for personalized data (reaction status)
   * @returns Promise with comments, hasMore flag, and nextCursor
   */
  private async getCommentsWithInfiniteScroll(
    searchPayload: CommentSearchRequestPayload,
    user?: UserDto | AuthUserDto
  ) {
    return this.commentService.getInfiniteScrollComments(searchPayload, user);
  }
}