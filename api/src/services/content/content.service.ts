import { ObjectId } from 'mongodb';
import { FlattenMaps } from 'mongoose';
import { Injectable } from "@nestjs/common";
import { AuthUserDto } from "src/dtos/identity/auth-user.dto";
import { UserDto } from "src/dtos/identity/user";
import { PostRecommendationRequest, PostSearchRequest, ReactionSearchRequestPayload } from "src/payloads";
import { PostSearchService } from './post/post-search.service';
import { PostRecommendationService } from './post/post-recommendation.service';
import { IPopulatePostOptions, PostService } from './post/post.service';
import { uniq } from "lodash";
import { FileServerService } from "src/services/shared/file-server";
import { FileServerInfoDto } from "src/dtos/shared/file-server/file-server.dto";
import { PostDocument } from "src/schemas";
import { PostDto } from "src/dtos/content";
import { PAGINATION_DEFAULTS, USER_STATUS } from 'src/common/constants';
import { UserAccountManagementService } from 'src/services/identity';
import { SocketUserService } from 'src/services/socket';
import { __t } from 'src/utils/translation';
import { ReactionService } from 'src/services/community/reaction/reaction.service';
import { FollowService } from 'src/services/community/follow';

type LeanPostDocument = FlattenMaps<PostDocument> & Required<{ _id: ObjectId }>;

/**
 * Content Service
 *
 * This service acts as an orchestrator for content-related operations, similar to CommunicationService.
 * It resolves circular dependencies between PostService and ReactionService by providing a higher-level
 * abstraction that coordinates between content and community services.
 *
 * 🚨 IMPORTANT: CIRCULAR DEPENDENCY PREVENTION
 *
 * DO NOT inject this service into:
 * - PostService
 * - ReactionService
 * - ProductService
 * - Any service that this ContentService depends on
 *
 * This service should only be injected into:
 * - Controllers
 * - Other high-level orchestrator services
 * - Services that don't have dependencies on content/community services
 *
 * ARCHITECTURE PATTERN:
 *
 * Controllers/High-level services
 *         ↓
 *   ContentService (this service)
 *         ↓
 * PostService + ReactionService + ProductService
 *         ↓
 * Database Models & External APIs
 *
 * USAGE EXAMPLES:
 *
 * ✅ CORRECT - In Controllers:
 * ```typescript
 * @Controller('posts')
 * export class PostController {
 *   constructor(private readonly contentService: ContentService) {}
 *
 *   async getPosts() {
 *     return this.contentService.getPopulatedPosts(req, user);
 *   }
 * }
 * ```
 *
 * ❌ INCORRECT - In PostService:
 * ```typescript
 * @Injectable()
 * export class PostService {
 *   constructor(private readonly contentService: ContentService) {} // CIRCULAR DEPENDENCY!
 * }
 * ```
 */
@Injectable()
export class ContentService {
  constructor(
    private readonly postService: PostService,
    private readonly postSearchService: PostSearchService,
    private readonly postRecommendationService: PostRecommendationService,
    private readonly fileServerService: FileServerService,
    private readonly userService: UserAccountManagementService,
    private readonly socketUserService: SocketUserService,
    private readonly reactionService: ReactionService,
    private readonly followService: FollowService
  ) { }
  /**
   * Find a single post with user reactions populated
   */
  async findPostDetails(id: string | ObjectId, user?: UserDto | AuthUserDto, options?: Partial<IPopulatePostOptions>) {
    // Get the raw post using PostService
    const post = await this.postService.findOne(id);

    if (!post) {
      throw new Error(__t('errors.post_not_found'));
    }

    // Check if post status is active (unless admin, creator owner, or creator deleted)
    // Posts from deleted creators are still accessible so users can view purchased content
    if (!user?.isAdmin && post?.userId?.toString() !== user?._id?.toString()) {
      if (post.status !== 'active' && !post.isCreatorDeleted) {
        throw new Error(__t('errors.post_not_available'));
      }
    }

    // Get creator info to check if creator is deleted
    // A missing creator (hard-deleted) is treated the same as deleted status
    const creator = await this.userService.findById(post.userId);
    const creatorIsDeleted = post.isCreatorDeleted || !creator || (creator as any).status === USER_STATUS.DELETED;

    // Only throw not-found when creator is genuinely missing and post was never flagged as creator-deleted
    if (!creator && !post.isCreatorDeleted) {
      throw new Error(__t('errors.creator_not_found'));
    }

    // Populate the post data with reactions and other related data
    const populatedPosts = await this.populatePostData([post], { user, ...(options || {}) });
    const populatedPost = populatedPosts[0];

    // Add flag to indicate creator is deleted (for frontend to disable interactions)
    if (creatorIsDeleted || post.isCreatorDeleted) {
      (populatedPost as any).isCreatorDeleted = true;
    }

    return populatedPost;
  }

