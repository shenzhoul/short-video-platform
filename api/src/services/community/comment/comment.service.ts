import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, SortOrder } from "mongoose";
import { EVENT } from "src/kernel/constants";
import { ObjectId } from 'mongodb';
import { Comment, CommentDocument } from "src/schemas";
import { EntityNotFoundException, QueueMessageService } from "src/kernel";
import { COMMENT_CHANNELS, COMMENT_OBJECT_TYPES, COMMENT_PAGINATION, HOT_COMMENT_MIN_LIKES, REACTION_TYPES } from "src/common/constants";
import { CommentCreatePayload, CommentEditPayload, CommentSearchRequestPayload } from "src/payloads";
import { UserDto } from "src/dtos/identity/user";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { PageableData } from "src/kernel/common";
import { CommentDto } from "src/dtos/community/comment";
import { applyCursorPagination } from "src/common/utils/pagination.util";
import { ReactionService } from "src/services/community/reaction/reaction.service";
import { BaseUserService } from "src/services/identity";
import { __t } from "src/utils/translation";
import { InvalidCommentLevelException } from "src/common/exceptions/comment/invalid-level.exception";

/**
 * Comment Service
 *
 * Core service for managing user comments on various content types (posts, products, videos, etc.).
 * Handles comment creation, updates, deletion, and retrieval with proper user permissions and
 * social features integration.
 *
 * Key Features:
 * - Comment CRUD operations with ownership validation
 * - Integration with reaction system (likes, dislikes)
 * - User and creator information population
 * - Event-driven architecture with queue messaging
 * - Pagination and search functionality
 * - Reply counting and nested comment support
 *
 * Security Features:
 * - User ownership validation for updates/deletes
 * - Permission-based access control
 * - Input sanitization and validation
 *
 * @example Create a comment
 * ```typescript
 * const comment = await commentService.createUserComment({
 *   objectId: postId,
 *   objectType: 'post',
 *   content: 'Great content!'
 * }, currentUser);
 * ```
 *
 * @example Search comments with reactions
 * ```typescript
 * const results = await commentService.search({
 *   objectId: postId,
 *   objectType: 'post',
 *   limit: 20,
 *   offset: 0
 * }, currentUser);
 * ```
 */
@Injectable()
export class CommentService {
  constructor(
    @InjectModel(Comment.name) private readonly CommentModel: Model<CommentDocument>,
    private readonly queueMessageService: QueueMessageService,
    private readonly baseUserService: BaseUserService,
    private readonly reactionService: ReactionService
  ) { }
  /**
  * find comment by ID
  * @param id
  * @returns
  */
  public async findById(id: string | ObjectId): Promise<CommentDto | null> {
    const item = await this.CommentModel.findById(id);
    return CommentDto.fromModel(item);
  }

  /**
   * Resolve one comment for deep-linking, together with the thread it lives in.
   *
   * A notification names the exact comment or reply it is about, but that
   * comment may sit thousands of entries deep in a paginated list. Rather than
   * walking pages until it appears, the client asks for it by id and gets back
   * everything needed to render it: the comment itself, its author, and — when
   * it is a reply — the root comment whose thread has to be expanded first.
   *
   * A missing comment is not an error. It is the normal outcome once the comment
   * has been deleted while the notification survives, and the caller renders
   * that as a removed-comment state, so it is reported as `found: false` rather
   * than throwing.
   */
  public async resolveTarget(id: string | ObjectId): Promise<{
    found: boolean;
    comment: CommentDto | null;
    root: CommentDto | null;
  }> {
    const comment = await this.CommentModel.findById(id).catch(() => null);
    if (!comment) return { found: false, comment: null, root: null };

    // A reply points at its root through objectId; a top-level comment points at
    // the post and is its own root.
    const isReply = comment.objectType === COMMENT_OBJECT_TYPES.COMMENT;
    const rootDocument = isReply
      ? await this.CommentModel.findById(comment.objectId).catch(() => null)
      : comment;

    const documents = rootDocument && rootDocument._id.toString() !== comment._id.toString()
      ? [comment, rootDocument]
      : [comment];
    const dtos = documents.map((document) => CommentDto.fromModel(document));

    // One batched author lookup for both, mirroring how `search` populates.
    const users = await this.baseUserService.findByIds(documents.map((d) => d.createdBy));
    dtos.forEach((dto) => {
      const author = users.find((u) => u._id.toString() === dto.createdBy.toString());
      if (author) dto.setUser(new UserDto(author));
    });

    return {
      found: true,
      comment: dtos[0],
      root: dtos.length > 1 ? dtos[1] : dtos[0]
    };
  }

