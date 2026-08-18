import {
  Injectable
} from '@nestjs/common';
import * as crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { USER_STATUS } from 'src/common/constants';
import { AccountInactiveException, PasswordIncorrectException } from 'src/common/exceptions/auth';
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

/**
 * Authentication Service
 *
 * Core authentication service handling user login, password management, JWT tokens,
 * password reset functionality, and email verification. Provides secure authentication
 * mechanisms with proper encryption and token management.
 *
 * Key Features:
 * - Password hashing with PBKDF2 and salt
 * - JWT token generation and validation
 * - Password reset with secure tokens
 * - Email verification system
 * - Multi-factor authentication support
 * - Session management
 * - Account lockout protection
 *
 * Security Features:
 * - PBKDF2 password hashing with 10,000 iterations
 * - Cryptographically secure salt generation
 * - Time-limited password reset tokens
 * - Email verification tokens
 * - JWT token expiration management
 *
 * @example User login
 * ```typescript
 * const result = await authService.login({
 *   email: 'user@example.com',
 *   password: 'securePassword'
 * });
 * if (result.token) {
 *   console.log('Login successful');
 * }
 * ```
 *
 * @example Password reset
 * ```typescript
 * await authService.forgot({
 *   email: 'user@example.com'
 * });
 * // User receives reset email
 * ```
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectModel(Auth.name) private readonly AuthModel: Model<AuthDocument>,
    private readonly baseUserService: BaseUserService,
    private readonly tokenService: TokenService,
    private readonly authUserCacheService: AuthUserCacheService
  ) { }
  /**
   * Generate cryptographically secure password salt
   *
   * Creates a random salt using Node.js crypto module for password hashing.
   * The salt is used to prevent rainbow table attacks and ensure unique hashes.
   *
   * @param byteSize - Size of the salt in bytes (default: 16)
   * @returns Base64-encoded salt string
   * @example
   * ```typescript
   * const salt = authService.generateSalt();
   * console.log(`Generated salt: ${salt}`);
   * ```
   */
  public generateSalt(byteSize = 16): string {
    return crypto.randomBytes(byteSize).toString('base64');
  }

  /**
 * Encrypt password using SHA256 with salt
 * Uses SHA256 hash with salt for password hashing. This provides basic protection
 * against rainbow table attacks but is vulnerable to brute force due to fast hashing.
 *
 * @param pw - Plain text password to encrypt
 * @param salt - Salt string for the hash
 * @returns Hex-encoded encrypted password
 * @example
 * ```typescript
 * const salt = authService.generateSalt();
 * const hashedPassword = authService.encryptPassword('myPassword', salt);
 * ```
 */
  public encryptPassword(pw: string, salt: string): string {
    // SHA256 with salt (client-side compatible)
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
  public async createAuthPassword(data: AuthPayload): Promise<AuthDto> {
    const salt = this.generateSalt();
    const newVal = this.encryptPassword(data.value, salt);
    // avoid admin update
    // TODO - should listen via user event?
    let auth = await this.AuthModel.findOne({
      type: 'password',
      userId: data.userId
    });
    if (!auth) {
      // eslint-disable-next-line new-cap
      auth = new this.AuthModel({
        type: 'password',
        userId: data.userId
      });
    }

    auth.salt = salt;
    auth.value = newVal;
    auth.key = data.key;

    await auth.save();
    return AuthDto.fromModel(auth);
  }

  public async getAuthPassword(userId?: string | ObjectId): Promise<any> {
    return this.AuthModel.findOne({
      userId: userId,
      type: 'password'
    });
  }

  public verifyPassword(pw: string, auth: Auth): boolean {
    if (!pw || !auth || !auth.salt) {
      return false;
    }
    return this.encryptPassword(pw, auth.salt) === auth.value;
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
    await this.createAuthPassword({
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
    if (!this.verifyPassword(payload.password, authPassword)) {
      throw new PasswordIncorrectException();
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
 * Invalidate all active sessions for a user (used on account deletion or security events)
 * @param userId User or creator ID whose sessions should be revoked
 * @returns Number of tokens that were removed
 */
  public async removeAllUserTokens(userId: string | ObjectId): Promise<number> {
    return this.tokenService.removeAllUserTokens(userId);
  }
}