  /**
   * Get posts with populated reaction data
   * This method replaces the cross-service calls that caused circular dependencies
   *
   * @param posts Array of post documents or DTOs
   * @param options Population options including user context
   * @returns Array of populated post DTOs with reaction data
   */
  async populatePostData(
    posts: Array<PostDocument | PostDto | LeanPostDocument>,
    options?: IPopulatePostOptions
  ): Promise<PostDto[]> {
    if (!posts?.length) return [];

    const { user } = options || {};

    // First populate basic post data (creators, files, subscriptions, orders, polls)
    let creatorStrIds = [];
    const postIds = [];
    let fileIds = [];
    posts.forEach((f) => {
      postIds.push(f._id);
      if (f.userId) {
        creatorStrIds.push(f.userId);
      }
      if (f.fileIds && f.fileIds.length) {
        fileIds = uniq(fileIds.concat(f.fileIds.map((id) => id.toString())));
      }
      if (f.thumbnailId) {
        fileIds.push(f.thumbnailId);
      }
      if (f.cover4x3Id) fileIds.push(f.cover4x3Id);
      if (f.cover3x4Id) fileIds.push(f.cover3x4Id);
      if (f.teaserId) {
        fileIds.push(f.teaserId);
      }
    });
    const creatorIds = uniq(creatorStrIds.map((id) => id.toString()));
    const filteredIds = fileIds.filter((f) => !!f);
    const [creators = [], files = [], followedCreatorIds = new Set<string>()] = await Promise.all([
      creatorIds.length ? this.userService.findByIds(creatorIds) : [],
      filteredIds.length ? this.fileServerService.getMultipleFileInfo(filteredIds, false) : [],
      user?._id && creatorIds.length
        ? this.followService.getFollowingCreatorIdSet(user._id, creatorIds)
        : Promise.resolve(new Set<string>())
    ]);

    creators.forEach(creator => {
      creator.isFollowed = user?._id?.toString() !== creator._id.toString()
        && followedCreatorIds.has(creator._id.toString());
    });

    const onlineStatuses = await Promise.all(creators.map(c => this.socketUserService.isUserOnline(c._id)));
    creators.forEach((c, index) => {
      c.isOnline = onlineStatuses[index];
    });

    const populatedPosts = await posts.reduce(async (res, model) => {
      const results = await res;
      const post = PostDto.fromModel(model);
      const creator = post.userId ? creators.find((p) => p._id.toString() === post.userId.toString()) : null;

      if (creator) {
        post.setUser(creator);
      }

      const postFileStringIds = (post.fileIds || []).map((fileId) => fileId.toString());
      const fileArray = (files || []) as FileServerInfoDto[];
      const postFiles = fileArray.filter((file) => postFileStringIds.includes(file._id.toString()));
      await post.setFiles(postFiles);
      if (post.thumbnailId) {
        const thumbnail = fileArray.find((file) => file._id.toString() === post.thumbnailId.toString());
        await post.setThumbnail(thumbnail);
      }
      const cover4x3 = post.cover4x3Id
        ? fileArray.find(file => file._id.toString() === post.cover4x3Id.toString())
        : null;
      const cover3x4 = post.cover3x4Id
        ? fileArray.find(file => file._id.toString() === post.cover3x4Id.toString())
        : null;
      await post.setCovers(cover4x3, cover3x4);
      if (post.teaserId) {
        const teaser = fileArray.find((file) => file._id.toString() === post.teaserId.toString());
        await post.setTeaser(teaser);
      }
      results.push(post);
      return results;
    }, [] as any);

    // If user is logged in, fetch and map their reactions to the posts
    if (user && user._id && populatedPosts.length > 0) {
      const postIds = populatedPosts.map((post) => post._id);
      const reactions = await this.reactionService.findByUserIdAndObjectId(user._id, postIds);

      // Map reactions to posts
      populatedPosts.forEach((post) => {
        const like = reactions.find((r) => r.objectId.toString() === post._id.toString() && r.action === 'like');

        post.setIsLiked(!!like);
      });
    }

    return populatedPosts;
  }

