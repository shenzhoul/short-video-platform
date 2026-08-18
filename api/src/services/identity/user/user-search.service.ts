import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, SortOrder } from "mongoose";
import { PAGINATION_DEFAULTS, USER_STATUS } from "src/common/constants";
import { applyCursorPagination } from "src/common/utils/pagination.util";
import { createSafeSearchRegex } from "src/common/utils/search-sanitizer.util";
import { UserDto } from "src/dtos/identity/user";
import { UserSearchRequestPayload } from "src/payloads";
import { User, UserDocument } from "src/schemas";

/**
 * UserSearchAndFilterService handles comprehensive user search and filtering operations.
 * This service provides advanced search functionality for user discovery and management.
 *
 * @author ShenZhoul
 * @version 1.0.0
 */
@Injectable()
export class UserSearchAndFilterService {
  constructor(
    @InjectModel(User.name) private readonly UserModel: Model<UserDocument>
  ) { }

  public async search(req: UserSearchRequestPayload): Promise<{
    data: Partial<UserDto>[];
    hasMore: boolean;
    nextCursor?: {
      id: string;
      createdAt: number;
    };
    total?: number;
    paginationInfo?: {
      maxOffset: number;
      cursorPaginationAvailable: boolean;
    };
  }> {
    const query: Record<string, any> = {};
    // Use secure search sanitization to prevent NoSQL injection
    if (req.q) {
      const searchRegex = createSafeSearchRegex(req.q);
      if (searchRegex) {
        query.$or = [
          {
            name: { $regex: searchRegex }
          },
          {
            username: { $regex: searchRegex }
          },
          {
            email: { $regex: searchRegex }
          }
        ];
      }
    }

    if (typeof req.isAdmin === 'boolean') {
      if (req.isAdmin) {
        query.isAdmin = req.isAdmin;
      } else {
        query.isAdmin = { $ne: true }; // Exclude admin users when isAdmin is false
      }
    }
    if (req.status) {
      query.status = req.status;
    }

    // ADVANCED CURSOR-BASED PAGINATION
    // Implement compound cursor logic to prevent data loss with identical timestamps
    if (req.cursor && req.lastCreatedAt) {
      const cursorQuery = applyCursorPagination(query, req.cursor, req.lastCreatedAt);
      Object.assign(query, cursorQuery);
    }

    const limit = req.limit ? Number(req.limit) : 10;

    // Optimized sort strategy for maximum index efficiency
    const sort: Record<string, SortOrder> = {
      createdAt: -1, // Primary sort: newest users first
      _id: -1 // Secondary sort: consistent ordering for identical timestamps
    };

    // Override with custom sort if provided
    if (req.sort && req.sortBy) {
      sort[req.sortBy] = req.sort;
    }

    // Determine pagination strategy
    const offset = Number(req.offset) || 0;
    const useCursorPagination = req.cursor || req.lastCreatedAt || offset > PAGINATION_DEFAULTS.MAX_OFFSET;
    // Execute query with one extra item to determine hasMore efficiently
    const [data, total] = await Promise.all([
      this.UserModel
        .find(query)
        .sort(sort)
        .lean() // Use lean() for better performance on reads
        .limit(limit + 1) // Fetch one extra to determine hasMore efficiently
        .skip(useCursorPagination ? 0 : offset),
      useCursorPagination ? Promise.resolve(undefined) : this.UserModel.countDocuments(query)
    ]);
    // Calculate pagination metadata
    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;

    // Always provide pagination guidance to client
    const paginationInfo = {
      maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
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

    // Generate next cursor from the last item for subsequent requests
    const nextCursor = hasMore ? {
      id: items[items.length - 1]._id.toString(),
      createdAt: new Date(items[items.length - 1].createdAt).getTime()
    } : null;

    return {
      data: items.map((item) => UserDto.fromModel(item).toResponse(true)),
      hasMore,
      nextCursor,
      total: useCursorPagination ? undefined : total,
      paginationInfo
    };
  }

  public async searchAll(req: UserSearchRequestPayload): Promise<{
    data: Partial<UserDto>[];
    hasMore: boolean;
    nextCursor?: {
      id: string;
      createdAt: number;
    };
    total?: number;
    paginationInfo?: {
      maxOffset: number;
      cursorPaginationAvailable: boolean;
    };
  }> {
    const query: Record<string, any> = {
      isAdmin: false
    };
    // ✅ SECURITY FIX: Use secure search sanitization to prevent NoSQL injection
    if (req.q) {
      const searchRegex = createSafeSearchRegex(req.q);
      if (searchRegex) {
        query.$or = [
          {
            name: { $regex: searchRegex }
          },
          {
            username: { $regex: searchRegex }
          },
          {
            email: { $regex: searchRegex }
          }
        ];
      }
    }

    if (typeof req.isAdmin === 'boolean') {
      if (req.isAdmin) {
        delete query.isCreator; // Admin search should not filter by isCreator
        query.isAdmin = req.isAdmin;
      } else {
        query.isAdmin = { $ne: true }; // Exclude admin users when isAdmin is false
      }
    }
    if (req.status) {
      query.status = req.status;
    }

    // ADVANCED CURSOR-BASED PAGINATION
    // Implement compound cursor logic to prevent data loss with identical timestamps
    if (req.cursor && req.lastCreatedAt) {
      const cursorQuery = applyCursorPagination(query, req.cursor, req.lastCreatedAt);
      Object.assign(query, cursorQuery);
    }

    const limit = req.limit ? Number(req.limit) : 10;

    // Optimized sort strategy for maximum index efficiency
    const sort: Record<string, SortOrder> = {
      createdAt: -1, // Primary sort: newest users first
      _id: -1 // Secondary sort: consistent ordering for identical timestamps
    };

    // Override with custom sort if provided
    if (req.sort && req.sortBy) {
      sort[req.sortBy] = req.sort;
    }

    // Determine pagination strategy
    const offset = Number(req.offset) || 0;
    const useCursorPagination = req.cursor || req.lastCreatedAt || offset > PAGINATION_DEFAULTS.MAX_OFFSET;
    // Execute query with one extra item to determine hasMore efficiently
    const [data, total] = await Promise.all([
      this.UserModel
        .find(query)
        .sort(sort)
        .lean() // Use lean() for better performance on reads
        .limit(limit + 1) // Fetch one extra to determine hasMore efficiently
        .skip(useCursorPagination ? 0 : offset),
      useCursorPagination ? Promise.resolve(undefined) : this.UserModel.countDocuments(query)
    ]);

    // Calculate pagination metadata
    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;

    // Always provide pagination guidance to client
    const paginationInfo = {
      maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
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

    // Generate next cursor from the last item for subsequent requests
    const nextCursor = hasMore ? {
      id: items[items.length - 1]._id.toString(),
      createdAt: new Date(items[items.length - 1].createdAt).getTime()
    } : null;

    return {
      data: items.map((item) => UserDto.fromModel(item).toResponse(true)),
      hasMore,
      nextCursor,
      total: useCursorPagination ? undefined : total,
      paginationInfo
    };
  }

  /**
   * Search users for public discovery.
   *
   * Deliberately does NOT reuse the admin query above. That one also matches on `email`, so sharing
   * it — even while stripping email from the response — would let anyone confirm whether an address
   * has an account by typing it into search. This path matches public profile fields only and is
   * restricted to active accounts.
   */
  public async publicSearch(req: UserSearchRequestPayload): Promise<{
    data: Partial<UserDto>[];
    hasMore: boolean;
    nextCursor?: { id: string; createdAt: number } | null;
    total?: number;
  }> {
    const query: Record<string, any> = {
      status: USER_STATUS.ACTIVE,
      isAdmin: { $ne: true }
    };

    const searchRegex = req.q ? createSafeSearchRegex(req.q) : null;
    if (searchRegex) {
      const value = { $regex: searchRegex };
      query.$or = [
        { name: value },
        { username: value }
      ];
    }

    const limit = req.limit ? Number(req.limit) : 10;
    const offset = Number(req.offset) || 0;

    const [data, total] = await Promise.all([
      this.UserModel
        .find(query)
        .sort({ 'stats.followers': -1, createdAt: -1, _id: -1 })
        .lean()
        .limit(limit + 1)
        .skip(offset),
      this.UserModel.countDocuments(query)
    ]);

    const hasMore = data.length > limit;
    const items = hasMore ? data.slice(0, limit) : data;
    const last = items[items.length - 1];

    return {
      data: items.map((item) => UserDto.fromModel(item).toSearchResponse()),
      hasMore,
      nextCursor: hasMore && last
        ? { id: last._id.toString(), createdAt: new Date(last.createdAt).getTime() }
        : null,
      total
    };
  }
}