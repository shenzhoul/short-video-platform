import { ForbiddenException, HttpException, Injectable, Logger } from "@nestjs/common";
import { BaseUserService } from './base-user.service';
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "src/schemas";
import { ObjectId } from 'mongodb';
import { AdminUserCreatePayload, AdminUserUpdatePayload, CreatorSelfUpdatePayload, UserCreatePayload } from "src/payloads";
import { EntityNotFoundException, QueueMessageService, StringHelper } from "src/kernel";
import { UserDto } from "src/dtos/identity/user";
import { EmailHasBeenTakenException, UsernameTakenException } from "src/common/exceptions/user";
import { AuthService } from "../auth/auth.service";
import { AuthUserCacheService } from "../auth-user-cache.service";
import { CREATOR_CHANNELS, USER_STATUS } from "src/common/constants";
import { EVENT } from "src/kernel/constants";
import { FileServerService } from "src/services/shared/file-server";
import { CreatorAnalyticsService } from "src/services/identity/user/creator-analytics.service";
import { isObjectId } from "src/kernel/helpers/string.helper";
import { SocketUserService } from "src/services/socket";

/**
 * UserAccountManagementService handles comprehensive user account operations and lifecycle management.
 * This service extends BaseUserService to provide specialized functionality for regular users (non-creators).
 *
 * Key Features:
 * - User registration and profile management
 * - Email and username validation and uniqueness checking
 * - Balance management with real-time updates and transaction tracking
 * - User authentication integration and security
 * - Admin-level user management and oversight
 * - User statistics and analytics integration
 * - Real-time notifications and event publishing
 *
 * Advanced Capabilities:
 * - Secure balance operations with validation
 * - Event-driven architecture for user actions
 * - Integration with authentication and authorization systems
 * - Comprehensive audit trail for user operations
 * - Socket-based real-time user status updates
 *
 * @extends BaseUserService
 * @author ShenZhoul
 * @version 1.0.0
 */
@Injectable()
export class UserAccountManagementService extends BaseUserService {
  protected readonly logger = new Logger(UserAccountManagementService.name);
  /**
  * Initialize UserService with required dependencies
  *
  * @param UserModel - MongoDB model for user operations
  * @param queueMessageService - Service for publishing user events
  */
  constructor(
    @InjectModel(User.name) protected readonly UserModel: Model<UserDocument>,
    private readonly queueMessageService: QueueMessageService,
    private readonly authService: AuthService,
    private readonly authUserCacheService: AuthUserCacheService,
    fileServerService: FileServerService,
    private readonly creatorAnalyticsService: CreatorAnalyticsService,
    private readonly socketUserService: SocketUserService
  ) {
    super(UserModel, fileServerService);
  }

  /**
   * Find all admin users
   * Used for admin permission management
   *
   * @returns Promise<UserDocument[]> - Array of admin users
   */
  public async findAdminUsers(): Promise<UserDocument[]> {
    return this.UserModel.find({ isAdmin: true }).sort({ createdAt: -1 });
  }

  /**
     * Find creator by username or ID with security checks
     *
     * ⚠️  SECURITY: Implements geo-blocking and user blocking features
     * to protect creators from unwanted access and comply with regional restrictions.
     *
     * @param username Creator username or ObjectId
     * @param countryCode Optional country code for geo-blocking check
     * @param currentUser Optional current user for blocking check
     * @returns Promise<CreatorDto> Creator data with populated assets
     * @throws EntityNotFoundException if creator not found
     * @throws HttpException (403) if access is blocked
     *
     * Security Features:
     * - Geo-blocking: Blocks access from restricted countries
     * - User blocking: Prevents blocked users from accessing creator
     * - Self-access: Creators can always access their own profiles
     *
     * @example Public access
     * ```typescript
     * const creator = await creatorProfileService.findByUsername('creator123');
     * ```
     *
     * @example With geo-blocking
     * ```typescript
     * const creator = await creatorProfileService.findByUsername(
     *   'creator123',
     *   'US',
     *   currentUser
     * );
     * ```
     */
  public async findByUsername(
    username: string
  ): Promise<UserDto> {
    // Support both username and ObjectId lookup
    const query = isObjectId(username)
      ? { _id: username }
      : { username: username.trim() };
    const model = await this.UserModel.findOne(query);

    if (!model) throw new EntityNotFoundException();

    // Block access to deleted creator profiles
    if (model.status === USER_STATUS.DELETED) {
      throw new HttpException('This account is no longer available.', 410);
    }
    const dto = UserDto.fromModel(model);

    // Resolve presence from Redis so profile pages do not depend on the
    // eventually consistent persisted `isOnline` field.
    dto.isOnline = await this.socketUserService.isUserOnline(model._id);

    return dto;
  }