  /**
 * Search posts with user reactions populated
 */
  async userSearchPosts(req: PostSearchRequest, user: UserDto | AuthUserDto, options?: Partial<IPopulatePostOptions>) {
    // Get posts using PostSearchService
    const result = await this.postSearchService.userSearchPosts(req);

    // Populate post data with reactions
    if (result.data.length > 0) {
      const populatedData = await this.populatePostData(result.data, { user, ...options });
      return {
        ...result,
        data: populatedData
      };
    }

    return result;
  }

  async recommendPosts(req: PostRecommendationRequest, user?: UserDto | AuthUserDto, options?: Partial<IPopulatePostOptions>) {
    const result = await this.postRecommendationService.recommend(req, user?._id);
    if (!result.data.length) return result;

    return {
      ...result,
      data: await this.populatePostData(result.data, { user, ...options })
    };
  }

  async getFollowingPosts(req: PostSearchRequest, user: UserDto | AuthUserDto) {
    const creatorIds = await this.followService.getFollowingCreatorIds(user._id);
    if (!creatorIds.length) {
      return {
        data: [], total: 0, hasMore: false, nextCursor: null,
        paginationInfo: { maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET, cursorPaginationAvailable: true }
      };
    }

    (req as any).enhanceQueryUserId = { $in: creatorIds };
    return this.userSearchPosts(req, user);
  }

  /** Return posts liked by the authenticated user in reaction order. */
  async getLikedPosts(req: ReactionSearchRequestPayload, user: UserDto | AuthUserDto) {
    req.createdBy = user._id;
    req.action = 'like';
    req.objectType = 'post';

    const reactionResult = await this.reactionService.search(req);
    if (!reactionResult.data.length) return { ...reactionResult, data: [] };

    const postIds = uniq(reactionResult.data.map((reaction) => reaction.objectId));
    const posts = await this.postService.findByIds(postIds);
    const populatedPosts = await this.populatePostData(posts, { user });
    const postMap = new Map(populatedPosts.map((post) => [post._id.toString(), post]));
    const data = reactionResult.data
      .map((reaction) => postMap.get(reaction.objectId.toString()))
      .filter(Boolean);

    return { ...reactionResult, data };
  }

  /** Remove the current user's likes without toggle semantics. */
  async unlikePosts(postIds: string[], user: UserDto | AuthUserDto): Promise<string[]> {
    return this.reactionService.removeManyPostLikes(postIds, user);
  }

  /**
  * Check if creator has permission to upload/create content
  * Creators must have verified documents to upload content
  *
  * @param user - User attempting to perform content operation
  * @returns Promise<boolean> - true if creator can upload content
  */
  async checkCreatorContentPermission(currentUser: UserDto | AuthUserDto): Promise<boolean> {
    if (currentUser?.isAdmin) return true; // allow admin

    const user = await this.userService.findById(currentUser._id);
    if (!user) return false;
    // Check if creator has verified documents & account
    return user?.status === USER_STATUS.ACTIVE && user?.verifiedEmail;
  }