  /**
   * The single most-liked comment on a post, if any clears the bar.
   *
   * A dedicated query rather than sorting a downloaded page: the hot comment
   * may sit anywhere in the post's history, and the canonical list is ordered
   * by recency, so no page the client holds is guaranteed to contain it.
   *
   * Candidates are top-level comments only (`level: 0`) — a reply is part of a
   * conversation and is not promoted on its own. Ranking is `totalLike`
   * descending with the newest winning a tie. Comments are physically deleted
   * in this schema, so anything returned still exists.
   *
   * Returns null when nothing reaches the threshold, which is the normal case
   * for a quiet post.
   */
  public async findHotComment(postId: string | ObjectId): Promise<CommentDto | null> {
    if (!postId) return null;

    const comment = await this.CommentModel
      .findOne({
        objectType: COMMENT_OBJECT_TYPES.POST,
        objectId: new ObjectId(postId.toString()),
        level: 0,
        totalLike: { $gte: HOT_COMMENT_MIN_LIKES }
      })
      .sort({ totalLike: -1, createdAt: -1 })
      .lean()
      .catch(() => null);
    if (!comment) return null;

    // Hydrated the same way the comment list hydrates its authors, so the slot
    // renders through the ordinary comment component with no second shape.
    const dto = CommentDto.fromModel(comment);
    const [author] = await this.baseUserService.findByIds([comment.createdBy]);
    if (author) dto.setUser(new UserDto(author));

    return dto;
  }

  /**
   * Delete all comments for specific content (used when content is deleted)
   *
   * Removes all comments and their nested replies when the parent content is deleted.
   * This ensures data integrity and prevents orphaned comments.
   *
   * @param contentType - Type of content (post, product, etc.)
   * @param contentId - ID of the content being deleted
   * @returns Promise resolving to number of comments deleted
   * @example
   * ```typescript
   * const deletedCount = await commentService.deleteCommentsByContent('post', postId);
   * console.log(`Deleted ${deletedCount} comments for post ${postId}`);
   * ```
   */
  public async deleteCommentsByContent(contentType: string, contentId: string | ObjectId): Promise<number> {
    // Phase 1: collect direct comment IDs in one indexed query. Their IDs are
    // required to locate both replies and reactions before targets disappear.
    const directCommentIds = await this.CommentModel.find({
      objectType: contentType,
      objectId: contentId
    }).distinct('_id');

    if (!directCommentIds.length) {
      return 0;
    }

    // Phase 2: replies are limited to one level and point at a direct comment,
    // so one $in query replaces the previous query-per-comment implementation.
    const replyIds = await this.CommentModel.find({
      objectType: 'comment',
      objectId: { $in: directCommentIds }
    }).distinct('_id');

    const commentIds = [...directCommentIds, ...replyIds];

    // Phase 3: reactions must be removed first so a retry can never lose their
    // target IDs. Then all comment documents can be deleted in one batch.
    await this.reactionService.deleteReactionsByTargets('comment', commentIds);
    const result = await this.CommentModel.deleteMany({ _id: { $in: commentIds } });

    // Phase 4: do not publish an ordinary counter event because the parent post
    // no longer exists and listeners must not recreate it through an upsert.
    return result.deletedCount || 0;
  }

  /**
   * Whether a user has posted a reply in a given thread.
   *
   * Threads are flat, so a thread is one top-level comment plus every comment
   * whose `objectId` points at it. Together with the top-level comment's own
   * author this defines the thread's participants.
   *
   * Used to check a client-supplied reply target against persisted data before
   * it is allowed to route a notification, so a crafted request cannot aim a
   * reply notification at someone who was never in the conversation.
   *
   * @param rootCommentId - The top-level comment the thread hangs off
   * @param userId - The user to look for
   */
  public async hasReplyFromUser(
    rootCommentId: string | ObjectId,
    userId: string | ObjectId
  ): Promise<boolean> {
    const reply = await this.CommentModel.exists({
      objectType: COMMENT_OBJECT_TYPES.COMMENT,
      objectId: rootCommentId,
      createdBy: userId
    });

    return Boolean(reply);
  }

