import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, SortOrder } from "mongoose";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { UserDto } from "src/dtos/identity/user";
import { STATUS } from "src/kernel/constants";
import { PostSearchRequest } from "src/payloads";
import { Post, PostDocument } from "src/schemas";
import * as moment from 'moment';
import { createSafeSearchRegex } from "src/common/utils/search-sanitizer.util";
import { applyCursorPagination, parseDateFromCursor } from "src/common/utils/pagination.util";
import { PAGINATION_DEFAULTS } from "src/common/constants";
import { CategoryService } from "src/services/content/category";
import { ObjectId } from 'mongodb';

const creatorPinnedSort = (sort: Record<string, SortOrder>): Record<string, SortOrder> => ({
  isPinned: -1,
  pinnedAt: -1,
  ...sort
});

/**
 * Continue a creator list without replaying pinned items across cursor pages.
 *
 * Exported for its own tests: the loop this prevents is invisible from the
 * outside until a creator has more posts than one page, and by then it looks
 * like a rendering fault rather than a filter that forgot a bound.
 */
export function applyCreatorPinnedCursor(query: Record<string, any>, req: PostSearchRequest) {
  if (typeof req.lastIsPinned !== 'boolean') {
    return applyCursorPagination(query, req.cursor as string, req.lastCreatedAt, req.sortBy || 'createdAt');
  }

  // The payload accepts an ISO string, a timestamp string or a number, and
  // `applyCursorPagination` has always honoured all three. A bare `new Date()`
  // here did not: `new Date('1788064858000')` is an Invalid Date, which the
  // driver refuses to serialise, so a cursor in the timestamp form answered 500
  // on this path while working on every other one.
  const createdAt = parseDateFromCursor(req.lastCreatedAt);
  const id = new ObjectId(req.cursor);
  const afterCreatedAt = [
    { createdAt: { $lt: createdAt } },
    { createdAt, _id: { $lt: id } }
  ];

  if (!req.lastIsPinned) {
    return {
      $and: [{ ...query }, { isPinned: { $ne: true } }, { $or: afterCreatedAt }]
    };
  }

  const pinnedAt = req.lastPinnedAt ? parseDateFromCursor(req.lastPinnedAt) : createdAt;
  return {
    $and: [
      { ...query },
      {
        $or: [
          {
            $and: [
              { isPinned: true },
              {
                $or: [
                  { pinnedAt: { $lt: pinnedAt } },
                  { pinnedAt, $or: afterCreatedAt }
                ]
              }
            ]
          },
          { isPinned: { $ne: true } }
        ]
      }
    ]
  };
}

/**
 * PostSearchService
 *
 * Handles all search-related functionality for posts including:
 * - Advanced post search with filtering and pagination
 * - Public user post searches
 * - Subscribed creator post searches
 * - Infinite scroll implementations
 * - Hybrid search algorithms
 * - Search optimization and performance
 *
 * This service consolidates all search operations and provides
 * optimized query building and result processing.
 */
