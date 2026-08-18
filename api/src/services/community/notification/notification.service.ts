import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model, SortOrder } from 'mongoose';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_FILTER_TYPE_MAP,
  NOTIFICATION_TYPES,
  PAGINATION_DEFAULTS
} from 'src/common/constants';
import { applyCursorPagination } from 'src/common/utils/pagination.util';
import { NotificationDto } from 'src/dtos/community/notification';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { QueueMessageService } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import { EVENT } from 'src/kernel/constants';
import { NotificationSearchRequestPayload } from 'src/payloads';
import {
  Comment, CommentDocument, Notification, NotificationDocument, Post, PostDocument
} from 'src/schemas';
import { BaseUserService } from 'src/services/identity';
import { FollowService } from '../follow';

/** Fields every notification write shares. */
export interface NotificationIdentity {
  recipientId: string | ObjectId;
  actorId: string | ObjectId;
  type: string;
  /** Group identity, built with NOTIFICATION_GROUP_KEYS. */
  groupKey: string;
  postId?: string | ObjectId | null;
  commentId?: string | ObjectId | null;
  /** Resource the adaptive types count against. */
  aggregateResourceId?: string | ObjectId | null;
}

/** An aggregate write additionally names the event being folded in. */
export interface AggregateNotificationOptions extends NotificationIdentity {
  /** Reaction id for likes, comment id for comments and replies. */
  eventId?: string | ObjectId | null;
  /** Adaptive types count events; like aggregates derive their count instead. */
  countsActivity?: boolean;
}

/**
 * Post fields needed to render a notification thumbnail.
 *
 * Only the cover URLs are persisted on the post document. They already absorb
 * the post thumbnail when covers are written (`PostDto.setCovers` falls back to
 * `thumbnailUrl`), so reading them alone avoids resolving files here.
 */
interface PostThumbnailProjection {
  _id: ObjectId;
  cover3x4Url?: string;
  cover4x3Url?: string;
  /** Distinct likers of the post, the source of truth for a like aggregate's count. */
  totalLike?: number;
}

/** Comment fields a notification row needs: its count and its preview text. */
interface CommentLikeProjection {
  _id: ObjectId;
  totalLike?: number;
  content?: string;
}

/**
 * The comment a notification row is *about*.
 *
 * An individual row means its own `commentId`. An adaptive aggregate means its
 * newest folded-in event, because `commentId` is insert-only and stays pinned
 * to the comment that opened the group — so previewing it would quote the
 * comment the headline has already moved past. The like aggregates also carry
 * `lastEventId`, but there it is a reaction id, which is why the type is
 * checked rather than `isAggregate` alone.
 *
 * Deliberately the same rule the client uses to choose a navigation target, so
 * the quoted comment and the one that opens are never different comments.
 */
function referenceCommentId(row: Record<string, any>): ObjectId | null {
  const isAdaptiveComment = row.type === NOTIFICATION_TYPES.POST_COMMENT
    || row.type === NOTIFICATION_TYPES.COMMENT_REPLY;
  if (row.isAggregate && isAdaptiveComment && row.lastEventId) return row.lastEventId;
  return row.commentId || null;
}

/**
 * Notification Service
 *
 * Owns creation, retrieval and read state for interaction notifications.
 *
 * Creation is always backend-driven: domain listeners call `create` after the
 * underlying interaction has been committed, so a notification can never exist
 * for an action that did not happen, and clients cannot forge one.
 *
 * Rows store references only. Actor identity and post thumbnails are resolved on
 * read with one batched query each, which keeps stored data correct when a user
 * renames themselves or a creator changes a post cover.
 */
