import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model, SortOrder } from 'mongoose';
import {
  PAGINATION_DEFAULTS, REACTION_CHANNELS, REACTION_TARGET_TYPES, REACTION_TYPES, USER_STATUS
} from 'src/common/constants';
import { applyCursorPagination } from 'src/common/utils/pagination.util';
import { UserDto } from 'src/dtos/identity/user';
import { EntityNotFoundException, QueueMessageService } from 'src/kernel';
import { SearchRequest } from 'src/kernel/common';
import { EVENT } from 'src/kernel/constants';
import { Reaction, ReactionDocument, User, UserDocument } from 'src/schemas';
import { __t } from 'src/utils/translation';

@Injectable()
export class FollowService {
  constructor(
    @InjectModel(Reaction.name) private readonly reactionModel: Model<ReactionDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly queueMessageService: QueueMessageService
  ) {}

  async follow(followerId: string | ObjectId, creatorId: string | ObjectId) {
    if (followerId.toString() === creatorId.toString()) {
      throw new BadRequestException(__t('errors.cannot_follow_yourself'));
    }

    const creator = await this.userModel.exists({ _id: creatorId, status: USER_STATUS.ACTIVE });
    if (!creator) throw new EntityNotFoundException();

    let created = false;
    try {
      const result = await this.reactionModel.updateOne(
        {
          createdBy: followerId,
          objectId: creatorId,
          objectType: REACTION_TARGET_TYPES.CREATOR,
          action: REACTION_TYPES.FOLLOW
        },
        {
          $setOnInsert: {
            createdBy: followerId,
            objectId: creatorId,
            objectType: REACTION_TARGET_TYPES.CREATOR,
            action: REACTION_TYPES.FOLLOW
          }
        },
        { upsert: true }
      );
      created = result.upsertedCount > 0;
    } catch (error: any) {
      // Concurrent idempotent follows can race on the unique reaction index.
      // The winner already created the relation, so the duplicate request succeeds without counters.
      if (error?.code !== 11000) throw error;
    }

    if (created) {
      await Promise.all([
        this.userModel.updateOne({ _id: creatorId }, { $inc: { 'stats.followers': 1 } }),
        this.userModel.updateOne({ _id: followerId }, { $inc: { 'stats.followings': 1 } })
      ]);

      // Published only for a genuinely new relation, so a repeated follow request
      // — including one that lost the unique-index race above — cannot notify the
      // creator twice. Follows are stored as reactions, so this reuses the
      // reaction channel; subscribers that only care about posts or comments
      // filter this event out by objectType.
      await this.queueMessageService.publish(REACTION_CHANNELS.REACTION, {
        eventName: EVENT.CREATED,
        data: {
          objectType: REACTION_TARGET_TYPES.CREATOR,
          objectId: creatorId,
          action: REACTION_TYPES.FOLLOW,
          createdBy: followerId
        }
      });
    }

    return { isFollowed: true, created };
  }

  async unfollow(followerId: string | ObjectId, creatorId: string | ObjectId) {
    const result = await this.reactionModel.deleteOne({
      createdBy: followerId,
      objectId: creatorId,
      objectType: REACTION_TARGET_TYPES.CREATOR,
      action: REACTION_TYPES.FOLLOW
    });
    const removed = result.deletedCount > 0;

    if (removed) {
      await Promise.all([
        this.userModel.updateOne(
          { _id: creatorId, 'stats.followers': { $gt: 0 } },
          { $inc: { 'stats.followers': -1 } }
        ),
        this.userModel.updateOne(
          { _id: followerId, 'stats.followings': { $gt: 0 } },
          { $inc: { 'stats.followings': -1 } }
        )
      ]);
    }

    return { isFollowed: false, removed };
  }

  async getFollowingCreatorIds(userId: string | ObjectId): Promise<ObjectId[]> {
    return this.reactionModel.distinct('objectId', {
      createdBy: userId,
      objectType: REACTION_TARGET_TYPES.CREATOR,
      action: REACTION_TYPES.FOLLOW
    });
  }

  async getFollowingCreatorIdSet(userId: string | ObjectId, creatorIds: Array<string | ObjectId>) {
    if (!creatorIds.length) return new Set<string>();
    const rows = await this.reactionModel.find({
      createdBy: userId,
      objectId: { $in: creatorIds },
      objectType: REACTION_TARGET_TYPES.CREATOR,
      action: REACTION_TYPES.FOLLOW
    }).select({ objectId: 1 }).lean();
    return new Set(rows.map(row => row.objectId.toString()));
  }