  /**
   * LIGHTWEIGHT SEARCH FOR CREATORS - No reactions, just basic post data with files
   *
   * This method provides optimized search for creators managing their own posts.
   * It skips expensive reaction/comment queries and focuses on file-related data only.
   *
   * @param req - Search request with filters and pagination
   * @param creator - Creator user context (must be the post owner)
   * @param options - Additional options for population control
   * @returns Promise resolving to paginated search results with lightweight population
   */
  async searchCreatorPosts(req: PostSearchRequest, creator: UserDto | AuthUserDto, options?: Partial<IPopulatePostOptions>) {
    // Overwrite userId with creator ID for filtering
    req.userId = creator._id.toString();
    // Use PostSearchService to handle the search query
    const result = await this.postSearchService.search(req);

    // Use lightweight population - only files, no reactions
    if (result.data.length > 0) {
      const populatedData = await this.populatePostDataLightweight(result.data, { user: creator, ...options });
      return {
        ...result,
        data: populatedData
      };
    }

    return result;
  }

  /**
   * LIGHTWEIGHT POST POPULATION - Files only, no reactions
   *
   * Optimized population method for admin/creator use cases that don't need
   * reaction data, comments, or expensive social features. Focuses only on
   * file attachments, basic post metadata, and polls.
   *
   * @param posts Array of post documents or DTOs
   * @param options Population options
   * @returns Array of posts with files and polls populated
   */
  private async populatePostDataLightweight(
    posts: Array<PostDocument | PostDto>,
    options?: IPopulatePostOptions
  ): Promise<PostDto[]> {
    if (!posts?.length) return [];

    const { user, ip } = options || {};

    // Collect all file IDs and poll IDs that need to be populated
    let fileIds = [];
    const pollIds = [];
    posts.forEach((post) => {
      if (post.fileIds && post.fileIds.length) {
        fileIds = uniq(fileIds.concat(post.fileIds.map((id) => id.toString())));
      }
      if (post.thumbnailId) fileIds.push(post.thumbnailId);
      if (post.cover4x3Id) fileIds.push(post.cover4x3Id);
      if (post.cover3x4Id) fileIds.push(post.cover3x4Id);
      if (post.teaserId) fileIds.push(post.teaserId);
    });

    const uniqueFileIds = uniq(fileIds.filter(id => id));

    // Fetch files and polls in parallel
    const [creators, files] = await Promise.all([
      this.userService.findByIds(posts.map(p => p.userId)),
      uniqueFileIds.length ? this.fileServerService.getMultipleFileInfo(uniqueFileIds, false) : []
    ]);

    const onlineStatuses = await Promise.all(creators.map(c => this.socketUserService.isUserOnline(c._id)));
    creators.forEach((c, index) => {
      c.isOnline = onlineStatuses[index];
    });

    // Create file lookup map for efficient access
    const fileMap = new Map();
    (files as FileServerInfoDto[]).forEach(file => fileMap.set(file._id.toString(), file));

    // Populate posts with files and polls (no reactions)
    return await Promise.all(posts.map(async (post) => {
      const postDto = post instanceof PostDto ? post : PostDto.fromModel(post);

      // Set creator
      const creator = creators.find(c => c?._id?.toString() === post?.userId?.toString());
      if (creator) {
        postDto.setUser(creator);
      }

      // Set files
      if (post.fileIds && post.fileIds.length) {
        const postFiles = post.fileIds
          .map(fileId => fileMap.get(fileId.toString()))
          .filter(file => file);
        await postDto.setFiles(postFiles);
      }

      // Set thumbnail
      if (post.thumbnailId) {
        const thumbnail = fileMap.get(post.thumbnailId.toString());
        if (thumbnail) {
          await postDto.setThumbnail(thumbnail);
        }
      }

      await postDto.setCovers(
        post.cover4x3Id ? fileMap.get(post.cover4x3Id.toString()) : null,
        post.cover3x4Id ? fileMap.get(post.cover3x4Id.toString()) : null
      );

      // Set teaser
      if (post.teaserId) {
        const teaser = fileMap.get(post.teaserId.toString());
        if (teaser) {
          await postDto.setTeaser(teaser);
        }
      }

      return postDto;
    }));
  }
}