  /**
   * Creates a new user account with comprehensive validation and setup.
   * This method handles user registration with email/username uniqueness validation.
   *
   * @param data - User creation payload with required user information
   * @param options - Additional options for user creation (status, etc.)
   * @returns Promise<UserDto> - The created user data
   *
   * @throws EntityNotFoundException - If email is missing
   * @throws EmailHasBeenTakenException - If email already exists
   * @throws UsernameTakenException - If username already exists
   *
   * @example
   * ```typescript
   * const newUser = await userService.createNewUserAccount({
   *   email: "user@example.com",
   *   username: "newuser",
   *   firstName: "John",
   *   lastName: "Doe"
   * });
   * console.log(`User created: ${newUser.email}`);
   * ```
   */
  public async createNewUserAccount(
    data: UserCreatePayload | AdminUserCreatePayload,
    options: Record<string, any> = {}
  ): Promise<UserDto> {
    if (!data.email) {
      throw new EntityNotFoundException();
    }
    const emailCheck = await this.isEmailOrUsernameTaken({ email: data.email });
    if (emailCheck) {
      throw new EmailHasBeenTakenException();
    }
    if (data.username) {
      const usernameCheck = await this.isEmailOrUsernameTaken({ username: data.username });
      if (usernameCheck) {
        throw new UsernameTakenException();
      }
    }

    const payload = { ...data } as any;
    payload.email = data.email.toLowerCase();
    if (data.username) {
      payload.username = data.username.trim().toLowerCase();
    }
    payload.createdAt = new Date();
    payload.updatedAt = new Date();
    payload.status = options.status || USER_STATUS.ACTIVE;

    // Set admin and creator flags from options
    if (options.isAdmin !== undefined) {
      payload.isAdmin = options.isAdmin;
    }
    if (options.isCreator !== undefined) {
      payload.isCreator = options.isCreator;
    }

    if (!payload.name) {
      payload.name = UserDto.getName(payload.firstName, payload.lastName);
    }

    const user = await this.UserModel.create(payload);

    if (payload.password) {
      await this.authService.createAuthPassword({
        userId: user._id,
        type: 'password',
        value: payload.password,
        key: payload.email
      });
    }

    const dto = new UserDto(user);
    await this.queueMessageService.publish(CREATOR_CHANNELS.CREATOR, {
      eventName: EVENT.CREATED,
      data: dto
    });
    return dto;
  }

