import { ForbiddenException, HttpException, Injectable, Logger } from "@nestjs/common";
import { BaseUserService } from './base-user.service';
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "src/schemas";
import { ObjectId } from 'mongodb';
import { AdminUserCreatePayload, AdminUserUpdatePayload, CreatorSelfUpdatePayload, RegisterPayload, UserCreatePayload } from "src/payloads";
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
import { AuthMailService } from "../auth/auth-mail.service";
import { AuthTokenService } from "../auth/auth-token.service";
import { AUTH_TOKEN_TYPE } from "src/schemas/identity/auth";
import { __t } from "src/utils/translation";

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
/**
 * What kind of account the *server* has decided to create.
 *
 * Deliberately separate from the request payload. Every field here is a
 * capability — suspending an account, minting an admin — so it may only be set
 * by code that has already established the caller is entitled to it, never by
 * spreading a request body. An omitted field takes the safe default.
 */
export interface CreateAccountIntent {
  /**
   * Account status. Omitted means `USER_STATUS.ACTIVE`.
   *
   * The admin controller forwards the value an authenticated administrator
   * picked, already validated against `USER_STATUS` by `AdminUserCreatePayload`.
   * Public registration hard-codes `ACTIVE` and never looks at the request.
   */
  status?: string;
  /** Omitted leaves the schema default (`false`). */
  isAdmin?: boolean;
  /** Omitted leaves the field unset. */
  isCreator?: boolean;
  /**
   * Whether the address counts as already confirmed.
   *
   * Only an administrator may state this, through the switch the admin
   * create-user form already renders. Public registration never sets it, so a
   * self-registered account is always `false` and always has to confirm.
   *
   * Omitted means `false` — the safe default, and the one that produces a
   * verification email.
   */
  verifiedEmail?: boolean;
}

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
    private readonly socketUserService: SocketUserService,
    private readonly authMailService: AuthMailService,
    private readonly authTokenService: AuthTokenService
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
   * Create a user account.
   *
   * The two parameters are a trust boundary, and the split is the whole point:
   *
   * - `data` is **request-shaped**. It carries profile fields and nothing that
   *   decides what kind of account this is. Whatever `status`, `isAdmin` or
   *   `isCreator` it happens to hold is ignored — those are read from `intent`
   *   only, so no caller can widen an account by putting a field in a body.
   * - `intent` is **server-decided**. Each caller states, in its own code, what
   *   kind of account it is entitled to create: the admin controller forwards
   *   the status an authenticated administrator chose; `registerNewUser` hard-codes
   *   an ordinary active account and never consults the request.
   *
   * That is why `status` is assigned from `intent` unconditionally rather than
   * merged with `data`: a merge is exactly how a public endpoint would inherit
   * an admin capability the day somebody adds the field to a shared payload.
   *
   * @throws EntityNotFoundException - If email is missing
   * @throws EmailHasBeenTakenException - If email already exists
   * @throws UsernameTakenException - If username already exists
   *
   * @example An administrator creating a suspended account
   * ```typescript
   * await userService.createNewUserAccount(payload, { status: payload.status });
   * ```
   */
  public async createNewUserAccount(
    data: UserCreatePayload | AdminUserCreatePayload,
    intent: CreateAccountIntent = {}
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
    // Assigned, never merged: `data.status` is request-shaped and is discarded
    // here even if present. Callers that may choose one say so through `intent`.
    payload.status = intent.status || USER_STATUS.ACTIVE;

    // Same rule for the role flags.
    if (intent.isAdmin !== undefined) {
      payload.isAdmin = intent.isAdmin;
    }
    if (intent.isCreator !== undefined) {
      payload.isCreator = intent.isCreator;
    }

    if (!payload.name) {
      payload.name = UserDto.getName(payload.firstName, payload.lastName);
    }

    // Assigned from intent, never merged: a visitor cannot mark their own
    // address confirmed. Absent intent means `false`, which is what triggers the
    // verification email below.
    payload.verifiedEmail = intent.verifiedEmail === true;

    // An account that must confirm an address needs an address to confirm. The
    // alternative — creating it anyway — produces an account that can never log
    // in and that nothing will ever mail: a permanent lockout with no signal.
    // Refusing here is the only honest option; inventing an address or silently
    // skipping the mail both hide the problem. (`data.email` is already required
    // above, so this only fires for a caller that bypassed the payload class.)
    if (!payload.verifiedEmail && !payload.email) {
      throw new HttpException(__t('errors.email_required_for_verification'), 400);
    }

    const user = await this.createUserDocument(payload);

    if (payload.password) {
      try {
        await this.authService.createAuthPassword({
          userId: user._id,
          type: 'password',
          value: payload.password,
          key: payload.email
        });
      } catch (error) {
        // Compensation. Without it a failed credential write leaves a profile
        // with no password: login answers "invalid credentials" for ever and
        // registering again answers "that email is taken", so the address is
        // permanently unusable and nothing reports why.
        await this.discardIncompleteAccount(user._id);
        throw error;
      }
    }

    const dto = new UserDto(user);
    await this.queueMessageService.publish(CREATOR_CHANNELS.CREATOR, {
      eventName: EVENT.CREATED,
      data: dto
    });

    // Past this line the account is complete and correct. Mail is best-effort
    // from here: see `requestEmailVerification`.
    const emailQueued = payload.verifiedEmail
      ? true
      : await this.requestEmailVerification(dto);

    // Carried on the DTO rather than thrown, so the caller can tell "the account
    // was not created" apart from "the account exists but the email has not gone
    // out yet". Those need different words in front of a user.
    (dto as any).verificationEmailQueued = emailQueued;

    return dto;
  }

  /**
   * Remove a half-built account, and only the one this attempt built.
   *
   * Deletion is keyed on `_id` — the id of the document *this* call inserted —
   * never on the email or username. That distinction is the whole point: two
   * registrations racing for the same address produce one winner at the unique
   * index and one loser at `createUserDocument`, which throws before ever
   * reaching here. A compensation that deleted by email would let the loser of a
   * later race delete the winner's live account.
   *
   * ## The user document goes first
   *
   * This is not arbitrary, and the original order was wrong. Compensation is two
   * writes with no transaction between them, so a crash — or a failure — can
   * leave either one done and the other not. The order decides which of the two
   * halfway states a crash can produce, and they are not equally bad:
   *
   * | Leftover | Consequence |
   * |---|---|
   * | credential with no user | Harmless. It holds no email and no username, so it blocks nothing; the address is free and the visitor can register again. Reclaimed by the audit script. |
   * | user with no credential | **The original bug.** Login answers "invalid credentials" for ever, and registering again answers "that email is taken". The address is permanently unusable and nothing reports why. |
   *
   * Deleting the user first means the only state a crash can strand is the
   * harmless one. The previous order — credential first — could still produce
   * exactly the state compensation exists to prevent.
   *
   * ## What it does not claim
   *
   * This is best-effort, not a transaction and not crash-proof. A process that
   * dies between the two deletes leaves an orphan credential; a process that
   * dies before either leaves the bad state. `scripts/audit-incomplete-accounts.js`
   * is the other half, and it is what makes those windows detectable rather than
   * merely unlikely.
   *
   * Never throws. It runs while another failure is already being reported, and
   * an exception here would replace a useful error with a confusing one — the
   * original cause is what the caller needs to see.
   */
  private async discardIncompleteAccount(userId: ObjectId): Promise<void> {
    let userRemoved = false;

    // First, and separately, so a failure here is reported on its own terms.
    try {
      await this.UserModel.deleteOne({ _id: userId });
      userRemoved = true;
    } catch (error: any) {
      // The bad state survives. This is the one worth shouting about: the
      // address is now unusable until somebody runs the audit script.
      this.logger.error(
        `INCOMPLETE ACCOUNT ${userId}: credential write failed and the user document could not be `
        + `removed. The address is registered but unusable — run `
        + `scripts/audit-incomplete-accounts.js. Cause: ${error?.message}`
      );
    }

    try {
      await this.authService.removeAuthPassword(userId);
    } catch (error: any) {
      // Only a leftover credential row, and only if one was written at all.
      // Harmless on its own: it carries no email or username, so it blocks
      // nothing. Logged so the audit script's findings have a matching entry.
      this.logger.warn(
        `ORPHAN CREDENTIAL ${userId}: user document ${userRemoved ? 'removed' : 'NOT removed'}, `
        + `credential could not be removed: ${error?.message}`
      );
      return;
    }

    if (userRemoved) {
      this.logger.warn(`Rolled back incomplete account ${userId} after a credential write failure`);
    }
  }

  /**
   * Sign every session out after an address change forced re-confirmation.
   *
   * Never throws. The email change has already been written and is the final
   * state; failing the administrator's request over a Redis error would report a
   * change that did happen as having not happened. Logged at error level instead
   * — an un-revoked session is a real gap, and it expires on its own TTL.
   */
  private async revokeSessionsAfterEmailChange(userId: ObjectId): Promise<void> {
    try {
      const removed = await this.authService.removeAllUserTokens(userId);
      this.logger.log(`Email change for user ${userId}: ${removed} session(s) invalidated`);
    } catch (error: any) {
      this.logger.error(
        `Email change for user ${userId} SUCCEEDED but session revocation failed — an existing `
        + `session can keep using the account until it expires: ${error?.message}`
      );
    }
  }

  /**
   * Queue a verification email, reporting whether it was queued.
   *
   * **Never throws.** By the time this runs the account is written, the
   * credential is stored and the created event has been published — the
   * operation the caller asked for has succeeded. Failing it now would tell
   * somebody their registration did not work while leaving them an account that
   * does, and rolling the account back over a mail-queue hiccup would destroy
   * something recoverable to avoid something that is merely inconvenient.
   *
   * The recovery path is the resend control, which every screen that can reach
   * this state offers. That matters more than usual on the deployment target: a
   * web service that sleeps when idle can suspend between the enqueue and the
   * worker picking the job up.
   */
  public async requestEmailVerification(user: UserDto): Promise<boolean> {
    if (!user?.email) return false;

    try {
      await this.authMailService.sendVerificationEmail({
        userId: user._id,
        email: user.email,
        name: user.name || user.username
      });
      return true;
    } catch (error: any) {
      this.logger.error(`Could not queue verification email for user ${user._id}: ${error?.message}`);
      return false;
    }
  }

  /**
   * Insert the user document, translating a unique-index collision into the
   * same error the pre-check raises.
   *
   * The `isEmailOrUsernameTaken` check above is a read, so two registrations for
   * the same address can both pass it and race to the insert. Only one wins:
   * `idx_email_unique_auth` and `idx_username_unique_profile` decide, which is
   * what keeps concurrent signups to at most one account. Without this
   * translation the loser surfaced as a raw `MongoServerError` — an HTTP 500
   * leaking the driver's message instead of "that email is taken".
   *
   * The code is checked against `keyPattern`, never `code === 11000` alone: a
   * collision on some other index is a different failure and must not be
   * reported as a taken email.
   */
  private async createUserDocument(payload: Record<string, any>) {
    try {
      return await this.UserModel.create(payload);
    } catch (error: any) {
      if (error?.code === 11000) {
        if (error?.keyPattern?.email) throw new EmailHasBeenTakenException();
        if (error?.keyPattern?.username) throw new UsernameTakenException();
      }
      throw error;
    }
  }

  /**
   * Public self-registration.
   *
   * Deliberately a thin wrapper over `createNewUserAccount` rather than a second
   * write path: uniqueness, normalisation, password hashing, the display-name
   * fallback and the creator-created event all stay in one place, so the account
   * a visitor makes for themselves is the same shape as the one an admin makes
   * for them.
   *
   * What it adds is the allow-list. The controller already validates with
   * `whitelist: true` against a payload that carries no role, status or internal
   * flag, and this rebuilds the object field by field on top of that — so a
   * field added to `RegisterPayload` later cannot reach the document by
   * accident, and `isAdmin`/`status`/`verifiedEmail` are decided here rather
   * than anywhere a request can reach.
   */
  public async registerNewUser(payload: RegisterPayload): Promise<UserDto> {
    // A plain literal rather than `new UserCreatePayload(...)` on purpose: the
    // payload classes are only ever *types* in this file, and constructing one
    // would turn `import { ... } from 'src/payloads'` into a runtime import of
    // the whole payload barrel — which pulls `isomorphic-dompurify` into every
    // Jest suite that transitively reaches this service.
    const allowed: Record<string, any> = {
      firstName: payload.firstName,
      lastName: payload.lastName,
      name: payload.name,
      email: payload.email,
      username: payload.username,
      gender: payload.gender,
      // No `dateOfBirth`: `RegisterPayload` does not accept one, because the
      // signup form does not ask for one. Reading a field the payload cannot
      // carry would be the first step back towards trusting the request body.
      // The client-hashed password, carried through to `createAuthPassword`,
      // which salts and re-hashes it exactly as it does for an admin-created
      // account.
      password: payload.password
      // No `verifiedEmail` here either. It is stated as *intent* below, so a
      // visitor cannot mark their own address confirmed however the payload
      // class changes.
    };

    // Hard-coded, not forwarded. A visitor states no intent: they get an
    // ordinary active account or nothing.
    return this.createNewUserAccount(allowed as UserCreatePayload, {
      status: USER_STATUS.ACTIVE,
      isAdmin: false,
      // Always. A self-registered account confirms its address by following the
      // link, and cannot log in until it has.
      verifiedEmail: false
    });
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
    /**
     * An email change invalidates the confirmation: the new address is unproven,
     * whatever the old one was.
     *
     * The comparison is between **normalised** values on both sides. It used to
     * compare the raw payload against the stored address, which is already
     * lowercased and trimmed — so re-submitting the same address with different
     * capitalisation read as a change, silently unset `verifiedEmail`, and
     * locked the account out of a login it had every right to. Normalising both
     * sides means only a genuine change counts.
     */
    const normalisedEmail = typeof data.email === 'string'
      ? data.email.trim().toLowerCase()
      : undefined;
    const emailActuallyChanged = !!normalisedEmail && normalisedEmail !== user.email;

    // Explicit administrator intent, captured *before* anything below can
    // overwrite it. Ticking "Verified email" while changing the address means
    // the administrator is vouching for the new one; assignment order must not
    // quietly turn that back into `false`.
    const adminVouchedForAddress = data.verifiedEmail === true;

    if (normalisedEmail) {
      if (emailActuallyChanged) {
        const emailCheck = await this.UserModel.countDocuments({
          email: normalisedEmail,
          _id: { $ne: user._id }
        });
        if (emailCheck) {
          throw new EmailHasBeenTakenException();
        }
      }
      // Written normalised either way, so a case-only edit still tidies the
      // stored value without being treated as a new address.
      data.email = normalisedEmail;
    }

    const requiresReconfirmation = emailActuallyChanged && !adminVouchedForAddress;
    if (requiresReconfirmation) {
      data.verifiedEmail = false;
    }

    await this.UserModel.updateOne({ _id: id }, data);

    const newUser = await this.UserModel.findById(id);

    if (requiresReconfirmation) {
      // Order matters here, and each step is independent of the last.
      //
      // 1. Kill the outstanding links. They were issued for the *previous*
      //    address; `markEmailVerified` also matches on the token's email so
      //    they could not confirm the new one, but leaving them active means a
      //    later successful confirmation would supersede a set that should
      //    already be empty.
      await this.authTokenService.supersedeSiblings({
        userId: newUser._id,
        type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION
      });

      // 2. Revoke live sessions. Login now refuses this account, so a session
      //    minted before the change is a claim that outlives the check that
      //    granted it — the enforcement bypass this whole flow exists to close.
      //    The admin password-change route already sets this precedent.
      await this.revokeSessionsAfterEmailChange(newUser._id);

      // 3. Mail the *new* address, never the old one: `requestEmailVerification`
      //    reads `user.email`, which is the value just written. Best-effort and
      //    last, because the update has already succeeded and a mail failure
      //    must not undo it — the account simply stays unconfirmed with resend
      //    available.
      await this.requestEmailVerification(new UserDto(newUser));
    }
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