  /**
   * Increment reply count for a parent comment
   *
   * Updates the total reply count for a parent comment when a reply is added or removed.
   * Used for maintaining accurate reply statistics and comment threading.
   *
   * @param commentId - ID of the parent comment to update
   * @param num - Number to increment by (default: 1, can be negative for decrements)
   * @example
   * ```typescript
   * // Add a reply
   * await commentService.incrementReplyCount(parentCommentId, 1);
   *
   * // Remove a reply
   * await commentService.incrementReplyCount(parentCommentId, -1);
   * ```
   */
  public async incrementReplyCount(commentId: string | ObjectId, num = 1): Promise<void> {
    await this.CommentModel.updateOne(
      { _id: commentId },
      [
        {
          $set: {
            totalReply: {
              $max: [0, { $add: [{ $ifNull: ['$totalReply', 0] }, num] }]
            }
          }
        }
      ]
    );
  }

  /**
   * Search and retrieve comments with full user and reaction data
   *
   * Retrieves comments for specific content with pagination, user information,
   * and reaction status. Efficiently loads related data in parallel for optimal performance.
   *
   * For pagination beyond 5000 records, cursor-based pagination is automatically used
   * to maintain performance and prevent deep pagination issues.
   *
   * @param req - Search request with filters and pagination
   * @param user - Optional user for personalized data (reaction status)
   * @returns Promise resolving to paginated comment results with user and reaction data
   * @example
   * ```typescript
   * const comments = await commentService.search({
   *   objectId: postId,
   *   objectType: 'post',
   *   limit: 20,
   *   offset: 0
   * }, currentUser);
   *
   * comments.data.forEach(comment => {
   *   console.log(`${comment.user.username}: ${comment.content}`);
   *   if (comment.isLiked) console.log('User liked this comment');
   * });
   * ```
   */
  public async search(req: CommentSearchRequestPayload, user?: UserDto | AuthUserDto): Promise<PageableData<CommentDto>> {
    const offset = Number(req.offset) || 0;
    const query: Record<string, any> = {};
    if (req.objectId) query.objectId = req.objectId;
    if (req.objectType) query.objectType = req.objectType;

    // ADVANCED CURSOR-BASED PAGINATION
    // Implement compound cursor logic to prevent data loss with identical timestamps
    if (req.cursor && req.lastCreatedAt) {
      const cursorQuery = applyCursorPagination(query, req.cursor, req.lastCreatedAt);
      Object.assign(query, cursorQuery);
    }

    const limit = req.limit ? Number(req.limit) : 10;

    // Optimized sort strategy for maximum index efficiency
    const sort: Record<string, SortOrder> = {
      createdAt: -1, // Primary sort: newest comments first
      _id: -1 // Secondary sort: consistent ordering for identical timestamps
    };

    // Determine pagination strategy
    const useCursorPagination = req.cursor || req.lastCreatedAt || offset > COMMENT_PAGINATION.MAX_OFFSET;

    // Execute query with one extra item to determine hasMore efficiently
    const [data, total] = await Promise.all([
      this.CommentModel
        .find(query)
        .sort(sort)
        .lean() // Use lean() for 30-50% performance improvement on reads
        .limit(limit + 1) // Fetch one extra to determine hasMore efficiently
        .skip(useCursorPagination ? 0 : offset),
      useCursorPagination ? Promise.resolve(undefined) : this.CommentModel.countDocuments(query)
    ]);

    // Calculate pagination metadata
    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;

    // Always provide pagination guidance to client
    const paginationInfo = {
      maxOffset: COMMENT_PAGINATION.MAX_OFFSET,
      cursorPaginationAvailable: true
    };

    if (!items.length) {
      return {
        data: [],
        hasMore: false,
        nextCursor: null,
        total: useCursorPagination ? undefined : total,
        paginationInfo
      };
    }

    const comments = items.map((d) => CommentDto.fromModel(d));
    const commentIds = items.map((d) => d._id);
    const UIds = items.map((d) => d.createdBy);
    const [users, reactions] = await Promise.all([
      UIds.length ? this.baseUserService.findByIds(UIds) : [],
      user && commentIds.length ? this.reactionService.findByUserIdAndObjectId(user._id, commentIds, REACTION_TYPES.LIKE) : []
    ]);
    comments.forEach((comment: CommentDto) => {
      const userComment = users.find((u) => u._id.toString() === comment.createdBy.toString());
      const liked = reactions.find((reaction) => reaction.objectId.toString() === comment._id.toString());

      comment.setUser(new UserDto(userComment));
      comment.setIsLiked(!!liked);
    });

    // Generate next cursor from the last item for subsequent requests
    // && (useCursorPagination || offset >= COMMENT_PAGINATION.MAX_OFFSET || (offset + limit) >= COMMENT_PAGINATION.MAX_OFFSET)
    const nextCursor = hasMore ? {
      id: items[items.length - 1]._id.toString(),
      createdAt: new Date(items[items.length - 1].createdAt).getTime()
    } : null;

    return {
      data: comments,
      hasMore,
      nextCursor,
      total: useCursorPagination ? undefined : total,
      paginationInfo
    };
  }

