import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';

@Schema({
  collection: 'auth',
  timestamps: true
})
export class Auth {
  /**
   * Reference to the user this authentication record belongs to
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  userId: ObjectId;

  /**
   * Type of authentication (e.g., 'password', 'oauth', 'social')
   */
  @Prop({
    default: 'password'
  })
  type: string;

  /**
   * Authentication key (e.g., email for password auth, provider ID for OAuth)
   */
  @Prop()
  key: string;

  /**
   * Authentication value (e.g., hashed password, access token)
   */
  @Prop()
  value: string;

  /**
   * Salt used for password hashing
   */
  @Prop()
  salt: string;

  /**
   * Timestamp when this authentication record was created
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  /**
   * Timestamp when this authentication record was last updated
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;
}

export type AuthDocument = HydratedDocument<Auth>;

export const AuthSchema = SchemaFactory.createForClass(Auth);

/**
 * PRIMARY AUTHENTICATION LOOKUP INDEX
 *
 * Purpose: Efficiently find user's authentication records by type
 * Business Logic: Login authentication, password verification, auth type management
 *
 * Query Pattern:
 * - db.auth.findOne({ type: 'password', userId: userId })
 * - Used during login to find user's password authentication
 * - Used during password updates to locate existing auth records
 *
 * Performance: Critical for login performance - O(log n) lookup
 * Security: Enables fast authentication without exposing sensitive data
 * Coverage: Supports both type-specific and user-specific queries
 */
AuthSchema.index({ type: 1, userId: 1 }, {
  name: 'idx_type_userId_auth_lookup'
});

/**
 * CREDENTIAL UNIQUENESS INDEX
 *
 * Purpose: one credential per user per credential type, enforced by the database
 * Business Logic: account management, password change, admin operations
 *
 * `{ userId, type }` is the logical credential key. It is the *whole* key today
 * because `password` is the only type that exists: audited 2026-08-26, every row
 * in the collection is `type: 'password'`, and the OAuth routes the schema
 * comments allude to (`/auth/social/*`) are not implemented — they answer 404.
 *
 * ⚠️ If OAuth is added and several providers share a single `type`, this key is
 * too narrow and would silently prevent a user from linking a second provider.
 * The fix then is to widen the key (adding the provider), not to drop
 * uniqueness — record the provider in its own field and index
 * `{ userId, type, provider }`.
 *
 * Why unique matters: `createAuthPassword` used to read-then-write, so two
 * concurrent calls for the same user could both find nothing and both insert,
 * leaving two password rows for one account and making `getAuthPassword`'s
 * answer depend on storage order — which is to say, on luck. The write is now a
 * single atomic upsert, and this index is what makes that safe rather than
 * merely likely.
 *
 * Query Pattern (unchanged — a unique index serves reads identically):
 * - db.auth.findOne({ userId: userId, type: 'password' })
 * - db.auth.updateMany({ userId: userId, type: 'password' }, { $set: { key: newEmail } })
 *
 * ⚠️ This replaces the non-unique `idx_userId_type_management`. `autoIndex`
 * cannot change an existing index's options — `createIndex` fails with a
 * conflict — so an existing database needs
 * `node scripts/repair-auth-credential-duplicates.js --apply`, which collapses
 * duplicates, drops the old index and creates this one.
 */
AuthSchema.index({ userId: 1, type: 1 }, {
  name: 'idx_userId_type_unique_credential',
  unique: true
});
