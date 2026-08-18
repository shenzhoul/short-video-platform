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
 * USER AUTHENTICATION MANAGEMENT INDEX
 *
 * Purpose: Efficiently manage all authentication methods for a user
 * Business Logic: User account management, multi-auth support, admin operations
 *
 * Query Pattern:
 * - db.auth.find({ userId: userId })
 * - db.auth.updateMany({ userId: userId, type: 'password' }, { $set: { key: newEmail } })
 * - Used for email updates, account management, admin operations
 *
 * Performance: Enables efficient user-centric auth operations
 * Use Case: Update email across all auth records, account deletion cleanup
 */
AuthSchema.index({ userId: 1, type: 1 }, {
  name: 'idx_userId_type_management'
});
