import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

/** The kinds of single-use link this collection backs. */
export const AUTH_TOKEN_TYPE = {
  EMAIL_VERIFICATION: 'email-verification',
  PASSWORD_RESET: 'password-reset'
} as const;

export type AuthTokenType = typeof AUTH_TOKEN_TYPE[keyof typeof AUTH_TOKEN_TYPE];

/**
 * Lifecycle states.
 *
 * `status` exists as a separate always-present field rather than being inferred
 * from `resolvedAt` because it is part of an index key. The repo rule is that an
 * indexed optional field must never carry `default: null` — Mongoose then writes
 * the field on every document and a sparse index stops skipping anything. A
 * required field with a real default sidesteps that entirely.
 */
export const AUTH_TOKEN_STATUS = {
  /** Issued, unexpired, unused. */
  ACTIVE: 'active',
  /** Claimed by the request that used it. */
  CONSUMED: 'consumed',
  /** Invalidated because a sibling token of the same type was used. */
  SUPERSEDED: 'superseded'
} as const;

export type AuthTokenStatus = typeof AUTH_TOKEN_STATUS[keyof typeof AUTH_TOKEN_STATUS];

/**
 * Single-use, time-limited tokens for email verification and password reset.
 *
 * ## One collection, discriminated by `type`
 *
 * Two nearly identical collections is how two claim implementations, two index
 * sets and two cleanup stories end up diverging. Extending the existing `auth`
 * collection was rejected outright: it carries a **unique** index on
 * `{ userId, type }`, so a second row of a new type would cap a user at one
 * verification token forever, and it would put throwaway rows next to
 * credentials.
 *
 * ## The raw token is never here
 *
 * Only `sha256(raw)`. A read of this collection therefore yields nothing usable:
 * the hash cannot be mailed to anybody and cannot be presented to the claim,
 * which compares against the hash of what the request supplied.
 *
 * SHA-256 rather than scrypt is correct, and the reasoning matters. A password
 * KDF's cost exists to defend a *low-entropy* secret against offline guessing.
 * These tokens are 256 bits from a CSPRNG — there is nothing to guess, and
 * making the lookup expensive would only hand an attacker a cheap way to burn
 * server CPU by posting garbage tokens.
 *
 * ## Several tokens may be active at once
 *
 * A design of "one active token per user per type" has a race with no good
 * answer: request A writes token A, request B overwrites it with token B, and
 * *both emails go out* — so the first recipient holds a link that silently does
 * nothing. Here every issued token stays valid until one of them is claimed, at
 * which point the rest are superseded in a single statement. Abuse is bounded by
 * the cooldown in `AuthRateLimitService`, not by clobbering rows.
 */
@Schema({
  collection: 'auth_tokens',
  timestamps: true
})
export class AuthToken {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true
  })
  userId: ObjectId;

  /** One of `AUTH_TOKEN_TYPE`. */
  @Prop({ required: true })
  type: string;

  /** Lowercase hex `sha256` of the raw token. The raw token is never stored. */
  @Prop({ required: true })
  tokenHash: string;

  /**
   * The normalised address this token was issued for.
   *
   * Compared against the account's current email at claim time. Without it, a
   * verification link mailed to an old address would verify a new one the user
   * may not own — an administrator changing somebody's email already forces
   * `verifiedEmail: false`, and a stale link must not undo that.
   */
  @Prop({ required: true })
  email: string;

  /** One of `AUTH_TOKEN_STATUS`. Always present, so it is safe to index. */
  @Prop({ required: true, default: AUTH_TOKEN_STATUS.ACTIVE })
  status: string;

  @Prop({ type: Date, required: true })
  expiresAt: Date;

  /**
   * When the token left `active`. Absent while active.
   *
   * Not part of any index key, which is why it is allowed to be absent — see the
   * note on `status`.
   */
  @Prop({ type: Date })
  resolvedAt: Date;

  createdAt: Date;

  updatedAt: Date;
}

export type AuthTokenDocument = HydratedDocument<AuthToken>;

export const AuthTokenSchema = SchemaFactory.createForClass(AuthToken);

/**
 * CLAIM LOOKUP INDEX
 *
 * Purpose: resolve a presented token to its row in one equality lookup.
 * Business logic: every verify and every reset.
 *
 * Query pattern:
 * - db.auth_tokens.findOneAndUpdate({ tokenHash, type, status: 'active', expiresAt: { $gt: now } }, …)
 *
 * Unique is doing real work here beyond dedup: it turns a hash collision — or a
 * bug that reuses a token value — into a loud write error instead of an
 * ambiguous read that returns whichever row storage happened to reach first.
 */
AuthTokenSchema.index({ tokenHash: 1 }, {
  name: 'idx_auth_token_hash_unique',
  unique: true
});

/**
 * PER-USER MANAGEMENT INDEX
 *
 * Purpose: supersede a user's remaining tokens after one is claimed, and count
 * recent issues for the resend cooldown.
 * Business logic: single-use enforcement across siblings; abuse limits.
 *
 * Query pattern:
 * - db.auth_tokens.updateMany({ userId, type, status: 'active' }, …)
 * - db.auth_tokens.countDocuments({ userId, type, createdAt: { $gt: … } })
 *
 * Every field in this key is required with a default, so there is no sparse or
 * partial behaviour to reason about.
 */
AuthTokenSchema.index({ userId: 1, type: 1, status: 1, createdAt: -1 }, {
  name: 'idx_auth_token_user_type_status'
});

/**
 * HOUSEKEEPING TTL INDEX
 *
 * Purpose: stop the collection growing without bound.
 *
 * `expireAfterSeconds: 0` because `expiresAt` is an **absolute instant**, not a
 * creation timestamp: MongoDB deletes a document once `expiresAt` is in the
 * past. The earlier value of `604800` was a misreading of the option — it made
 * the field mean "delete seven days *after* the moment the token expired",
 * retaining spent tokens for a week that nothing asked to keep.
 *
 * ⚠️ This is still **not** how expiry is enforced. The TTL monitor runs about
 * once a minute and offers no ordering guarantee, so a row can outlive its
 * `expiresAt` by an arbitrary interval — a fact `verify-auth-tokens.js` proves
 * by backdating a row and showing the claim refuses it while the row is
 * demonstrably still present. Expiry is enforced by the
 * `expiresAt: { $gt: new Date() }` predicate inside the claim itself, evaluated
 * in the same atomic statement that consumes the token.
 */
AuthTokenSchema.index({ expiresAt: 1 }, {
  name: 'idx_auth_token_expiry_cleanup',
  expireAfterSeconds: 0
});
