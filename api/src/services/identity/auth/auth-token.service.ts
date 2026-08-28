import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as crypto from 'crypto';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import {
  AUTH_TOKEN_STATUS,
  AuthToken,
  AuthTokenDocument,
  AuthTokenType
} from 'src/schemas/identity/auth';

/** What `issue` hands back. The raw token exists only in this object. */
export interface IssuedAuthToken {
  /** Mail this. Never store it, never log it, never return it from a route. */
  rawToken: string;
  expiresAt: Date;
  tokenId: ObjectId;
}

/** A token that this call, and only this call, took ownership of. */
export interface ClaimedAuthToken {
  tokenId: ObjectId;
  userId: ObjectId;
  type: string;
  email: string;
  expiresAt: Date;
}

/**
 * Issue, claim and invalidate the single-use links behind email verification and
 * password reset.
 *
 * This service owns the whole token lifecycle. Nothing else generates a token,
 * hashes one, or decides whether one is still usable — the moment two places
 * implement "is this token valid", one of them keeps accepting something the
 * other rejects.
 */
@Injectable()
export class AuthTokenService {
  private readonly logger = new Logger(AuthTokenService.name);

  constructor(
    @InjectModel(AuthToken.name) private readonly AuthTokenModel: Model<AuthTokenDocument>
  ) {}

  /**
   * 256 bits from the OS CSPRNG, `base64url` encoded.
   *
   * The same call `TokenService.generateSecureToken` already makes for session
   * tokens, so the two look alike and neither needs URL escaping.
   *
   * The reference implementation used `Math.random()` in a loop. That is not a
   * shorter token, it is a *predictable* one: `Math.random` is xorshift128+ and
   * its internal state is recoverable from a modest run of outputs, so an
   * attacker who can observe a few tokens can compute the next ones.
   */
  public static generateRawToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  /** Lowercase hex `sha256`. The only form that ever reaches storage. */
  public static hashToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Mint a token for a user.
   *
   * Existing active tokens of the same type are deliberately **left alone**. See
   * the class comment on `AuthToken`: overwriting them is what produces two sent
   * emails of which only one works.
   */
  public async issue(params: {
    userId: ObjectId | string;
    type: AuthTokenType;
    email: string;
    ttlMinutes: number;
  }): Promise<IssuedAuthToken> {
    const rawToken = AuthTokenService.generateRawToken();
    const expiresAt = new Date(Date.now() + params.ttlMinutes * 60 * 1000);

    const created = await this.AuthTokenModel.create({
      userId: params.userId,
      type: params.type,
      tokenHash: AuthTokenService.hashToken(rawToken),
      email: params.email.trim().toLowerCase(),
      status: AUTH_TOKEN_STATUS.ACTIVE,
      expiresAt
    });

    return { rawToken, expiresAt, tokenId: created._id as ObjectId };
  }

  /**
   * Take ownership of a token, atomically.
   *
   * The validity check and the consumption are the **same statement**. There is
   * no window in which a second request can observe the token as active after
   * the first has decided to use it, and therefore no way for two callers to
   * both be told their token worked.
   *
   * ```js
   * findOneAndUpdate(
   *   { tokenHash, type, status: 'active', expiresAt: { $gt: now } },
   *   { $set: { status: 'consumed', resolvedAt: now } },
   *   { returnDocument: 'before' }
   * )
   * ```
   *
   * `null` means unknown, expired, superseded or already used. All four are
   * reported to the caller with one error code: distinguishing them would tell
   * somebody probing tokens which of their guesses had ever existed.
   */
  public async claim(rawToken: string, type: AuthTokenType): Promise<ClaimedAuthToken | null> {
    if (!rawToken || typeof rawToken !== 'string') return null;

    const now = new Date();
    const claimed = await this.AuthTokenModel.findOneAndUpdate(
      {
        tokenHash: AuthTokenService.hashToken(rawToken),
        type,
        status: AUTH_TOKEN_STATUS.ACTIVE,
        expiresAt: { $gt: now }
      },
      { $set: { status: AUTH_TOKEN_STATUS.CONSUMED, resolvedAt: now } },
      { returnDocument: 'before' }
    );

    if (!claimed) return null;

    return {
      tokenId: claimed._id as ObjectId,
      userId: claimed.userId,
      type: claimed.type,
      email: claimed.email,
      expiresAt: claimed.expiresAt
    };
  }

  /**
   * Give a claim back.
   *
   * Compensation for the case where the mutation the token authorised failed
   * after the claim succeeded. It is safe precisely *because* the token was
   * consumed: no other request could have taken it in the meantime, so restoring
   * it cannot resurrect a token somebody else already used.
   *
   * Guarded on `status: 'consumed'` so it can never revive a token that was
   * superseded by a genuine sibling claim.
   *
   * **Must not throw.** It runs while another failure is already being reported,
   * and an exception here would replace a useful error with a confusing one.
   */
  public async release(tokenId: ObjectId): Promise<void> {
    try {
      await this.AuthTokenModel.updateOne(
        { _id: tokenId, status: AUTH_TOKEN_STATUS.CONSUMED },
        { $set: { status: AUTH_TOKEN_STATUS.ACTIVE }, $unset: { resolvedAt: '' } }
      );
    } catch (error: any) {
      // The user can request a new link; a stuck token expires on its own.
      this.logger.warn(`Could not release auth token ${tokenId}: ${error?.message}`);
    }
  }

  /**
   * Invalidate a user's remaining tokens of one type after a successful claim.
   *
   * This is what makes "one successful use invalidates the rest" true across
   * however many links the user happens to be holding.
   *
   * Never throws: it runs after the real mutation has already succeeded, and
   * leftover siblings expire on their own. Failing the request at this point
   * would report an error for an operation that actually completed.
   */
  public async supersedeSiblings(params: {
    userId: ObjectId | string;
    type: AuthTokenType;
    exceptTokenId?: ObjectId;
  }): Promise<number> {
    try {
      const filter: Record<string, any> = {
        userId: params.userId,
        type: params.type,
        status: AUTH_TOKEN_STATUS.ACTIVE
      };
      if (params.exceptTokenId) filter._id = { $ne: params.exceptTokenId };

      const result = await this.AuthTokenModel.updateMany(filter, {
        $set: { status: AUTH_TOKEN_STATUS.SUPERSEDED, resolvedAt: new Date() }
      });
      return result.modifiedCount ?? 0;
    } catch (error: any) {
      this.logger.warn(`Could not supersede sibling ${params.type} tokens: ${error?.message}`);
      return 0;
    }
  }

  /** How many tokens of a type a user has been issued since a moment. */
  public async countIssuedSince(params: {
    userId: ObjectId | string;
    type: AuthTokenType;
    since: Date;
  }): Promise<number> {
    return this.AuthTokenModel.countDocuments({
      userId: params.userId,
      type: params.type,
      createdAt: { $gte: params.since }
    });
  }

  /**
   * Delete rows that expired long enough ago to be uninteresting.
   *
   * Belt and braces beside the TTL index: the TTL monitor is a background
   * process that can be disabled, can lag, and does not exist at all on some
   * managed tiers. Neither mechanism is load-bearing for correctness.
   */
  public async purgeExpired(olderThan: Date): Promise<number> {
    const result = await this.AuthTokenModel.deleteMany({ expiresAt: { $lt: olderThan } });
    return result.deletedCount ?? 0;
  }
}