  /**
   * Lists the users on the other side of a follow relation.
   *
   * `relatedField` is the reaction field holding the user to return: `objectId` for the creators a
   * user follows, `createdBy` for the users following a creator. `viewerId` is whoever is browsing,
   * and decides the `isFollowed` flag on each row so follow buttons render the viewer's own state.
   */
  private async listFollowRelations({
    baseQuery,
    relatedField,
    request,
    viewerId
  }: {
    baseQuery: Record<string, any>;
    relatedField: 'objectId' | 'createdBy';
    request: SearchRequest;
    viewerId?: string | ObjectId;
  }) {
    let query: Record<string, any> = { ...baseQuery };

    // Searching matches on the related user, so resolve matching users first and constrain the
    // reaction query to them — the reaction documents themselves hold no searchable profile fields.
    const keyword = (request.q || '').trim();
    if (keyword) {
      const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const matchedIds = await this.userModel
        .find({ $or: [{ name: pattern }, { username: pattern }], status: USER_STATUS.ACTIVE })
        .select({ _id: 1 })
        .lean();
      if (!matchedIds.length) {
        return {
          data: [],
          total: 0,
          hasMore: false,
          nextCursor: null,
          paginationInfo: { maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET, cursorPaginationAvailable: true }
        };
      }
      query[relatedField] = { $in: matchedIds.map(item => item._id) };
    }

    const useCursor = Boolean((request as any).cursor && (request as any).lastCreatedAt);
    if (useCursor) {
      query = applyCursorPagination(query, (request as any).cursor, (request as any).lastCreatedAt);
    }

    const limit = Number(request.limit) || PAGINATION_DEFAULTS.DEFAULT_LIMIT;
    const offset = Number(request.offset) || 0;
    const sortDirection: SortOrder = request.sort === 'asc' ? 1 : -1;
    const reactions = await this.reactionModel.find(query)
      .sort({ createdAt: sortDirection, _id: sortDirection })
      .skip(useCursor ? 0 : offset)
      .limit(limit + 1)
      .lean();
    const hasMore = reactions.length > limit;
    const page = hasMore ? reactions.slice(0, limit) : reactions;
    const userIds = page.map(item => item[relatedField]);
    const users = userIds.length
      ? await this.userModel.find({ _id: { $in: userIds }, status: USER_STATUS.ACTIVE }).lean()
      : [];
    const userMap = new Map(users.map(item => [item._id.toString(), item]));
    const followedByViewer = viewerId
      ? await this.getFollowingCreatorIdSet(viewerId, userIds)
      : new Set<string>();

    const data = page
      .map(item => userMap.get(item[relatedField].toString()))
      .filter(Boolean)
      .map(item => {
        const dto = UserDto.fromModel(item);
        const id = item._id.toString();
        dto.isFollowed = viewerId ? followedByViewer.has(id) : false;
        return dto.toSearchResponse();
      });
    const last = page[page.length - 1];

    return {
      data,
      total: useCursor ? undefined : await this.reactionModel.countDocuments(query),
      hasMore,
      nextCursor: hasMore && last ? { id: last._id.toString(), createdAt: last.createdAt.getTime() } : null,
      paginationInfo: { maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET, cursorPaginationAvailable: true }
    };
  }

  /** Creators followed by `userId`. */
  async getFollowingUsers(userId: string | ObjectId, request: SearchRequest, viewerId?: string | ObjectId) {
    return this.listFollowRelations({
      baseQuery: {
        createdBy: userId,
        objectType: REACTION_TARGET_TYPES.CREATOR,
        action: REACTION_TYPES.FOLLOW
      },
      relatedField: 'objectId',
      request,
      // Viewing your own following list: every row is followed by definition.
      viewerId: viewerId ?? userId
    });
  }

  /** Users following `creatorId`. */
  async getFollowerUsers(creatorId: string | ObjectId, request: SearchRequest, viewerId?: string | ObjectId) {
    return this.listFollowRelations({
      baseQuery: {
        objectId: creatorId,
        objectType: REACTION_TARGET_TYPES.CREATOR,
        action: REACTION_TYPES.FOLLOW
      },
      relatedField: 'createdBy',
      request,
      viewerId
    });
  }
}