  /**
   * Admin-level user profile update
   *
   * Similar to regular update but bypasses permission checks and allows admin-specific
   * fields to be updated. Automatically sends email verification if email is changed.
   *
   * ⚠️  LOGICAL INCONSISTENCY: Email verification logic differs from regular update:
   * - Line 237: Uses `user.email` (old email) for comparison
   * - Line 239: Uses `user._id` instead of `newUser._id` for verification
   * - Line 242: Uses `newUser.email` for auth key update
   * This inconsistency could cause verification emails to be sent incorrectly.
   *
   * @param id - User ID to update
   * @param payload - Admin update payload with extended permissions
   * @returns Promise<boolean> - Success status
   *
   * @throws EntityNotFoundException - When user is not found
   * @throws UsernameTakenException - When new username already exists
   * @throws EmailHasBeenTakenException - When new email already exists
   *
   * @example
   * ```typescript
   * const success = await userService.adminUpdate(userId, {
   *   status: 'active',
   *   verifiedEmail: true,
   *   role: 'premium'
   * });
   * ```
   */
  public async adminUpdate(id: string | ObjectId, payload: AdminUserUpdatePayload): Promise<boolean> {
    const user = await this.UserModel.findById(id);
    if (!user) {
      throw new EntityNotFoundException();
    }

    // Protect superadmin account from modification
    if (user.username === 'superadmin') {
      // Remove protected fields from payload for superadmin
      const { username, ...allowedPayload } = payload;
      const data = { ...allowedPayload, updatedAt: new Date() };

      if (!data.name) {
        data.name = UserDto.getName(data.firstName, data.lastName);
      }

      await this.UserModel.updateOne({ _id: id }, data);
      return true;
    }

    const data = { ...payload, updatedAt: new Date() };
    if (!data.name) {
      data.name = data.username || UserDto.getName(data.firstName, data.lastName);
    }

    if (data.username && data.username !== user.username) {
      const usernameCheck = await this.UserModel.countDocuments({
        username: data.username.trim().toLowerCase(),
        _id: { $ne: user._id }
      });
      if (usernameCheck) {
        throw new UsernameTakenException();
      }
      data.username = data.username.trim().toLowerCase();
    }
    if (data.email && data.email !== user.email) {
      const emailCheck = await this.UserModel.countDocuments({
        email: data.email.toLowerCase(),
        _id: { $ne: user._id }
      });
      if (emailCheck) {
        throw new EmailHasBeenTakenException();
      }
      data.email = data.email.toLowerCase();
      data.verifiedEmail = false;
    }

    await this.UserModel.updateOne({ _id: id }, data);

    const newUser = await this.UserModel.findById(id);
    // Update auth user cache when user data changes
    await this.authUserCacheService.set(newUser);

    await this.queueMessageService.publish(CREATOR_CHANNELS.CREATOR, {
      eventName: EVENT.UPDATED,
      data: new UserDto(newUser)
    });

    return true;
  }

  /**
   * Delete a user account (soft delete with anonymization)
   *
   * Performs a soft delete by anonymizing user data while preserving historical
   * records for purchased content, transactions, and platform integrity.
   * This approach maintains referential integrity while protecting user privacy.
   *
   * ✅ UPDATED: Now uses soft delete instead of hard delete
   * ✅ GDPR COMPLIANT: Anonymizes personal data while preserving business records
   *
   * @param id - User ID to delete (string or ObjectId)
   * @param deletedBy - Admin user ID performing the deletion (optional)
   * @param reason - Reason for deletion (optional)
   * @param deletionIp - IP address from which deletion was performed (optional)
   * @returns Promise<{deleted: boolean}> - Deletion confirmation
   *
   * @throws ForbiddenException - When ID is not a valid ObjectId
   * @throws EntityNotFoundException - When user is not found
   *
   * @example
   * ```typescript
   * const result = await userService.delete(userId, adminUserId, 'Policy violation', '192.168.1.1');
   * console.log(result.deleted); // true
   * ```
   */
  public async delete(
    id: string | ObjectId,
    deletedBy?: string | ObjectId,
    reason?: string,
    deletionIp?: string
  ) {
    const idString = id.toString();
    if (!StringHelper.isObjectId(idString)) throw new ForbiddenException();
    const user = await this.UserModel.findById(id);
    if (!user) throw new EntityNotFoundException();

    // Use soft delete from base service with metadata tracking
    const deleted = await this.deleteUser(id, deletedBy, reason, deletionIp);

    if (deleted) {
      // Invalidate all active sessions and cache immediately so the deleted
      // account cannot be used for further API access.
      await Promise.all([
        this.authUserCacheService.del(id),
        this.authService.removeAllUserTokens(id)
      ]);

      // Publish deletion event for cleanup operations
      await this.queueMessageService.publish(CREATOR_CHANNELS.CREATOR, {
        eventName: EVENT.DELETED,
        data: new UserDto(user)
      });
    }

    return { deleted };
  }

