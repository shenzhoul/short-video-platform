import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ObjectId } from 'mongodb';
import { Model, SortOrder } from "mongoose";
import { PAGINATION_DEFAULTS, REACTION_CHANNELS, REACTION_TARGET_TYPES } from "src/common/constants";
import { applyCursorPagination } from "src/common/utils/pagination.util";
import { ReactionDto } from "src/dtos/community/reaction";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { UserDto } from "src/dtos/identity/user";
import { QueueMessageService } from "src/kernel";
import { EVENT } from "src/kernel/constants";
import { ReactionCreatePayload, ReactionSearchRequestPayload } from "src/payloads";
import { Reaction, ReactionDocument } from "src/schemas";

/**
 * Reaction Service
 *
 * Core service for managing user reactions (likes, dislikes, hearts, etc.) on various content types.
 * Handles reaction creation, removal, and retrieval with proper user information and event publishing.
 *
 * Key Features:
 * - Multiple reaction types (like, dislike, heart, etc.)
 * - Duplicate reaction prevention
 * - Event-driven architecture with queue messaging
 * - User and creator information population
 * - Efficient batch queries for multiple objects
 * - Reaction existence checking
 *
 * Supported Content Types:
 * - Posts and posts
 * - Videos and products
 * - Comments and messages
 * - User profiles and galleries
 *
 * @example Add a like reaction
 * ```typescript
 * const reaction = await reactionService.create({
 *   objectId: postId,
 *   objectType: 'post',
 *   action: 'like'
 * }, currentUser);
 * ```
 *
 * @example Remove a reaction
 * ```typescript
 * const removed = await reactionService.remove({
 *   objectId: postId,
 *   objectType: 'post',
 *   action: 'like'
 * }, currentUser);
 * ```
 */
@Injectable()
export class ReactionService {
  constructor(
    @InjectModel(Reaction.name) private readonly ReactionModel: Model<ReactionDocument>,
    private readonly queueMessageService: QueueMessageService,
  ) { }
  /**
     * Find user's reactions for specific objects
     *
     * Retrieves all reactions by a user for one or more objects. Optimized for
     * checking reaction status across multiple content items efficiently.
     *
     * @param userId - ID of the user whose reactions to find
     * @param objectId - Single object ID or array of object IDs
     * @returns Promise resolving to array of user's reactions
     * @example
     * ```typescript
     * // Check user's reactions on multiple posts
     * const reactions = await reactionService.findByUserIdAndObjectId(
     *   userId,
     *   [postId1, postId2, postId3]
     * );
     * reactions.forEach(reaction => {
     *   console.log(`User ${reaction.action}d ${reaction.objectId}`);
     * });
     * ```
     */
  public async findByUserIdAndObjectId(
    userId: string | ObjectId,
    objectId: string | ObjectId | Array<string | ObjectId>,
    action?: string
  ): Promise<ReactionDto[]> {
    const query: Record<string, any> = {
      createdBy: userId,
      objectId: {
        $in: Array.isArray(objectId) ? objectId : [objectId]
      }
    };
    // One object can hold several reaction actions from the same user (a post
    // can be both liked and shared), so callers deriving a single flag such as
    // "is liked" must narrow by action rather than assume one row per object.
    if (action) query.action = action;

    const items = await this.ReactionModel.find(query)
      .lean(); // lean for better performance on read
    return items.map((item) => ReactionDto.fromModel(item));
  }

  /** Search reactions in stable newest-first order for user collections. */
  public async search(req: ReactionSearchRequestPayload) {
    let query: Record<string, any> = {};
    if (req.objectId) query.objectId = req.objectId;
    if (req.objectType) query.objectType = req.objectType;
    if (req.action) query.action = req.action;
    if (req.createdBy) query.createdBy = req.createdBy;

    if (req.cursor && req.lastCreatedAt) {
      query = applyCursorPagination(query, req.cursor, req.lastCreatedAt);
    }

    const limit = Number(req.limit) || PAGINATION_DEFAULTS.DEFAULT_LIMIT;
    const offset = Number(req.offset) || 0;
    const useCursorPagination = Boolean(req.cursor && req.lastCreatedAt);
    const sort: Record<string, SortOrder> = { createdAt: -1, _id: -1 };
    const [data, total] = await Promise.all([
      this.ReactionModel.find(query)
        .sort(sort)
        .lean()
        .limit(limit + 1)
        .skip(useCursorPagination ? 0 : offset),
      useCursorPagination ? Promise.resolve(undefined) : this.ReactionModel.countDocuments(query)
    ]);

    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;
    const lastItem = items[items.length - 1];

    return {
      data: items.map((item) => ReactionDto.fromModel(item)),
      total,
      hasMore,
      nextCursor: hasMore && lastItem ? {
        id: lastItem._id.toString(),
        createdAt: new Date(lastItem.createdAt).getTime()
      } : null,
      paginationInfo: {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      }
    };
  }

