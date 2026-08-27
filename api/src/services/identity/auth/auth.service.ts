import {
  Injectable, Logger
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { USER_STATUS } from 'src/common/constants';
import {
  AccountInactiveException,
  CredentialAlreadyExistsException,
  CredentialNotFoundException,
  CredentialWriteConflictException,
  PasswordIncorrectException
} from 'src/common/exceptions/auth';
import { UserDto } from 'src/dtos/identity/user';
import { EntityNotFoundException } from 'src/kernel';
import { AuthPayload, LoginPayload } from 'src/payloads';
import {
  Auth, AuthDocument
} from 'src/schemas/identity/auth';
import { __t } from 'src/utils/translation';
import { BaseUserService } from '../user/base-user.service';
import { TokenService } from './token.service';
import { InjectModel } from '@nestjs/mongoose';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { AuthUserCacheService } from '../auth-user-cache.service';
import { AuthDto } from 'src/dtos/identity/auth';
import {
  PasswordHasherService, StoredCredential, VerificationResult
} from './password-hasher.service';

/**
 * Authentication Service
 *
 * Credential storage and verification, plus token issue and lookup. That is the
 * whole of it.
 *
 * What this actually does:
 * - Salted SHA256 password hashing (`encryptPassword`), one random salt per
 *   credential, stored in the `auth` collection
 * - Password verification for login, including the account-status check
 * - Token issue, validation and revocation, delegated to `TokenService` (Redis)
 * - Resolving a token back to an `AuthUserDto`, through `AuthUserCacheService`
 *
 * What this does NOT do, and what no other service does either. This list is
 * here because an earlier version of this docblock advertised most of it, which
 * is misleading in exactly the place somebody would look before wiring a
 * "Forgot password?" link to something:
 * - **No password reset.** No `forgot()`, no reset tokens, no
 *   `POST /auth/forgot` route. The only password-change path that exists is
 *   `PUT /admin/auth/user/password`, and it is admin-only.
 * - **No email verification.** `verifiedEmail` is a flag an administrator sets;
 *   nothing sends or checks a verification mail.
 * - **No 2FA, and no account lockout.** Brute force is bounded by the
 *   throttler on the login route (5 attempts per minute), not by lockout.
 * - **Not PBKDF2**, despite what the old comments said — it is a single SHA256
 *   round over `password + salt`. The web client also SHA256s the password
 *   before sending it, so what is hashed here is already a digest.
 *
 * @example User login
 * ```typescript
 * const result = await authService.login({
 *   username: 'user@example.com',
 *   password: '<sha256 hex from the client>'
 * }, req);
 * if (result.token) {
 *   console.log('Login successful');
 * }
 * ```
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectModel(Auth.name) private readonly AuthModel: Model<AuthDocument>,
    private readonly baseUserService: BaseUserService,
    private readonly tokenService: TokenService,
    private readonly authUserCacheService: AuthUserCacheService,
    private readonly passwordHasher: PasswordHasherService
  ) { }
  /**
   * Legacy salt generator.
   *
   * Retained only because `encryptPassword` below still needs one to *verify*
   * pre-migration credentials in tests and tooling. Nothing writes a legacy
   * credential any more — `PasswordHasherService.hash` does all storage.
   *
   * @deprecated Use `PasswordHasherService`.
   */
  public generateSalt(byteSize = 16): string {
    return crypto.randomBytes(byteSize).toString('base64');
  }

  /**
   * The legacy salted-SHA256 scheme, verify-only.
   *
   * A single fast hash round, which is why it was replaced: see
   * `PasswordHasherService` for what a stolen credential costs under each
   * scheme. Kept public so the migration probe under `api/scripts/` can *create*
   * a realistic legacy credential to migrate; production code paths must not
   * call it to store anything.
   *
   * @deprecated Use `PasswordHasherService`.
   */
  public encryptPassword(pw: string, salt: string): string {
    return crypto.createHash('sha256').update(pw + salt).digest('hex');
  }

  /**
   * Create or update user password authentication
   *
   * Creates a new password authentication record or updates an existing one for a user.
   * Generates a new salt and encrypts the password using PBKDF2 for secure storage.
   * This is used during user registration and password changes.
   *
   * Security Features:
   * - Generates unique salt for each password
   * - Uses PBKDF2 encryption with 10,000 iterations
   * - Overwrites existing password data securely
   * - Validates user existence before creating auth
   *
   * @param data - Authentication payload containing userId, password value, and key (email)
   * @returns Promise resolving to created/updated AuthDto
   * @throws EntityNotFoundException if user doesn't exist
   * @example
   * ```typescript
   * const authRecord = await authService.createAuthPassword({
   *   userId: 'user123',
   *   value: 'newSecurePassword',
   *   key: 'user@example.com'
   * });
   * console.log('Password authentication created:', authRecord._id);
   * ```
   *
   * @security CRITICAL - Handles password storage and encryption
   */
  /**
   * Create a credential that does not exist yet. Never overwrites one that does.
   *
   * The MongoDB operation is deliberately `$setOnInsert`-only:
   *
   * ```js
   * findOneAndUpdate(
   *   { userId, type: 'password' },
   *   { $setOnInsert: { userId, type, value, key } },
   *   { upsert: true, new: false }
   * )
   * ```
   *
   * With `new: false` the return value *is* the answer to "did this already
   * exist": `null` means this call performed the insert, a document means one
   * was already there and nothing was written.
   *
   * That distinction is the whole point. The previous version used
   * `$set: { value }` on an upsert, so create and change were the same
   * operation — two concurrent creates with different passwords both reported
   * success while only one password survived, and the caller whose password lost
   * was told it had been saved. An account that then rejects that password is
   * indistinguishable, from the outside, from a broken login.
   *
   * When the credential already exists the requested password is *verified*
   * against it:
   *  - it matches — the caller asked for a state that already holds, so this is
   *    idempotent and returns the existing credential;
   *  - it does not — nothing was created, and saying otherwise would be a lie.
   *    `CredentialAlreadyExistsException` (409).
   *
   * @throws CredentialAlreadyExistsException when a different credential exists
   */
  public async createAuthPassword(data: AuthPayload): Promise<AuthDto> {
    const value = await this.passwordHasher.hash(data.value);

    let existing: AuthDocument | null;
    try {
      existing = await this.AuthModel.findOneAndUpdate(
        { userId: data.userId, type: 'password' },
        {
          $setOnInsert: {
            userId: data.userId, type: 'password', value, key: data.key
          }
        },
        { upsert: true, new: false, setDefaultsOnInsert: true }
      );
    } catch (error: any) {
      // Two upserts racing: one inserted, the other's upsert also became an
      // insert and the unique index rejected it. The row exists but is not
      // necessarily *this* caller's password, so fall through to the same
      // verification the matched path uses rather than assuming success.
      if (error?.code === 11000 && (error?.keyPattern?.userId || error?.keyPattern?.type)) {
        existing = await this.AuthModel.findOne({ userId: data.userId, type: 'password' });
        if (!existing) throw new CredentialWriteConflictException();
      } else {
        throw new CredentialWriteConflictException();
      }
    }

    // `null` means this call did the insert.
    if (!existing) {
      const created = await this.AuthModel.findOne({ userId: data.userId, type: 'password' });
      return AuthDto.fromModel(created);
    }

    // Something was already there. Idempotent only if it is the same password.
    const verification = await this.passwordHasher.verify(data.value, existing as StoredCredential);
    if (verification.valid) return AuthDto.fromModel(existing);

    throw new CredentialAlreadyExistsException();
  }

  /**
   * Replace an existing credential. Never creates one.
   *
   * ```js
   * findOneAndUpdate(
   *   { userId, type: 'password' },
   *   { $set: { value, key }, $unset: { salt: '' } },
   *   { new: true }          // no upsert
   * )
   * ```
   *
   * No `upsert`, so a password *change* can never quietly become a password
   * *creation* for an account that never had one — that is a different event and
   * the caller has to ask for it explicitly.
   *
   * `$unset: { salt }` retires the legacy column, which is also what stops
   * `detectFormat` from reading a rewritten row as a half-migrated legacy one.
   *
   * Last write wins between two concurrent changes, and observably so: the
   * surviving credential is whichever `$set` MongoDB applied last, exactly one
   * row exists afterwards, and both callers are telling the truth — each did
   * successfully replace the credential at the moment it ran. This is a
   * deliberate contract choice rather than compare-and-set, because a password
   * change has no "expected previous value" to compare against: the caller knows
   * what they want the password to *become*, not what it currently is.
   *
   * @throws CredentialNotFoundException when there is nothing to replace
   */
  public async replaceAuthPassword(data: AuthPayload): Promise<AuthDto> {
    const value = await this.passwordHasher.hash(data.value);

    let replaced: AuthDocument | null;
    try {
      replaced = await this.AuthModel.findOneAndUpdate(
        { userId: data.userId, type: 'password' },
        {
          $set: { value, ...(data.key ? { key: data.key } : {}) },
          $unset: { salt: '' }
        },
        { new: true }
      );
    } catch {
      throw new CredentialWriteConflictException();
    }

    if (!replaced) throw new CredentialNotFoundException();
    return AuthDto.fromModel(replaced);
  }

  /**
   * Set a password whether or not one exists, stating which case happened.
   *
   * The entry point for "the user or an administrator supplied a new password".
   * Replace is attempted first because that is the ordinary case; the create
   * fallback covers an account made without a password (an admin may create
   * one), and is reached only by an explicit `CredentialNotFoundException`
   * rather than by an upsert quietly doing it.
   *
   * The two-step is race-safe: if another request creates the credential between
   * the failed replace and the create, `createAuthPassword` answers with a
   * conflict or an idempotent success rather than a false one.
   */
  public async setAuthPassword(data: AuthPayload): Promise<AuthDto> {
    try {
      return await this.replaceAuthPassword(data);
    } catch (error) {
      if (error instanceof CredentialNotFoundException) {
        return this.createAuthPassword(data);
      }
      throw error;
    }
  }

  public async getAuthPassword(userId?: string | ObjectId): Promise<any> {
    return this.AuthModel.findOne({
      userId: userId,
      type: 'password'
    });
  }

  /**
   * Verify a password against a stored credential of either format.
   *
   * Delegates entirely to `PasswordHasherService`; this method exists only so
   * callers keep a stable name. The result carries *which* format matched, which
   * is what the login path uses to decide whether to upgrade.
   */
  public async verifyPassword(pw: string, auth: Auth): Promise<VerificationResult> {
    return this.passwordHasher.verify(pw, auth as StoredCredential);
  }

  /**
   * Update user password authentication
   *
   * Updates an existing user's password by generating a new salt and encrypting
   * the new password. Validates user existence and updates the authentication record.
   * Used for password change operations initiated by users or administrators.
   *
   * Security Process:
   * - Validates user exists before password change
   * - Generates new salt for enhanced security
   * - Encrypts new password with PBKDF2
   * - Updates authentication record atomically
   *
   * @param data - Authentication payload with userId and new password
   * @throws EntityNotFoundException if user doesn't exist
   * @example
   * ```typescript
   * await authService.updateAuthPassword({
   *   userId: 'user123',
   *   value: 'newStrongerPassword',
   *   key: 'user@example.com'
   * });
   * console.log('Password updated successfully');
   * ```
   *
   * @security CRITICAL - Handles password updates
   */
  public async updateAuthPassword(data: AuthPayload) {
    const user = await this.baseUserService.findById(data.userId);
    if (!user) {
      throw new EntityNotFoundException();
    }
    // A password *change*: `setAuthPassword` replaces the existing credential
    // and only falls back to creating one for an account that never had a
    // password, which an administrator can produce.
    await this.setAuthPassword({
      userId: data.userId,
      key: user.email,
      value: data.value
    });
  }

  public async generateToken(userId: string | ObjectId, options: any = {}): Promise<string> {
    const remember = options.expiresIn && options.expiresIn > 60 * 60 * 24 * 7; // More than 7 days

    return await this.tokenService.generateToken(userId, remember);
  }

  public async verifyToken(token: string): Promise<any> {
    const tokenData = await this.tokenService.validateToken(token);
    if (!tokenData) return false;

    return {
      userId: tokenData.userId
    };
  }

  public async getUserFromTokenData(tokenData: any): Promise<AuthUserDto> {
    if (!tokenData) {
      return null;
    }
    const user = await this.authUserCacheService.get(tokenData.userId);
    if (user) {
      return user;
    }

    const userDto = await this.baseUserService.findById(tokenData.userId);
    if (userDto) {
      await this.authUserCacheService.set(AuthUserDto.fromUser(userDto));
    }
    return AuthUserDto.fromUser(userDto);
  }

  public async getUserFromToken(token: string): Promise<AuthUserDto> {
    const tokenData = await this.verifyToken(token);
    if (!tokenData) {
      return null;
    }

    return this.getUserFromTokenData(tokenData);
  }

  /**
   * login account
   * @param payload
   * @param req
   * @returns
   */
  async login(payload: LoginPayload, req: Request): Promise<{ token: string, profile: any }> {
    const user: UserDto = await this.baseUserService.findByUsernameOrEmail(payload.username);
    if (!user) {
      throw new EntityNotFoundException(__t('errors.invalid_login_credentials'));
    }

    const authPassword = await this.getAuthPassword(user._id);
    if (!authPassword) {
      throw new EntityNotFoundException(__t('errors.invalid_login_credentials'));
    }

    if (user.status === USER_STATUS.INACTIVE) {
      throw new AccountInactiveException();
    }

    const verification = await this.verifyPassword(payload.password, authPassword);
    if (!verification.valid) {
      // Covers a wrong password, a malformed credential and an unsupported
      // version alike: all three are "these credentials do not work", and
      // distinguishing them for the caller would describe our storage to them.
      throw new PasswordIncorrectException();
    }

    // Correct password on a pre-migration credential. Upgrade it now, because
    // this is the only moment the plaintext exists — there is no bulk migration
    // possible, and no reason to make anybody reset a password they still know.
    if (verification.needsUpgrade) {
      await this.upgradeLegacyCredential(authPassword, payload.password, user.email);
    }

    // Generate Redis-based token
    const deviceInfo = {
      userAgent: req.headers['user-agent'] || 'Unknown',
      ip: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'Unknown'
    };

    const tokenOptions = {
      expiresIn: payload.remember ? 60 * 60 * 24 * 365 : 60 * 60 * 24 * 1,
      deviceInfo
    };

    const token = await this.generateToken(user._id, tokenOptions);

    return {
      token,
      profile: user.toResponse()
    };
  }

  /**
   * Re-hash a verified legacy credential with scrypt, exactly once.
   *
   * Two properties make this safe to run inside a login:
   *
   * **It cannot overwrite a newer credential.** The update is a compare-and-set:
   * it matches on `_id` *and* on the legacy `value` and `salt` that were just
   * verified. If a concurrent login (or a password change) already rewrote the
   * row, those no longer match, nothing is written, and the newer credential
   * stands. Two simultaneous logins therefore produce one upgrade and one no-op,
   * never a lost password change.
   *
   * **It cannot fail the login.** The password was already correct; the session
   * is already earned. A storage error here means the credential stays legacy
   * and the next successful login tries again — which is strictly better than
   * refusing a valid sign-in over a migration detail. It is logged, not thrown.
   */
  private async upgradeLegacyCredential(
    legacyCredential: any,
    plainPassword: string,
    key?: string
  ): Promise<void> {
    try {
      const value = await this.passwordHasher.hash(plainPassword);

      await this.AuthModel.updateOne(
        {
          _id: legacyCredential._id,
          // The compare half of compare-and-set. Both fields, because either one
          // changing means somebody else has rewritten this credential.
          value: legacyCredential.value,
          salt: legacyCredential.salt
        },
        {
          $set: { value, ...(key ? { key } : {}) },
          // The legacy salt column is meaningless under scrypt — the salt lives
          // inside the encoded value — and leaving it behind would keep the row
          // looking legacy to `detectFormat`.
          $unset: { salt: '' }
        }
      );
    } catch (error) {
      // Deliberately swallowed. See the note above: the login is valid either
      // way, and the upgrade retries on the next one.
      this.logger.warn(`Password credential upgrade skipped for auth ${legacyCredential?._id}: ${error?.message}`);
    }
  }

  /**
 * Invalidate all active sessions for a user (used on account deletion or security events)
 * @param userId User or creator ID whose sessions should be revoked
 * @returns Number of tokens that were removed
 */
  public async removeAllUserTokens(userId: string | ObjectId): Promise<number> {
    return this.tokenService.removeAllUserTokens(userId);
  }
}