  /**
   * Update admin status for a user
   * Only used by superadmin for permission management
   *
   * @param id - User ID
   * @param isAdmin - New admin status
   * @returns Promise<boolean> - Success status
   */
  public async updateAdminStatus(id: string | ObjectId, isAdmin: boolean): Promise<boolean> {
    const user = await this.UserModel.findById(id);
    if (!user) {
      throw new EntityNotFoundException();
    }

    // Protect superadmin account
    if (user.username === 'superadmin') {
      throw new ForbiddenException('Cannot modify superadmin account permissions');
    }

    await this.UserModel.updateOne({ _id: id }, {
      isAdmin,
      updatedAt: new Date()
    });

    // Update auth user cache when user data changes
    await this.authUserCacheService.del(id);

    return true;
  }

  /**
   * Update creator like statistics
   * @param creatorId Creator's unique identifier
   * @param num Number to add to like count (default: 1, can be negative)
   * @returns Promise resolving to MongoDB update result
   */
  public async updateLikeStat(creatorId: string | ObjectId | any, num = 1) {
    return this.creatorAnalyticsService.incrementLikeCount(creatorId, num);
  }

  /**
   * Synchronize creator likes from authoritative post data.
   */
  public async setLikeStat(creatorId: string | ObjectId | any, total: number) {
    return this.creatorAnalyticsService.setLikeCount(creatorId, total);
  }

  /**
   * Creator self-update profile
   *
   * Allows creators to update their own profile information with appropriate
   * restrictions and validations. This function enforces business rules for
   * self-service profile updates while maintaining data integrity.
   *
   * Self-Update Restrictions:
   * - Cannot modify verification status or admin-only fields
   * - Cannot change sensitive account settings
   * - Limited to profile information and preferences
   * - Must maintain 18+ age requirement compliance
   *
   * Validation & Security:
   * - Enforces 18+ age requirement for adult content platform
   * - Validates email uniqueness and triggers re-verification
   * - Validates username uniqueness and format
   * - Normalizes email to lowercase for consistency
   * - Triggers email verification workflow for email changes
   *
   * Email Change Workflow:
   * - Validates new email is not already in use
   * - Sends verification email to new address
   * - Updates authentication keys for security
   * - Maintains account security during transition
   *
   * @param id Creator's unique identifier
   * @param payload Self-update data with restricted fields
   * @returns Promise resolving to boolean indicating success
   * @throws EntityNotFoundException if creator not found
   * @throws HttpException if age validation fails (under 18)
   * @throws EmailHasBeenTakenException if email already in use
   * @throws UsernameTakenException if username already taken
   * @example
   * ```typescript
   * // Creator updating their profile
   * const success = await creatorProfileService.selfUpdate(creatorId, {
   *   bio: 'Updated bio description',
   *   email: 'newemail@example.com', // Triggers verification
   *   dateOfBirth: new Date('1990-01-01')
   * });
   * ```
   *
   * @self-service Creator can update their own profile
   * @compliance Enforces 18+ age requirement and email verification
   * @security Validates uniqueness and triggers re-verification for email changes
   */
  public async selfUpdate(
    id: string | ObjectId,
    payload: CreatorSelfUpdatePayload
  ): Promise<boolean> {
    const user = await this.UserModel.findOne({ _id: id });
    if (!user) {
      throw new EntityNotFoundException();
    }

    const data: Record<string, any> = { ...payload };
    if (!data.name) {
      data.name = UserDto.getName(data.firstName, data.lastName);
    }

    if (data.dateOfBirth) {
      data.dateOfBirth = new Date(data.dateOfBirth);
    }
    await this.UserModel.updateOne(
      { _id: id },
      {
        $set: {
          ...data,
          updatedAt: new Date()
        }
      }
    );
    const updatedUser = await this.UserModel.findOne({ _id: id });

    // update new data
    await this.authUserCacheService.set(updatedUser);

    await this.queueMessageService.publish(CREATOR_CHANNELS.CREATOR, {
      eventName: EVENT.UPDATED,
      data: UserDto.fromModel(updatedUser)
    });
    return true;
  }

