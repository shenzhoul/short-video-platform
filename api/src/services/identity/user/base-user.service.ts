import {
  Injectable,
  Logger
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { FILE_REFERENCE_TYPES, USER_STATUS } from 'src/common/constants';
import {
  ProfileImageNotAttachableException,
  ProfileImageNotFoundException,
  ProfileImageNotOwnedException,
  ProfileImageNotReadyException,
  ProfileImageWrongTypeException
} from 'src/common/exceptions/user';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { EntityNotFoundException } from 'src/kernel';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import {
  User
} from 'src/schemas/identity/user';
import { FileServerService } from 'src/services/shared/file-server';
import { __t } from 'src/utils/translation';

const USER_COLLECTION = 'users';

/**
 * The two durable upload types that may become a profile image, and the only
 * values `resolveProfileImage` will accept for each field.
 */
type ProfileImageType = 'avatar' | 'cover';

/**
 * `createdBy` stamped on anything uploaded while authenticated as an admin.
 * See `identity-file.controller.ts` — an admin setting somebody else's avatar
 * produces a file owned by this string rather than by the profile's owner.
 */
const ADMIN_UPLOAD_OWNER = 'admin';

/**
 * Callers may pass a file id or a whole file record; the service refetches the
 * record either way, because only the file server's copy is evidence.
 */
function readFileId(fileOrId: string | ObjectId | Record<string, any>): string | ObjectId {
  if (fileOrId && typeof fileOrId === 'object' && '_id' in fileOrId) {
    return (fileOrId as Record<string, any>)._id;
  }
  return fileOrId as string | ObjectId;
}

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

    // The avatar pointer is cleared above, so its file would otherwise keep a
    // reference no profile uses — the one state the sweeper can never collect
    // and the audit script has to report. Released here instead. Best effort:
    // the account is already anonymised and a storage failure must not undo it,
    // and `scripts/audit-profile-image-refs.js` catches whatever is left.
    if (user.avatarId) {
      await this.releaseProfileImage(userId, toObjectId(user.avatarId));
    }

    return true;
  }

  /**
   * Re-check an offered profile image against the record the file server wrote.
   *
   * Nothing here is taken from the request. The uploader chooses the filename,
   * the declared MIME type and the metadata, and image processing normalises
   * much of that away — the durable `type` on the record is the only statement
   * about what an upload was *for*, and `createdBy` the only statement about who
   * made it. The controller-level ownership check stays where it is; this is the
   * check that cannot be skipped by adding a fourth caller.
   *
   * @param fileId File server id offered by the caller
   * @param targetUserId The profile the image would be attached to
   * @param expectedType `avatar` or `cover` — the durable upload type required
   * @param actor Who is performing the change; only an admin may attach a file
   *   the admin tooling uploaded (`createdBy: 'admin'`) to somebody's profile
   */
  private async resolveProfileImage(
    fileId: string | ObjectId,
    targetUserId: ObjectId,
    expectedType: ProfileImageType,
    actor?: UserDto | AuthUserDto
  ): Promise<Record<string, any>> {
    const [file] = await this.fileServerService.findByIds([fileId as any]);
    if (!file) throw new ProfileImageNotFoundException();

    // An `avatar` may only become an avatar and a `cover` only a cover. They
    // carry different size and pixel limits and different processing, so
    // accepting one for the other publishes an image nothing validated for the
    // place it is being shown.
    if (file.type !== expectedType) {
      throw new ProfileImageWrongTypeException();
    }

    const createdBy = file.createdBy?.toString();
    const isOwnedByTarget = createdBy === targetUserId.toString();
    // `identity-file.controller.ts` stamps `createdBy: 'admin'` on anything an
    // admin uploads, including an avatar an admin is setting for someone else.
    // That is the only way a profile image legitimately belongs to a string
    // rather than to the profile's owner, and only an admin may spend one.
    const isAdminUpload = createdBy === ADMIN_UPLOAD_OWNER && !!actor?.isAdmin;
    if (!isOwnedByTarget && !isAdminUpload) {
      throw new ProfileImageNotOwnedException();
    }

    // Already claimed by a different profile. Re-offering the image a profile
    // already uses is allowed and idempotent; taking one out of somebody else's
    // profile is not, and would leave that profile pointing at a file this
    // request is about to delete.
    const claimedElsewhere = (file.refItems || []).some(
      (ref: any) => ref?.itemId?.toString() !== targetUserId.toString()
    );
    if (claimedElsewhere) {
      throw new ProfileImageNotOwnedException();
    }

    // The record survives a failed decode, and an upload still in the queue has
    // no dimensions yet. Either way the profile would point at an image that was
    // never produced, which renders as a broken picture for every viewer.
    const status = (file as any).status;
    const processing = (file as any).processingStatus;
    if (status === 'error' || (file as any).processingError) {
      throw new ProfileImageNotReadyException();
    }
    if (processing && !['completed', 'skipped'].includes(processing)) {
      throw new ProfileImageNotReadyException();
    }

    return file;
  }

  /**
   * Claim a profile image for its owner before the profile points at it.
   *
   * `cleanup-unused-files.job.ts` decides what is abandoned purely from
   * `refItems`, so the order here is the whole point. Pointing the user
   * document at the file first leaves a window in which the profile is live but
   * the image is unreferenced: a crash in that window publishes an avatar the
   * sweeper deletes within hours, and the profile is left serving a URL whose
   * bytes are gone. Referencing first inverts the failure into a leaked file
   * nobody sees, which `scripts/audit-profile-image-refs.js` reclaims.
   *
   * Ownership is transferred in the same call so an admin setting a user's
   * avatar leaves the file owned by that user rather than by the admin.
   *
   * @param userId Owner of the profile the image is being attached to
   * @param fileId File server id of the avatar or cover being attached
   * @throws ProfileImageNotAttachableException when no file record matched
   */
  private async attachProfileImageReference(
    userId: ObjectId,
    fileId: ObjectId
  ): Promise<void> {
    const result = await this.fileServerService.updateFileOwnership({
      fileIds: [fileId],
      createdBy: userId.toString(),
      ref: {
        itemId: userId,
        itemType: FILE_REFERENCE_TYPES.USER
      }
    });

    // The ownership update always writes `updatedAt`, so a matched record always
    // reports as updated. Zero means nothing matched — a missing or already
    // deleted file — and that file will never carry a reference.
    if (!result?.updated) {
      throw new ProfileImageNotAttachableException();
    }
  }

  /**
   * Undo a claim whose operation could not be completed.
   *
   * Reference first, bytes second, and the order matters even here: if the
   * delete fails, an unreferenced file is exactly what the sweeper collects, so
   * the worst case degrades into the normal cleanup path instead of a permanent
   * orphan. Neither step may throw — this runs while another failure is already
   * being reported, and replacing that error with this one would hide what
   * actually went wrong.
   */
  private async releaseProfileImage(userId: ObjectId, fileId: ObjectId): Promise<void> {
    try {
      await this.fileServerService.removeRef(fileId, {
        itemId: userId,
        itemType: FILE_REFERENCE_TYPES.USER
      });
    } catch (error) {
      this.logger.error(
        `Failed to release reference on profile image ${fileId} for user ${userId}: ${error.message}`
      );
    }

    try {
      await this.fileServerService.deleteManyByIds([fileId]);
    } catch (error) {
      // Left for the sweeper: the reference above is gone, so the file is
      // already in the state that makes it collectable.
      this.logger.warn(
        `Failed to delete unused profile image ${fileId} for user ${userId}: ${error.message}`
      );
    }
  }

  /**
   * Retire the image a swap replaced.
   *
   * Best effort by design. The profile is already correct at this point and must
   * not be rolled back for a storage failure, so every outcome here is either
   * success or something the audit script and the sweeper finish later:
   * dropping the reference alone is enough to make the file collectable.
   *
   * The re-read is not redundant with the swap's own before-value. Two requests
   * changing the same profile interleave, and a file can be a user's avatar and
   * cover at once — this is the check that makes "never delete the image a
   * profile is currently serving" true rather than merely likely.
   */
  private async retireReplacedProfileImage(userId: ObjectId, previousFileId: ObjectId): Promise<void> {
    const current = await this.getCollection().findOne(
      { _id: userId },
      { projection: { avatarId: 1, coverId: 1 } }
    );

    const stillInUse = [current?.avatarId, current?.coverId]
      .filter(Boolean)
      .some((id: any) => id.toString() === previousFileId.toString());
    if (stillInUse) return;

    await this.releaseProfileImage(userId, previousFileId);
  }

  /**
   * The one write path for both profile images.
   *
   * ```text
   * validate the file → claim it → atomically swap the pointer → retire the old
   * ```
   *
   * There is no shared transaction between the user document and the file
   * server, so each step is ordered so that its failure lands somewhere
   * recoverable:
   *
   *  - **Validation fails** — nothing has happened.
   *  - **Claim fails** — nothing has happened; the file stays unreferenced and
   *    the sweeper collects it.
   *  - **Swap fails** — the claim is released and the new file deleted. The
   *    profile and the image it was already showing are untouched.
   *  - **Retiring the old file fails** — the profile keeps the new image, which
   *    is correct and published. The old file is left for the audit script and
   *    the sweeper; it is never a reason to roll a good profile back.
   *
   * The swap is a single `findOneAndUpdate`, and the file it replaced is read
   * from *that operation's* before-image rather than from a separate read. This
   * is what makes concurrent replacements safe: two requests each retire exactly
   * the image they displaced, so the last writer's image survives with its
   * reference and every loser is cleaned up. A pre-read would have both requests
   * believe they replaced the same original, leaving the intermediate file
   * referenced and uncollectable forever.
   */
  private async applyProfileImage(
    user: UserDto | AuthUserDto,
    fileId: string | ObjectId,
    config: {
      type: ProfileImageType;
      idField: 'avatarId' | 'coverId';
      urlField: 'avatar' | 'cover';
      actor?: UserDto | AuthUserDto;
    }
  ): Promise<Record<string, any>> {
    const userId = toObjectId(user._id);
    const file = await this.resolveProfileImage(fileId, userId, config.type, config.actor || user);
    const nextFileId = toObjectId(file._id);

    await this.attachProfileImageReference(userId, nextFileId);

    const update: Record<string, any> = {
      [config.idField]: nextFileId,
      [config.urlField]: file.url
    };
    // Only the cover carries a derived background colour, and only when image
    // processing produced one.
    if (config.type === 'cover') {
      update.coverBgColor = (file as any).metadata?.coverBgColor;
    }

    let previous: Record<string, any> | null;
    try {
      previous = await this.swapProfileImagePointer(userId, update);
    } catch (error) {
      await this.releaseProfileImage(userId, nextFileId);
      throw error;
    }

    // The user vanished between the claim and the swap. Nothing points at the
    // file and nothing ever will.
    if (!previous) {
      await this.releaseProfileImage(userId, nextFileId);
      throw new EntityNotFoundException(__t('errors.user_not_found'));
    }

    const previousFileId = previous[config.idField];
    if (previousFileId && previousFileId.toString() !== nextFileId.toString()) {
      await this.retireReplacedProfileImage(userId, toObjectId(previousFileId));
    }

    return file;
  }

  /**
   * Swap one profile image pointer and return the document as it was before.
   *
   * `findOneAndUpdate` is atomic per document, so the before-image names exactly
   * the file this request displaced even when several requests are in flight.
   * Avatar and cover set different fields, so simultaneous changes to both
   * compose rather than overwrite one another.
   *
   * The driver is mongodb 6, where `findOneAndUpdate` resolves to the document
   * itself; the `value` unwrapping keeps this correct if a v5-style result ever
   * appears, and the projection is narrow enough that a real user document
   * cannot be mistaken for one.
   */
  private async swapProfileImagePointer(
    userId: ObjectId,
    update: Record<string, any>
  ): Promise<Record<string, any> | null> {
    const result: any = await this.getCollection().findOneAndUpdate(
      { _id: userId },
      { $set: update },
      {
        returnDocument: 'before',
        projection: { avatarId: 1, coverId: 1 }
      }
    );

    if (result && typeof result === 'object' && 'value' in result) {
      return result.value;
    }

    return result;
  }

  /**
   * Update a user's avatar.
   *
   * @param user The profile being changed
   * @param fileId File server id of an `avatar` upload, or the file record
   * @param actor Who is making the change, when that is not the profile's owner
   *   — an admin setting somebody else's avatar. Defaults to the owner.
   * @returns The file record now on the profile, so callers can respond with its
   *   url without a second lookup.
   * @throws ProfileImageNotFoundException, ProfileImageWrongTypeException,
   *   ProfileImageNotOwnedException, ProfileImageNotReadyException,
   *   ProfileImageNotAttachableException
   */
  public async updateAvatar(
    user: UserDto | AuthUserDto,
    fileId: string | ObjectId | Record<string, any>,
    actor?: UserDto | AuthUserDto
  ): Promise<Record<string, any>> {
    return this.applyProfileImage(user, readFileId(fileId), {
      type: 'avatar',
      idField: 'avatarId',
      urlField: 'avatar',
      actor
    });
  }

  /**
   * Update a creator's profile cover.
   *
   * Same contract as `updateAvatar`; see `applyProfileImage` for the ordering
   * and what happens at each failure point.
   *
   * @returns The file record now on the profile, so callers can respond with its
   *   url and derived background colour without a second lookup.
   */
  public async updateCover(
    user: UserDto | AuthUserDto,
    fileId: string | ObjectId | Record<string, any>,
    actor?: UserDto | AuthUserDto
  ): Promise<Record<string, any>> {
    return this.applyProfileImage(user, readFileId(fileId), {
      type: 'cover',
      idField: 'coverId',
      urlField: 'cover',
      actor
    });
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