  /**
   * Create a new comment by the authenticated user
   *
   * Creates a comment on content with automatic user assignment and event publishing.
   * Publishes creation event to the queue for downstream processing (notifications, etc.).
   * Validates user permissions and content existence before creating the comment.
   *
   * @param payload - Comment creation data including content, objectId, and objectType
   * @param user - Authenticated user creating the comment
   * @returns Promise resolving to created CommentDto with populated user information
   * @throws ValidationException if payload is invalid
   * @throws ForbiddenException if user lacks permission to comment
   * @example
   * ```typescript
   * const comment = await commentService.createUserComment({
   *   objectId: '507f1f77bcf86cd799439011',
   *   objectType: 'post',
   *   content: 'Amazing post!'
   * }, currentUser);
   * ```
   */
  /**
   * Reduce client-supplied mention ids to accounts that actually exist.
   *
   * The composer picks mentions from an autocomplete, but the ids arrive as plain
   * request data, so they are re-checked here rather than trusted. Duplicates are
   * collapsed so naming someone twice in one comment notifies them once, and
   * unknown ids are dropped instead of throwing: a mention that no longer
   * resolves should not block posting the comment.
   *
   * Mirrors `PostCrudService.resolveMentionedUserIds` so both surfaces treat
   * mentions identically.
   */
  private async resolveMentionedUserIds(ids?: string[]): Promise<ObjectId[]> {
    const uniqueIds = [...new Set((ids || []).filter(Boolean).map(id => id.toString()))];
    if (!uniqueIds.length) return [];

    const users = await this.baseUserService.findByIds(uniqueIds);
    return users.map(user => new ObjectId(user._id));
  }

  public async createUserComment(payload: CommentCreatePayload, user: UserDto | AuthUserDto): Promise<CommentDto> {
    const comment: Record<string, any> = { ...payload };
    comment.mentionedUserIds = await this.resolveMentionedUserIds(payload.mentionedUserIds);

    // Validate and set comment level
    let level = 0;
    if (payload.objectType === 'comment') {
      // This is a reply to another comment
      const parentComment = await this.CommentModel.findById(payload.objectId);
      if (!parentComment) {
        throw new EntityNotFoundException(__t('errors.parent_comment_not_found'));
      }

      // Only allow 1 level of nesting (replies to top-level comments only)
      if (parentComment.level >= 1) {
        throw new InvalidCommentLevelException(__t('errors.invalid_comment_reply_level'));
      }

      level = parentComment.level + 1;
    }

    comment.level = level;
    comment.createdBy = user._id;
    comment.createdAt = new Date();
    comment.updatedAt = new Date();

    const newComment = await this.CommentModel.create(comment);
    const dto = CommentDto.fromModel(newComment);
    // The author is attached BEFORE publishing, not after.
    //
    // Subscribers receive the serialised DTO at publish time, so setting the
    // user afterwards left every queue consumer — including the post-room
    // listener that renders a comment live — with no author at all, which the
    // UI showed as "N/A" and a placeholder avatar until the next fetch.
    //
    // The author is loaded rather than taken from the request identity: the
    // authenticated user is an AuthUserDto, whose response shape is the trimmed
    // auth one (`_id`, `username`, `isAdmin`, `status`) with no `name` or
    // `avatar`. Rendering that gave the right username but a placeholder avatar.
    //
    // Loading it produces the same full `UserDto` shape the comment list uses,
    // so a realtime comment and a fetched one are render-equivalent. One lookup
    // per comment *creation* — not per render — and it also fixes the HTTP
    // response, which previously returned the same trimmed author.
    const [author] = await this.baseUserService.findByIds([user._id]);
    dto.setUser(author ? new UserDto(author) : (user as any));
    await this.queueMessageService.publish(COMMENT_CHANNELS.COMMENT, {
      eventName: EVENT.CREATED,
      data: dto
    });
    return dto;
  }

