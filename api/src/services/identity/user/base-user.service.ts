import {
  Injectable,
  Logger
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { FILE_REFERENCE_TYPES, USER_STATUS } from 'src/common/constants';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import {
  User
} from 'src/schemas/identity/user';
import { FileServerService } from 'src/services/shared/file-server';
import { __t } from 'src/utils/translation';

const USER_COLLECTION = 'users';

@Injectable()
export class BaseUserService {
  protected readonly logger = new Logger(BaseUserService.name);

  private BaseUserModel: Model<any>;

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<any>,
    protected readonly fileServerService: FileServerService
  ) {
    // Set the default model when BaseUserService is instantiated directly
    // This ensures BaseUserModel is always set before any methods are called
    this.BaseUserModel = this.userModel;
  }

  public async isEmailOrUsernameTaken(payload: { username?: string; email?: string; }): Promise<boolean> {
    const query = { $or: [] };
    if (payload.username) {
      query.$or.push({ username: payload.username.trim().toLowerCase() });
    }
    if (payload.email) {
      query.$or.push({ email: payload.email.toLowerCase() });
    }
    if (query.$or.length === 0) {
      return false;
    }
    const count = await this.getCollection().countDocuments(query);
    return count > 0;
  }

  /**
   * Find user by ID (supports both users and creators)
   *
   * ⚠️ SECURITY CRITICAL: Core user lookup function used across the platform
   *
   * Retrieves a user or creator by their unique identifier. Automatically
   * determines the correct DTO type based on the isCreator flag and returns
   * the appropriate data transfer object.
   *
   * Security Features:
   * - Uses ObjectId conversion for type safety
   * - Returns null for non-existent users (prevents information leakage)
   * - Automatically handles both user and creator account types
   * - Direct database access for optimal performance
   *
   * @param id - User's unique identifier (string or ObjectId)
   * @returns Promise resolving to UserDto, CreatorDto, or null if not found
   * @example
   * ```typescript
   * const user = await baseUserService.findById('507f1f77bcf86cd799439011');
   *
   * if (user) {
   *   if (user instanceof CreatorDto) {
   *     console.log('Found creator:', user.username);
   *   } else {
   *     console.log('Found user:', user.username);
   *   }
   * }
   * ```
   *
   * @security CRITICAL - Core user authentication and authorization
   * @performance Uses direct database collection access for speed
   */
  public async findById(id: string | ObjectId): Promise<UserDto> {
    const user = await this.getCollection().findOne({ _id: toObjectId(id) });
    if (!user) return null;

    return UserDto.fromModel(user);
  }

  public async findByIds(ids: any[]): Promise<Array<UserDto>> {
    if (!ids?.length) return [];
    const objectIds = ids.map((id) => toObjectId(id));
    const items = await this.getCollection().find({ _id: { $in: objectIds } }).toArray();

    return items.map((user) => UserDto.fromModel(user));
  }

  public async getMe(id: string | ObjectId): Promise<UserDto> {
    return this.findById(id);
  }

  public async findByUsernameOrEmail(text: string): Promise<UserDto> {
    if (!text) return null;
    const user = await this.getCollection().findOne({
      $or: [{ username: text.trim().toLowerCase() }, { email: text.toLowerCase() }]
    });
    if (!user) return null;

    return UserDto.fromModel(user);
  }

  /**
   * Soft delete user account (anonymize and mark as deleted)
   *
   * ⚠️ SECURITY CRITICAL: Permanent account deletion with data anonymization
   * ⚠️ DATA PRIVACY: Implements GDPR-compliant soft deletion
   *
   * Performs a soft delete by anonymizing user data while preserving historical
   * records for purchased content, transactions, and platform integrity.
   * This approach maintains referential integrity while protecting user privacy.
   *
   * Deletion Process:
   * 1. Anonymizes username to "deleted-account-{userId}"
   * 2. Anonymizes email to "deleted-email-{userId}@deleted.local"
   * 3. Sets status to DELETED
   * 4. Updates timestamp for audit trail
   * 5. Preserves user ID for historical data integrity
   * 6. Creates deletion metadata for tracking and compliance
   *
   * Data Preservation:
   * - Purchase history remains intact for content access
   * - Transaction records preserved for financial compliance
   * - Content ownership maintained for platform integrity
   * - User ID preserved for foreign key relationships
   *
   * Privacy Protection:
   * - Personal identifiers (username, email) anonymized
   * - Account becomes inaccessible for login
   * - Profile information anonymized
   * - Maintains compliance with data protection regulations
   *
   * Audit Trail:
   * - Original data stored in metadata for compliance
   * - Deletion timestamp and admin tracking
   * - IP address and reason logging
   *
   * @param id - User ID to delete
   * @param deletedBy - Admin user ID performing the deletion (optional)
   * @param reason - Reason for deletion (optional)
   * @param deletionIp - IP address from which deletion was performed (optional)
   * @returns Promise resolving to deletion success status
   * @example
   * ```typescript
   * const deleted = await baseUserService.deleteUser(
   *   '507f1f77bcf86cd799439011',
   *   adminUserId,
   *   'User requested account deletion',
   *   '192.168.1.1'
   * );
   * if (deleted) {
   *   console.log('User account successfully deleted and anonymized');
   * }
   * ```
   *
   * @security CRITICAL - Permanent account deletion
   * @privacy GDPR compliant soft deletion with anonymization
   * @audit Maintains comprehensive audit trail with metadata
   */
  public async deleteUser(
    id: string | ObjectId,
    deletedBy?: string | ObjectId,
    reason?: string,
    deletionIp?: string
  ): Promise<boolean> {
    const userId = toObjectId(id);
    const user = await this.getCollection().findOne({ _id: userId });

    if (!user) {
      return false;
    }

    // Check if already deleted
    if (user.status === USER_STATUS.DELETED) {
      return true;
    }

    // Create deletion metadata for audit trail and compliance
    const deletionMetadata = {
      deletion: {
        deletedAt: new Date(),
        deletedBy: deletedBy ? toObjectId(deletedBy) : null,
        originalUsername: user.username,
        originalEmail: user.email,
        originalName: user.name,
        reason: reason || 'Admin deletion',
        deletionIp: deletionIp || null
      },
      // Preserve existing metadata if any
      ...user.metadata
    };

    // Anonymize user data while preserving ID for referential integrity
    const anonymizedData = {
      username: `deleted-account-${userId.toString()}`,
      email: `deleted-email-${userId.toString()}@deleted.local`,
      status: USER_STATUS.DELETED,
      updatedAt: new Date(),
      // Clear sensitive personal data
      name: 'Deleted User',
      firstName: 'Deleted',
      lastName: 'User',
      avatar: null,
      avatarId: null,
      // Mark as offline immediately — deleted accounts must not appear Online
      isOnline: false,
      onlineAt: null,
      offlineAt: new Date(),
      // Add deletion metadata for tracking and compliance
      metadata: deletionMetadata
    };

    await this.getCollection().updateOne(
      { _id: userId },
      { $set: anonymizedData }
    );

    return true;
  }

  public async updateAvatar(user: UserDto | AuthUserDto, file: Record<string, any>): Promise<void> {
    const userId = toObjectId(user._id);
    const currentUser = await this.getCollection().findOne(
      { _id: userId },
      { projection: { avatarId: 1 } }
    );
    const previousAvatarId = currentUser?.avatarId?.toString();
    const nextAvatarId = file._id?.toString();

    await this.getCollection().updateOne(
      { _id: userId },
      {
        $set: {
          avatarId: file._id,
          avatar: file.url
        }
      }
    );

    if (!previousAvatarId || previousAvatarId === nextAvatarId) {
      return;
    }

    try {
      await this.fileServerService.deleteManyByIds([previousAvatarId]);
    } catch (error) {
      this.logger.warn(`Failed to delete replaced user avatar ${previousAvatarId}: ${error.message}`);
    }
  }

  /**
     * Update creator cover image
     *
     * ⚠️ MISSING FEATURE: No cleanup of previous cover image
     * RECOMMENDATION: Add cleanup of old cover image like in updateWelcomeVideo()
     *
     * Updates a creator's profile cover image with proper file reference management.
     * The cover image is displayed prominently on the creator's profile page.
     *
     * File Management:
     * - Updates creator record with new cover image references
     * - Adds file reference for ownership tracking
     * - Links file to creator for cleanup management
     * - Does NOT remove previous cover image (potential issue)
     *
     * @param user Creator updating their cover image
     * @param file New cover image file
     * @returns Promise resolving to the uploaded file
     * @example
     * ```typescript
     * const coverFile = await fileServerService.upload(coverImageData);
     * await creatorProfileService.updateCover(creator, coverFile);
     * ```
     *
     * @media Manages creator profile cover image
     * @file Handles file reference management and ownership
     * @todo Add cleanup of previous cover image to prevent storage bloat
     */
  public async updateCover(user: UserDto | AuthUserDto, file: Record<string, any>) {
    const userId = toObjectId(user._id);

    const currentUser = await this.getCollection().findOne(
      { _id: userId },
      { projection: { coverId: 1 } }
    );
    const previousCoverId = currentUser?.coverId?.toString();
    const nextCoverId = file._id?.toString();
    const coverBgColor = file.metadata?.coverBgColor;

    await this.getCollection().updateOne(
      { _id: userId },
      {
        $set: {
          coverId: file._id,
          cover: file.url,
          coverBgColor
        }
      }
    );

    await this.fileServerService.updateFileOwnership({
      fileIds: [file._id],
      createdBy: user._id,
      ref: {
        itemId: user._id,
        itemType: FILE_REFERENCE_TYPES.USER
      }
    });

    if (!previousCoverId || previousCoverId === nextCoverId) {
      return;
    }

    try {
      await this.fileServerService.deleteManyByIds([previousCoverId]);
    } catch (error) {
      this.logger.warn(`Failed to delete replaced user cover ${previousCoverId}: ${error.message}`);
    }

    return file;
  }

  /**
   * Get MongoDB collection for user operations
   *
   * Uses the injected Mongoose model's database connection to access the users collection.
   * This ensures we're using the properly configured connection with connection pooling,
   * retry logic, and all the settings from MongooseModule.forRootAsync().
   *
   * @returns MongoDB collection instance
   * @throws Error if BaseUserModel is not initialized (should never happen after constructor)
   */
  private getCollection() {
    if (!this.BaseUserModel) {
      throw new Error(__t('errors.base_model_not_initialized'));
    }

    if (!this.BaseUserModel.db) {
      throw new Error(__t('errors.no_database_connection'));
    }

    return this.BaseUserModel.db.collection(USER_COLLECTION);
  }
}