@Injectable()
export class PostSearchService {
  constructor(
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    private readonly categoryService: CategoryService
  ) { }
  /**
   * Search posts for public user consumption
   *
   * Public-facing post search with active status filtering and media type support.
   * Only returns posts that are publicly accessible and active.
   *
   * @param req - Search request with filters and pagination
   * @param user - User performing the search (affects permissions)
   * @param options - Additional options for population control
   * @returns Promise resolving to paginated search results with raw post data for population by caller
   */
  public async userSearchPosts(req: PostSearchRequest) {
    let query: Record<string, any> = {
      status: STATUS.ACTIVE,
      isCreatorDeleted: { $ne: true }
    };
    if (req.userId) {
      query.userId = req.userId;
    }

    const enhanceQueryUserId: any = (req as any).enhanceQueryUserId;
    if (enhanceQueryUserId?.$in) {
      query.userId = { $in: enhanceQueryUserId.$in };
    }
    if (enhanceQueryUserId?.$nin && enhanceQueryUserId.$nin.length > 0) {
      if (!query.$and) query.$and = [];
      query.$and.push({ userId: { $nin: enhanceQueryUserId.$nin } });
    }

    if (req.fromDate && req.toDate) {
      query.createdAt = {
        $gte: moment(req.fromDate).startOf('date'),
        $lte: moment(req.toDate).endOf('date')
      };
    }

    if (req.orientation) {
      query.orientation = req.orientation;
    }

    if (req.type) {
      query.type = req.type === 'media' ? { $in: ['photo', 'video'] } : req.type;
    }

    // Add support for mediaTypes filtering
    if (req.mediaTypes && req.mediaTypes.length > 0) {
      query.mediaTypes = { $in: req.mediaTypes };
    }

    // An unknown or disabled category is ignored rather than rejected: a stale category chip in an
    // open tab should fall back to the unfiltered feed, not break it. The catalogue is admin-managed
    // data now, so the check is a query rather than a constant lookup.
    if (req.topicKey && await this.categoryService.isActiveKey(req.topicKey)) {
      query.topicKey = req.topicKey.trim().toLowerCase();
    }

    // An explicit hashtag intent matches the indexed tag value exactly — no free-text search, so
    // `#diving` never returns posts that merely mention diving in prose.
    if (req.tag) {
      query.tags = req.tag.toLowerCase().trim();
    } else if (req.q) {
      // ✅ SECURITY FIX: Use secure search sanitization to prevent NoSQL injection
      const searchRegex = createSafeSearchRegex(req.q);
      if (searchRegex) {
        const searchValue = { $regex: searchRegex };
        query.$or = [
          { title: searchValue },
          { text: searchValue },
          { tagline: searchValue },
          { tags: searchValue }
        ];
      }
    }

    // A creator listing is pinned-first unless the caller asked for plain
    // newest-first; the sort and the cursor must agree on which one it is.
    const pinnedFirst = Boolean(req.userId) && req.creatorOrder !== 'latest';

    // ADVANCED CURSOR-BASED PAGINATION
    // Implement compound cursor logic to prevent data loss with identical timestamps
    if (req.cursor && req.lastCreatedAt) {
      query = pinnedFirst
        ? applyCreatorPinnedCursor(query, req)
        : applyCursorPagination(query, req.cursor, req.lastCreatedAt, req.sortBy || 'createdAt');
    }

    let sort: Record<string, SortOrder> = {
      createdAt: -1,
      _id: -1 // Secondary sort for deterministic ordering
    };
    if (req.sort && req.sortBy) {
      sort = {
        [req.sortBy]: req.sort,
        _id: -1 // Always include _id for deterministic ordering
      };
    }

    // Determine pagination strategy
    const offset = Number(req.offset) || 0;
    const limit = req.limit ? Number(req.limit) : 10;
    const useCursorPagination = req.cursor && req.lastCreatedAt || offset > PAGINATION_DEFAULTS.MAX_OFFSET;

    const [data, total] = await Promise.all([
      this.PostModel
        .find(query)
        .sort(pinnedFirst ? creatorPinnedSort(sort) : sort)
        .limit(limit + 1) // Fetch one extra to determine hasMore efficiently
        .skip(useCursorPagination ? 0 : offset),
      useCursorPagination ? Promise.resolve(undefined) : this.PostModel.countDocuments(query)
    ]);

    // Calculate pagination metadata
    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;

    // Generate next cursor from the last item for subsequent requests
    //  && (useCursorPagination || offset >= PAGINATION_DEFAULTS.MAX_OFFSET || (offset + limit) >= PAGINATION_DEFAULTS.MAX_OFFSET) ?
    const nextCursor = items.length > 0 ? {
      id: items[items.length - 1]._id.toString(),
      createdAt: new Date(items[items.length - 1].createdAt).getTime(),
      isPinned: Boolean(items[items.length - 1].isPinned),
      pinnedAt: items[items.length - 1].pinnedAt
        ? new Date(items[items.length - 1].pinnedAt).getTime()
        : null
    } : null;

    // Always provide pagination guidance to client
    const paginationInfo = {
      maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
      cursorPaginationAvailable: true
    };

    // Return raw data - population will be handled by caller
    return {
      data: items,
      total: useCursorPagination ? undefined : total,
      hasMore,
      nextCursor,
      paginationInfo
    };
  }