  /** Idempotently remove like reactions from several posts. */
  public async removeManyPostLikes(
    postIds: Array<string | ObjectId>,
    user: UserDto | AuthUserDto
  ): Promise<string[]> {
    if (!postIds.length) return [];

    const filter = {
      objectType: REACTION_TARGET_TYPES.POST,
      objectId: { $in: postIds },
      createdBy: user._id,
      action: 'like'
    };
    const reactions = await this.ReactionModel.find(filter).lean();
    if (reactions.length) {
      await this.ReactionModel.deleteMany({
        _id: { $in: reactions.map((reaction) => reaction._id) }
      });
      await Promise.all(reactions.map((reaction) => this.queueMessageService.publish(
        REACTION_CHANNELS.REACTION,
        { eventName: EVENT.DELETED, data: ReactionDto.fromModel(reaction) }
      )));
    }

    // Return every requested post because the end state is now "not liked",
    // including when a stale client selected an already-unliked post.
    return [...new Set(postIds.map((postId) => postId.toString()))];
  }

  /**
   * Delete all reactions for content that is itself being removed.
   *
   * Bulk cleanup intentionally does not publish per-reaction events. The owning
   * deletion workflow reconciles aggregate counters from the remaining source
   * data, which keeps retries idempotent.
   */
  public async deleteReactionsByContent(contentType: string, contentId: string | ObjectId): Promise<number> {
    return this.deleteReactionsByTargets(contentType, [contentId]);
  }

  /**
   * Delete reactions for several targets in one query.
   */
  public async deleteReactionsByTargets(
    contentType: string,
    contentIds: Array<string | ObjectId>
  ): Promise<number> {
    // Avoid sending an empty $in query and make no-target cleanup a cheap no-op.
    if (!contentIds.length) {
      return 0;
    }

    // Bulk deletion intentionally emits no individual reaction events. The
    // owning cleanup workflow replaces aggregate counters after this finishes.
    const result = await this.ReactionModel.deleteMany({
      objectType: contentType,
      objectId: { $in: contentIds }
    });

    return result.deletedCount || 0;
  }

  /**
   * Create a new reaction or return existing one
   *
   * Creates a reaction on content with duplicate prevention. If the user has already
   * reacted with the same action on the same object, returns the existing reaction.
   * Publishes creation event for downstream processing.
   *
   * @param data - Reaction creation payload
   * @param user - User creating the reaction
   * @returns Promise resolving to created or existing ReactionDto
   * @example
   * ```typescript
   * const reaction = await reactionService.create({
   *   objectId: '507f1f77bcf86cd799439011',
   *   objectType: 'post',
   *   action: 'like'
   * }, currentUser);
   * console.log(`Reaction ${reaction.action} created`);
   * ```
   */
  public async create(
    data: ReactionCreatePayload,
    user: UserDto | AuthUserDto
  ): Promise<{ reaction: ReactionDto; created: boolean }> {
    const reaction: Record<string, any> = { ...data };
    const filter = {
      objectType: reaction.objectType,
      objectId: reaction.objectId,
      createdBy: user._id,
      action: reaction.action
    };
    const existReact = await this.ReactionModel.findOne(filter);
    if (existReact) {
      // Already reacted. `created: false` is what lets callers distinguish a
      // repeat from a first reaction without re-deriving the rule themselves —
      // counters and notifications both depend on that difference.
      return { reaction: ReactionDto.fromModel(existReact), created: false };
    }
    reaction.createdBy = user._id;
    reaction.createdAt = new Date();
    reaction.updatedAt = new Date();
    const newReaction = await this.ReactionModel.create(reaction);

    const dto = ReactionDto.fromModel(newReaction);
    if (dto) {
      // Set user info on the DTO
      (dto as any).user = user;
      await this.queueMessageService.publish(REACTION_CHANNELS.REACTION, {
        eventName: EVENT.CREATED,
        data: dto
      });
    }
    return { reaction: dto, created: true };
  }

  /**
   * Remove user's reaction from content
   *
   * Removes a specific reaction by the user from content. Publishes deletion event
   * for downstream processing (statistics updates, notifications, etc.).
   *
   * @param payload - Reaction removal payload
   * @param user - User removing the reaction
   * @returns Promise resolving to true if removed, false if not found
   * @example
   * ```typescript
   * const removed = await reactionService.remove({
   *   objectId: postId,
   *   objectType: 'post',
   *   action: 'like'
   * }, currentUser);
   * if (removed) console.log('Reaction removed successfully');
   * ```
   */
  public async remove(payload: ReactionCreatePayload, user: UserDto | AuthUserDto): Promise<boolean> {
    const filter = {
      objectType: payload.objectType || REACTION_TARGET_TYPES.POST,
      objectId: payload.objectId,
      createdBy: user._id,
      action: payload.action
    };
    const reaction = await this.ReactionModel.findOne(filter);
    if (!reaction) return false;
    await reaction.deleteOne();

    await this.queueMessageService.publish(REACTION_CHANNELS.REACTION, {
      eventName: EVENT.DELETED,
      data: ReactionDto.fromModel(reaction)
    });
    return true;
  }
}