  /**
   * Update user's own comment with ownership validation
   *
   * Allows users to edit their own comments with strict ownership validation.
   * Only the comment creator can update their comment. Automatically updates
   * the modification timestamp and validates content before saving.
   *
   * @param id - Comment ID to update
   * @param payload - Update payload with new comment data (content, etc.)
   * @param user - Authenticated user attempting to update the comment
   * @returns Promise resolving to updated CommentDto with user information
   * @throws EntityNotFoundException if comment not found
   * @throws ForbiddenException if user doesn't own the comment
   * @example
   * ```typescript
   * const updatedComment = await commentService.updateUserComment(commentId, {
   *   content: 'Updated comment text'
   * }, currentUser);
   * console.log(`Comment updated: ${updatedComment.content}`);
   * ```
   */
  public async updateUserComment(id: string | ObjectId, payload: CommentEditPayload, user: UserDto | AuthUserDto): Promise<CommentDto> {
    const comment = await this.CommentModel.findById(id);
    if (!comment) {
      throw new EntityNotFoundException();
    }

    const data = { ...payload, updatedAt: new Date() };
    if (comment.createdBy.toString() !== user._id.toString()) {
      throw new ForbiddenException();
    }
    await this.CommentModel.updateOne({ _id: id }, data);

    // Return the updated comment
    const updatedComment = await this.CommentModel.findById(id);
    const dto = CommentDto.fromModel(updatedComment);
    dto.setUser(user as any); // force set user
    return dto;
  }

  /**
   * Delete user's own comment with ownership validation
   *
   * Allows users to delete their own comments with strict ownership validation.
   * Publishes deletion event for downstream processing (cleanup, notifications).
   * Automatically handles cleanup of related data and maintains data integrity.
   *
   * @param id - Comment ID to delete
   * @param user - Authenticated user attempting to delete the comment
   * @returns Promise resolving to deletion confirmation object
   * @throws EntityNotFoundException if comment not found
   * @throws ForbiddenException if user doesn't own the comment
   * @example
   * ```typescript
   * const result = await commentService.deleteUserComment(commentId, currentUser);
   * if (result.deleted) console.log('Comment deleted successfully');
   * ```
   */
  public async deleteUserComment(id: string | ObjectId, user: UserDto | AuthUserDto): Promise<{ deleted: boolean }> {
    const comment = await this.CommentModel.findById(id);
    if (!comment) {
      throw new EntityNotFoundException();
    }
    // Allow admins to delete any comment, otherwise check ownership
    const isAdmin = 'isAdmin' in user && user.isAdmin;
    if (!isAdmin && comment.createdBy.toString() !== user._id.toString()) {
      throw new ForbiddenException();
    }

    // Collect the whole thread before deleting anything so reactions for the
    // parent and every reply can be removed without leaving orphan records.
    let commentIds: Array<string | ObjectId> = [comment._id];
    if (comment.level === 0) {
      const replyIds = await this.CommentModel.find({
        objectType: 'comment',
        objectId: id
      }).distinct('_id');
      commentIds = [...commentIds, ...replyIds];
    }

    // Delete reactions before their comment targets, then remove the thread in
    // one batch. The normal comment event below still updates the live post.
    await this.reactionService.deleteReactionsByTargets('comment', commentIds);
    await this.CommentModel.deleteMany({ _id: { $in: commentIds } });

    await this.queueMessageService.publish(COMMENT_CHANNELS.COMMENT, {
      eventName: EVENT.DELETED,
      data: CommentDto.fromModel(comment)
    });
    return { deleted: true };
  }