  /**
   * Search posts with advanced filtering and pagination
   *
   * Provides comprehensive post search functionality with support for text search,
   * date filtering, media type filtering, and user-specific permissions.
   *
   * @param req - Search request with filters, pagination, and sorting options
   * @param options - Additional options including user context for population control
   * @returns Promise resolving to paginated search results with raw post data for population by caller
   */
  public async search(req: PostSearchRequest) {
    let query: Record<string, any> = {};

    if (req.userId) {
      query.userId = req.userId;
    }

    if (req.fromDate && req.toDate) {
      query.createdAt = {
        $gte: moment(req.fromDate).startOf('date'),
        $lte: moment(req.toDate).endOf('date')
      };
    }

    if (req.orientation) {
      query.orientation = req.orientation;
    }

    if (req.type) {
      query.type = req.type === 'media' ? { $in: ['photo', 'video'] } : req.type;
    }

    // Add support for mediaTypes filtering
    if (req.mediaTypes && req.mediaTypes.length > 0) {
      query.mediaTypes = { $in: req.mediaTypes };
    }

    if (req.q) {
      const regexp = new RegExp(
        req.q.toLowerCase().replace(/[^a-zA-Z0-9 ]/g, ''),
        'i'
      );
      const searchValue = { $regex: regexp };
      query.$or = [
        { text: searchValue },
        { tagline: searchValue }
      ];
    }

    let sort: Record<string, SortOrder> = {
      createdAt: -1,
      _id: -1
    };
    if (req.sort && req.sortBy) {
      sort = {
        [req.sortBy]: req.sort,
        _id: -1
      };
    }

    // Handle cursor-based pagination
    const offset = Number(req.offset) || 0;
    const limit = req.limit ? Number(req.limit) : 10;
    const useCursorPagination = req.cursor && req.lastCreatedAt || offset > PAGINATION_DEFAULTS.MAX_OFFSET;

    if (useCursorPagination) {
      query = req.userId
        ? applyCreatorPinnedCursor(query, req)
        : applyCursorPagination(query, req.cursor as string, req.lastCreatedAt, req.sortBy || 'createdAt');
    }
    const [data, total] = await Promise.all([
      this.PostModel
        .find(query)
        .sort(req.userId ? creatorPinnedSort(sort) : sort)
        .limit(limit + 1) // Fetch one extra to determine hasMore efficiently
        .skip(useCursorPagination ? 0 : offset),
      useCursorPagination ? Promise.resolve(undefined) : this.PostModel.countDocuments(query)
    ]);

    // Calculate pagination metadata
    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;

    const posts = items;

    // Prepare response with cursor information
    let nextCursor = null;
    // items.length > 0 && (useCursorPagination || offset >= PAGINATION_DEFAULTS.MAX_OFFSET)
    if (hasMore) {
      const lastItem = items[items.length - 1];
      nextCursor = {
        id: lastItem._id.toString(),
        createdAt: lastItem.createdAt.getTime(),
        isPinned: Boolean(lastItem.isPinned),
        pinnedAt: lastItem.pinnedAt ? lastItem.pinnedAt.getTime() : null
      };
    }

    // Always provide pagination guidance to client
    const paginationInfo = {
      maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
      cursorPaginationAvailable: true
    };

    return {
      data: posts,
      total: useCursorPagination ? undefined : total,
      hasMore,
      nextCursor,
      paginationInfo
    };
  }
}