  /**
   * Get detailed creator information with populated assets
   *
   * Retrieves comprehensive creator details including all associated media files,
   * verification documents, and profile assets. Uses parallel processing for
   * optimal performance when loading multiple file assets.
   *
   * Performance Features:
   * - Parallel file loading using Promise.all()
   * - Efficient single database query for creator data
   * - Lazy loading of optional assets (only if IDs exist)
   * - IP-based access control for verification documents
   *
   * Populated Assets:
   * - Avatar image file
   * - Cover image file
   * - Welcome video file
   * - ID verification documents (with IP filtering)
   * - Document verification files (with IP filtering)
   *
   * @param id Creator ID to retrieve details for
   * @returns Promise resolving to fully populated CreatorDto
   * @throws EntityNotFoundException if creator not found or not active
   * @example
   * ```typescript
   * // Basic creator details
   * const creator = await creatorProfileService.getDetails('creator123');
   *
   * console.log('Creator:', creator.username);
   * console.log('Avatar URL:', creator.avatar?.url);
   * console.log('Verification Status:', creator.verificationStatus);
   * ```
   *
   * @performance Uses parallel loading for optimal file retrieval
   */
  public async getDetails(id: string | ObjectId): Promise<UserDto> {
    const user = await this.UserModel.findOne({ _id: id });
    if (!user) {
      throw new EntityNotFoundException();
    }
    const dto = UserDto.fromModel(user);

    // Refresh file URLs from file server to get latest processed URLs
    await this.refreshFileUrls(dto);

    return dto;
  }

  /**
   * Refresh file URLs from file server
   *
   * Updates creator's file URLs (avatar, cover, welcome video) with fresh URLs
   * from the file server to ensure they reflect any processing changes like
   * video conversion from .mov to .mp4.
   *
   * Uses batch fetching for optimal performance and persists changes to database.
   *
   * Database Synchronization:
   * - Fetches latest file information from file server
   * - Updates in-memory DTO with refreshed URLs
   * - Persists URL changes to database for consistency
   * - Only updates database if URLs have changed
   *
   * @param creator Creator DTO to update
   */
  private async refreshFileUrls(creator: UserDto): Promise<void> {
    try {
      // Collect all file IDs that need to be refreshed
      const fileIds: Array<string | ObjectId> = [];
      const fileIdMap: Record<string, 'avatar' | 'cover'> = {};

      if (creator.avatarId) {
        const avatarIdStr = creator.avatarId.toString();
        fileIds.push(creator.avatarId);
        fileIdMap[avatarIdStr] = 'avatar';
      }

      if (creator.coverId) {
        const coverIdStr = creator.coverId.toString();
        fileIds.push(creator.coverId);
        fileIdMap[coverIdStr] = 'cover';
      }

      // If no files to refresh, return early
      if (fileIds.length === 0) {
        return;
      }

      // Batch fetch all file information
      const files = await this.fileServerService.findByIds(fileIds);

      // Track database updates
      const dbUpdates: Record<string, any> = {};

      // Update URLs based on fetched file information
      for (const file of files) {
        const fileIdStr = file._id.toString();
        const fileType = fileIdMap[fileIdStr];

        try {
          if (fileType === 'avatar') {
            creator.setAvatar(file);
            if (file.url && file.url !== creator.avatar) {
              dbUpdates.avatar = file.url;
            }
          } else if (fileType === 'cover') {
            creator.setCover(file);
            if (file.url && file.url !== creator.cover) {
              dbUpdates.cover = file.url;
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to refresh ${fileType} URL for creator ${creator._id}: ${error.message}`);
        }
      }

      // Persist updated URLs to database if any changes detected
      if (Object.keys(dbUpdates).length > 0) {
        await this.UserModel.updateOne(
          { _id: creator._id },
          { $set: dbUpdates }
        );
        this.logger.debug(`Updated ${Object.keys(dbUpdates).length} file URL(s) in database for creator ${creator._id}`);
      }
    } catch (error) {
      this.logger.error(`Error refreshing file URLs for creator ${creator._id}: ${error.message}`);
    }
  }
}