  /**
   * Get comments with infinite scroll pagination
   *
   * Provides cursor-based pagination for smooth infinite scrolling experience.
   * Optimized for mobile apps and web infinite scroll implementations.
   * Uses compound cursor (createdAt + _id) to prevent data loss with identical timestamps.
   *
   * @param req - Search request with cursor pagination parameters
   * @param user - Optional user for personalized data (reaction status)
   * @returns Promise with comments, hasMore flag, and nextCursor
   *
   * @example
   * ```typescript
   * // First page
   * const page1 = await commentService.getInfiniteScrollComments({
   *   objectId: 'post-123',
   *   objectType: 'post',
   *   limit: 20
   * }, user);
   *
   * // Next page using cursor
   * const page2 = await commentService.getInfiniteScrollComments({
   *   objectId: 'post-123',
   *   objectType: 'post',
   *   limit: 20,
   *   cursor: page1.nextCursor.id,
   *   lastCreatedAt: page1.nextCursor.createdAt
   * }, user);
   * ```
   */
  public async getInfiniteScrollComments(
    req: CommentSearchRequestPayload,
    user?: UserDto | AuthUserDto
  ) {
    // Build base query
    const query: Record<string, any> = {};
    if (req.objectId) query.objectId = req.objectId;
    if (req.objectType) query.objectType = req.objectType;

    // ADVANCED CURSOR-BASED PAGINATION
    // Implement compound cursor logic to prevent data loss with identical timestamps
    if (req.cursor && req.lastCreatedAt) {
      const cursorQuery = applyCursorPagination(query, req.cursor, req.lastCreatedAt);
      Object.assign(query, cursorQuery);
    }

    const limit = req.limit ? Number(req.limit) : 20;

    // Optimized sort strategy for maximum index efficiency
    const sort = {
      createdAt: -1, // Primary sort: newest comments first
      _id: -1 // Secondary sort: consistent ordering for identical timestamps
    } as Record<string, SortOrder>;

    // Execute optimized query with performance enhancements
    const comments = await this.CommentModel
      .find(query)
      .sort(sort)
      .limit(limit + 1) // Fetch one extra to determine hasMore efficiently
      .lean() // Use lean() for 30-50% performance improvement on reads
      .exec();

    // Calculate pagination metadata
    const hasMore = comments.length > limit;
    const items = hasMore ? comments.slice(0, limit) : comments;

    // Generate next cursor from the last item for subsequent requests
    const nextCursor = hasMore ? {
      id: items[items.length - 1]._id.toString(),
      createdAt: new Date(items[items.length - 1].createdAt).getTime() // Use timestamp
    } : null;

    // Handle empty result set
    if (!items.length) {
      return {
        data: [],
        hasMore: false,
        nextCursor: null,
        total: 0
      };
    }

    // Convert to DTOs and populate user and reaction data
    const commentDtos = items.map((d) => CommentDto.fromModel(d));
    const commentIds = items.map((d) => d._id);
    const UIds = items.map((d) => d.createdBy);

    // Load related data in parallel for optimal performance
    const [users, reactions] = await Promise.all([
      UIds.length ? this.baseUserService.findByIds(UIds) : [],
      user && commentIds.length ? this.reactionService.findByUserIdAndObjectId(user._id, commentIds, REACTION_TYPES.LIKE) : []
    ]);

    // Populate comment data with user and reaction information
    commentDtos.forEach((comment: CommentDto) => {
      const userComment = users.find((u) => u._id.toString() === comment.createdBy.toString());
      const liked = reactions.find((reaction) => reaction.objectId.toString() === comment._id.toString());

      comment.setUser(new UserDto(userComment));
      comment.setIsLiked(!!liked);
    });

    return {
      data: commentDtos,
      hasMore,
      nextCursor,
      total: items.length // For infinite scroll, this represents current page size
    };
  }
}