@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification.name) private readonly NotificationModel: Model<NotificationDocument>,
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    @InjectModel(Comment.name) private readonly CommentModel: Model<CommentDocument>,
    private readonly baseUserService: BaseUserService,
    private readonly followService: FollowService,
    private readonly queueMessageService: QueueMessageService
  ) { }

  /**
   * Create a notification once, and never disturb it again.
   *
   * For events that happened exactly once on exactly one resource: a mention, or
   * an individual comment/reply. An existing row is returned untouched — read
   * state is not reset, `lastActivityAt` does not move, and nothing is
   * re-delivered. That makes a redelivered queue job a true no-op, which is the
   * behaviour a one-off event needs and the opposite of what an aggregate or a
   * follow wants.
   */
  public async createOnce(options: NotificationIdentity): Promise<NotificationDto | null> {
    if (!this.hasDistinctParticipants(options)) return null;

    const now = new Date();
    const identity = this.buildIdentity(options, now);

    const existing = await this.NotificationModel.findOne({
      recipientId: options.recipientId,
      groupKey: options.groupKey
    });
    // Already recorded. Returning null rather than the row keeps callers from
    // re-delivering a notification the recipient has possibly already read.
    if (existing) return null;

    try {
      const created = await this.NotificationModel.create(identity);
      return this.publish(created);
    } catch (error: any) {
      // Lost a race against a concurrent identical event; the other writer has
      // already produced and delivered it.
      if (error?.code === 11000) return null;
      throw error;
    }
  }

  /**
   * Fold an event into a notification group, creating it if needed.
   *
   * Used by the like aggregates and by the adaptive comment/reply aggregates.
   * The row carries the latest actor, returns to unread and moves to the top, so
   * genuinely new activity resurfaces the group.
   *
   * The update is a single atomic upsert whose filter excludes the event already
   * folded in, so it cannot be applied twice. Under concurrency the unique group
   * index guarantees one row: simultaneous first events race to insert, the
   * loser retries and increments instead, and a redelivery settles as a no-op.
   */
  public async aggregate(options: AggregateNotificationOptions): Promise<NotificationDto | null> {
    if (!this.hasDistinctParticipants(options)) return null;

    const applied = await this.applyAggregate(options);
    // A no-op means the event had already been folded in, so re-delivering would
    // resurface a group the recipient may have read.
    if (!applied) return null;

    return this.publish(applied);
  }

  /**
   * Reuse a notification for a repeatable relationship, subject to a cooldown.
   *
   * Following can be toggled freely, so the row is reused rather than duplicated,
   * and it only resurfaces once the cooldown since its last activity has passed.
   * The relationship itself is never affected — only whether the recipient is
   * told about it again.
   */
  public async resurface(
    options: NotificationIdentity,
    cooldownMs: number
  ): Promise<NotificationDto | null> {
    if (!this.hasDistinctParticipants(options)) return null;

    const now = new Date();
    const identity = this.buildIdentity(options, now);
    const cooldownStart = new Date(now.getTime() - cooldownMs);

    // Only matches when the row is absent or has been quiet for the cooldown, so
    // rapid follow/unfollow cycling cannot re-notify.
    const notification = await this.NotificationModel.findOneAndUpdate(
      {
        recipientId: options.recipientId,
        groupKey: options.groupKey,
        lastActivityAt: { $lte: cooldownStart }
      },
      {
        $set: {
          actorId: options.actorId, read: false, readAt: null, lastActivityAt: now, updatedAt: now
        },
        // Only the fields `$set` does not already own. MongoDB rejects an update
        // whose operators touch the same path twice, so listing the whole
        // identity here would make every follow fail with a conflict rather than
        // create a notification.
        $setOnInsert: {
          recipientId: identity.recipientId,
          type: identity.type,
          groupKey: identity.groupKey,
          postId: identity.postId,
          commentId: identity.commentId,
          aggregateResourceId: identity.aggregateResourceId,
          isAggregate: identity.isAggregate,
          activityCount: identity.activityCount,
          lastEventId: identity.lastEventId,
          createdAt: now
        }
      },
      { upsert: true, new: true }
    ).catch((error: any) => {
      // The row exists but is still inside its cooldown, so the filter missed and
      // the upsert collided. That is the throttle doing its job.
      if (error?.code === 11000) return null;
      throw error;
    });

    if (!notification) return null;
    return this.publish(notification);
  }

  /**
   * Record a comment or reply, switching to an aggregate once the recipient is
   * receiving too many for one resource.
   *
   * Below the threshold each event is its own notification, because a comment
   * carries content worth showing. At the threshold the activity collapses into
   * one group so a viral post cannot create unbounded rows.
   *
   * The aggregate counts only the events it represents: the individual rows made
   * before the switch stay as history and are never also counted inside it.
   */
  public async recordAdaptive(
    options: NotificationIdentity & {
      eventId: string | ObjectId;
      aggregateGroupKey: string;
      threshold: number;
    }
  ): Promise<NotificationDto | null> {
    if (!this.hasDistinctParticipants(options)) return null;

    const aggregateFilter = {
      recipientId: options.recipientId,
      groupKey: options.aggregateGroupKey
    };

    // Once a group exists every later event belongs to it, whatever the number
    // of individual rows still sitting in history.
    const aggregateExists = await this.NotificationModel.exists(aggregateFilter);
    if (!aggregateExists) {
      const individualCount = await this.NotificationModel.countDocuments({
        recipientId: options.recipientId,
        type: options.type,
        aggregateResourceId: options.aggregateResourceId || null,
        isAggregate: false
      });

      // The event that crosses the threshold starts the aggregate and is the
      // only event that aggregate counts.
      if (individualCount < options.threshold - 1) {
        return this.createOnce(options);
      }
    }

    return this.aggregate({
      ...options,
      groupKey: options.aggregateGroupKey,
      eventId: options.eventId,
      countsActivity: true
    });
  }

  /**
   * Replace an aggregate's displayed actor once that actor withdraws.
   *
   * The count comes from the authoritative reaction statistic, so a group whose
   * stored actor has unliked would otherwise read "D and 1 other" while D no
   * longer likes anything. Only the displayed actor is touched: read state and
   * `lastActivityAt` are left alone, so withdrawing a like can never resurface a
   * notification or reorder the list.
   *
   * @returns true when the group was changed or removed
   */
  public async replaceAggregateActor(
    recipientId: string | ObjectId,
    groupKey: string,
    departingActorId: string | ObjectId,
    findReplacementActorId: () => Promise<ObjectId | null>
  ): Promise<boolean> {
    const notification = await this.NotificationModel.findOne({ recipientId, groupKey });
    // Nothing to do unless the actor on show is the one who withdrew.
    if (!notification || notification.actorId?.toString() !== departingActorId.toString()) {
      return false;
    }

    const replacement = await findReplacementActorId();
    if (!replacement) {
      // No activity remains, so the group no longer represents anything.
      await this.NotificationModel.deleteOne({ _id: notification._id });
      return true;
    }

    await this.NotificationModel.updateOne(
      { _id: notification._id },
      { $set: { actorId: replacement, updatedAt: new Date() } }
    );
    return true;
  }

  /** Self-interactions never notify, and both participants must be present. */
  private hasDistinctParticipants(options: NotificationIdentity): boolean {
    const recipientId = options.recipientId?.toString();
    const actorId = options.actorId?.toString();
    if (!recipientId || !actorId) return false;
    return recipientId !== actorId;
  }

  private buildIdentity(options: NotificationIdentity, now: Date) {
    return {
      recipientId: options.recipientId,
      actorId: options.actorId,
      type: options.type,
      groupKey: options.groupKey,
      postId: options.postId || null,
      commentId: options.commentId || null,
      aggregateResourceId: options.aggregateResourceId || null,
      isAggregate: false,
      activityCount: 1,
      lastEventId: null,
      read: false,
      readAt: null,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * The atomic half of {@link aggregate}.
   *
   * Retries once because two concurrent first-events both attempt an insert:
   * the loser's collision means the group now exists, so a second pass takes the
   * update path and its event is still counted rather than dropped. A genuine
   * redelivery fails the filter both times and returns null.
   */
  private async applyAggregate(
    options: AggregateNotificationOptions,
    isRetry = false
  ): Promise<NotificationDocument | null> {
    const now = new Date();
    const eventId = options.eventId || null;
    const identity = this.buildIdentity(options, now);

    const filter: Record<string, any> = {
      recipientId: options.recipientId,
      groupKey: options.groupKey
    };
    // Excluding the event already folded in is what makes a redelivery a no-op.
    if (eventId) filter.lastEventId = { $ne: eventId };

    const update: Record<string, any> = {
      $set: {
        actorId: options.actorId,
        lastEventId: eventId,
        isAggregate: true,
        read: false,
        readAt: null,
        lastActivityAt: now,
        updatedAt: now
      },
      $setOnInsert: {
        recipientId: identity.recipientId,
        type: identity.type,
        groupKey: identity.groupKey,
        postId: identity.postId,
        commentId: identity.commentId,
        aggregateResourceId: identity.aggregateResourceId,
        createdAt: now
      }
    };

    if (options.countsActivity) {
      update.$inc = { activityCount: 1 };
    } else {
      update.$set.activityCount = 1;
    }

    try {
      return await this.NotificationModel.findOneAndUpdate(filter, update, {
        upsert: true,
        new: true
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      // Either a concurrent insert won the race, or this event was already
      // folded in. One retry distinguishes them: the first now increments, the
      // second misses the filter again and settles as a no-op.
      if (isRetry) return null;
      return this.applyAggregate(options, true);
    }
  }

  /** Resolve and hand the notification to the delivery listener. */
  private async publish(notification: NotificationDocument): Promise<NotificationDto> {
    const dto = await this.resolveOne(notification);

    await this.queueMessageService.publish(NOTIFICATION_CHANNELS.NOTIFICATION, {
      eventName: EVENT.CREATED,
      data: dto
    });

    return dto;
  }

  /**
   * List the authenticated user's notifications, newest activity first.
   *
   * The recipient comes from `user`, never from the payload, so one user's
   * notifications can never be read by another.
   */
  public async search(
    req: NotificationSearchRequestPayload,
    user: UserDto | AuthUserDto
  ): Promise<PageableData<NotificationDto>> {
    let query: Record<string, any> = { recipientId: user._id };
    if (req.category) {
      query.type = { $in: NOTIFICATION_FILTER_TYPE_MAP[req.category] };
    } else if (req.type) {
      query.type = req.type;
    }

    // Ordering is by lastActivityAt so a refreshed notification returns to the
    // top; the cursor must read the same field or pages would overlap or skip.
    const useCursorPagination = Boolean(req.cursor && req.lastCreatedAt);
    if (useCursorPagination) {
      query = applyCursorPagination(query, req.cursor, req.lastCreatedAt, 'lastActivityAt');
    }

    const limit = Number(req.limit) || PAGINATION_DEFAULTS.DEFAULT_LIMIT;
    const offset = Number(req.offset) || 0;
    const sort: Record<string, SortOrder> = { lastActivityAt: -1, _id: -1 };

    const [rows, total] = await Promise.all([
      this.NotificationModel.find(query)
        .sort(sort)
        .lean()
        .limit(limit + 1)
        .skip(useCursorPagination ? 0 : offset),
      useCursorPagination ? Promise.resolve(undefined) : this.NotificationModel.countDocuments(query)
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const paginationInfo = {
      maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
      cursorPaginationAvailable: true
    };

    if (!items.length) {
      return {
        data: [], total, hasMore: false, nextCursor: null, paginationInfo
      };
    }

    const data = await this.resolveMany(items, user._id);
    const last = items[items.length - 1];

    return {
      data,
      total,
      hasMore,
      nextCursor: hasMore && last
        ? { id: last._id.toString(), createdAt: new Date(last.lastActivityAt).getTime() }
        : null,
      paginationInfo
    };
  }

  public async countUnread(userId: string | ObjectId): Promise<number> {
    return this.NotificationModel.countDocuments({ recipientId: userId, read: false });
  }

  /**
   * Remove every notification that points at a deleted post.
   *
   * A post is the destination of all of its own interaction notifications — the
   * likes on it, the comments and replies inside it, and the mentions naming it.
   * Once it is gone none of those rows can navigate anywhere, so they are
   * deleted rather than left as clickable dead ends.
   *
   * Deleting a *comment* deliberately does not do this: the containing post
   * still exists, so that history stays and is rendered as a removed comment
   * instead. Post deletion is the only cascade.
   *
   * One indexed `deleteMany` regardless of how many rows exist, and safe to run
   * again when the cleanup job retries.
   */
  /**
   * Re-publish notifications whose referenced comment has just been deleted.
   *
   * The stored row is never touched. `commentPreview` and `commentDeleted` are
   * resolved at read time from the live comment, so the database is already
   * correct the moment the comment disappears — what is stale is the DTO a
   * connected client is still holding in memory.
   *
   * Correctness comes from re-running the *same* `resolveMany` the list
   * endpoint uses, rather than hand-computing a "deleted" state here. That is
   * what guarantees a realtime update and a fresh fetch agree: an aggregate
   * whose newest event was deleted resolves exactly as a refetch would, with no
   * second set of deletion rules living in the socket path.
   *
   * @returns the notifications re-published, for the caller's log
   */
  public async invalidateByCommentIds(
    commentIds: Array<string | ObjectId>
  ): Promise<NotificationDto[]> {
    const ids = [...new Set(commentIds.filter(Boolean).map((id) => id.toString()))]
      .map((id) => new ObjectId(id));
    if (!ids.length) return [];

    // Both reference fields matter: an individual row points through
    // `commentId`, while an adaptive aggregate previews its `lastEventId`.
    const rows = await this.NotificationModel.find({
      $or: [{ commentId: { $in: ids } }, { lastEventId: { $in: ids } }]
    }).lean();
    if (!rows.length) return [];

    // Resolved per recipient, because the resolver takes the viewer into
    // account and one comment can be referenced by several people's rows.
    const byRecipient = new Map<string, Array<Record<string, any>>>();
    rows.forEach((row) => {
      const key = row.recipientId.toString();
      byRecipient.set(key, [...(byRecipient.get(key) || []), row]);
    });

    const updated: NotificationDto[] = [];
    await Promise.all([...byRecipient.entries()].map(async ([recipientId, recipientRows]) => {
      const dtos = await this.resolveMany(recipientRows, recipientId);
      updated.push(...dtos);
      await Promise.all(dtos.map((dto) => this.queueMessageService.publish(
        NOTIFICATION_CHANNELS.NOTIFICATION,
        // An update, not a new interaction: delivery must not treat it as
        // arriving activity, so read state, ordering and the badge are untouched.
        { eventName: EVENT.UPDATED, data: dto }
      )));
    }));

    return updated;
  }

  /**
   * Remove one notification from its recipient's own inbox.
   *
   * The recipient is part of the delete filter rather than checked after a
   * lookup, so a request for somebody else's notification matches nothing and
   * is reported as not found — it neither deletes the row nor confirms that the
   * id exists. Same shape as `markAllRead`, which is already scoped this way.
   *
   * Only the notification is removed. The interaction it describes — the like,
   * the comment, the follow — is untouched, and an aggregate row is deleted as
   * the single document it is rather than decomposed.
   */
  public async deleteForRecipient(
    notificationId: string | ObjectId,
    recipientId: string | ObjectId
  ): Promise<{ deleted: boolean }> {
    if (!ObjectId.isValid(notificationId.toString())) return { deleted: false };

    const result = await this.NotificationModel.deleteOne({
      _id: new ObjectId(notificationId.toString()),
      recipientId
    });

    return { deleted: (result.deletedCount || 0) > 0 };
  }

  public async deleteByPostId(postId: string | ObjectId): Promise<{ deleted: number }> {
    const result = await this.NotificationModel.deleteMany({ postId });
    return { deleted: result.deletedCount || 0 };
  }

  /**
   * Mark one notification read.
   *
   * The recipient is part of the filter rather than checked afterwards, so a
   * request for someone else's notification matches nothing and is reported as
   * not found — it neither mutates the row nor reveals that it exists.
   */
  public async markAllRead(userId: string | ObjectId): Promise<{ updated: number }> {
    const result = await this.NotificationModel.updateMany(
      { recipientId: userId, read: false },
      { $set: { read: true, readAt: new Date(), updatedAt: new Date() } }
    );

    return { updated: result.modifiedCount || 0 };
  }

  /** Resolve a single row, used on the create path before realtime delivery. */
  private async resolveOne(notification: NotificationDocument): Promise<NotificationDto> {
    const [dto] = await this.resolveMany([notification.toObject()], notification.recipientId);
    return dto;
  }

  /**
   * Attach actor, thumbnail and follow state to a page of rows.
   *
   * Runs a fixed number of queries regardless of page size — one for users, one
   * for posts, and one for follow state — instead of resolving per row.
   */
  private async resolveMany(
    rows: Array<Record<string, any>>,
    viewerId: string | ObjectId
  ): Promise<NotificationDto[]> {
    const dtos = rows.map((row) => NotificationDto.fromModel(row));

    const actorIds = [...new Set(rows.map((row) => row.actorId?.toString()).filter(Boolean))];
    const postIds = [...new Set(rows.map((row) => row.postId?.toString()).filter(Boolean))];
    const followActorIds = [...new Set(
      rows
        .filter((row) => row.type === NOTIFICATION_TYPES.FOLLOW)
        .map((row) => row.actorId?.toString())
        .filter(Boolean)
    )];

    /**
     * Every comment any row on this page points at.
     *
     * Serves two purposes at once, which is why it is not narrowed to one type:
     * comment-like aggregates read `totalLike` from it, and *any* comment-scoped
     * row uses its absence to detect that the comment has been deleted. Deriving
     * the deleted state from the comment's own existence keeps it authoritative
     * — a row created before this feature, or one whose deletion event was lost,
     * still resolves correctly — and costs one batched query per page rather
     * than a stored flag that could drift.
     */
    const commentIds = [...new Set(
      rows
        .map((row) => referenceCommentId(row)?.toString())
        .filter(Boolean)
    )];

    const [actors, posts, comments, followedActorIds] = await Promise.all([
      this.baseUserService.findByIds(actorIds),
      postIds.length
        ? this.PostModel.find({ _id: { $in: postIds } })
          .select({ _id: 1, cover3x4Url: 1, cover4x3Url: 1, totalLike: 1 })
          .lean<PostThumbnailProjection[]>()
        : Promise.resolve([] as PostThumbnailProjection[]),
      commentIds.length
        ? this.CommentModel.find({ _id: { $in: commentIds } })
          .select({ _id: 1, totalLike: 1, content: 1 })
          .lean<CommentLikeProjection[]>()
        : Promise.resolve([] as CommentLikeProjection[]),
      followActorIds.length
        ? this.followService.getFollowingCreatorIdSet(viewerId, followActorIds)
        : Promise.resolve(new Set<string>())
    ]);

    const actorMap = new Map(actors.map((actor) => [actor._id.toString(), actor]));
    const postMap = new Map(posts.map((post) => [post._id.toString(), post]));
    const commentMap = new Map(comments.map((comment) => [comment._id.toString(), comment]));

    dtos.forEach((dto) => {
      dto.setActor(actorMap.get(dto.actorId?.toString()));

      // The interaction happened, so the row stays; only the content it quotes
      // may be gone. The client renders that as a removed comment rather than
      // dropping the history or linking to nothing.
      const referenceId = referenceCommentId(dto as any);
      if (referenceId) {
        const referenced = commentMap.get(referenceId.toString());
        dto.setCommentDeleted(!referenced);
        // The live comment text, never a copy stored on the notification, so a
        // later edit is reflected and nothing rendered lives in the database.
        dto.setCommentPreview(referenced?.content || null);
      }

      const post = dto.postId ? postMap.get(dto.postId.toString()) : undefined;
      if (dto.postId) {
        // Prefer the vertical cover: notification thumbnails are small and
        // portrait, matching how the feed presents this media.
        dto.setPostThumbnail(post ? (post.cover3x4Url || post.cover4x3Url || null) : null);
      }

      if (dto.type === NOTIFICATION_TYPES.POST_LIKE) {
        dto.setActorCount(post?.totalLike || 1);
      } else if (dto.type === NOTIFICATION_TYPES.COMMENT_LIKE) {
        const comment = referenceId ? commentMap.get(referenceId.toString()) : undefined;
        dto.setActorCount(comment?.totalLike || 1);
      } else {
        // Adaptive aggregates count the events they represent; everything else
        // stands for a single event.
        dto.setActorCount(dto.isAggregate ? dto.activityCount || 1 : 1);
      }

      if (dto.type === NOTIFICATION_TYPES.FOLLOW) {
        dto.setIsActorFollowed(followedActorIds.has(dto.actorId?.toString()));
      }
    });

    return dtos;
  }
}
