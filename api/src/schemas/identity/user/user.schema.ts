import {
  Prop, Schema, SchemaFactory
} from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { HydratedDocument, Schema as MongooseSchema } from 'mongoose';
import { USER_STATUS } from 'src/common/constants';

@Schema({
  _id: false
})
export class CreatorStats {
  /**
   * Total number of likes received across the creator's content
   */
  @Prop({
    default: 0
  })
  totalLikes: number;

  /**
   * Total number of followers for the creator
   */
  @Prop({
    default: 0
  })
  followers: number;

  /** Total number of creator profiles this user follows. */
  @Prop({ default: 0 })
  followings: number;

  /**
   * Total number of posts created by the creator
   */
  @Prop({
    default: 0
  })
  totalPosts: number;
}

const CreatorStatsSchema = SchemaFactory.createForClass(CreatorStats);

@Schema({
  collection: 'users',
  timestamps: true
})
export class User {
  /**
   * Indicates if the user has administrative privileges
   */
  @Prop({
    type: Boolean,
    default: false
  })
  isAdmin: boolean;

  /**
   * Full display name of the user
   */
  @Prop()
  name: string;

  /**
   * User's first name
   */
  @Prop()
  firstName: string;

  /**
   * User's last name
   */
  @Prop()
  lastName: string;

  /**
   * Unique username for the user profile (used in URLs and mentions)
   */
  @Prop({
    type: String,
    trim: true
  })
  username: string;

  /**
   * User's email address (stored in lowercase for case-insensitive operations)
   */
  @Prop({
    type: String,
    lowercase: true,
    trim: true
  })
  email: string;

  /**
   * Indicates if the user's email has been verified
   */
  @Prop({
    default: false
  })
  verifiedEmail: boolean;

  /**
   * Reference to the user's avatar file
   */
  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  avatarId: ObjectId;

  /**
   * Full URL to the user's avatar image
   */
  @Prop()
  avatar: string; // full url to the avatar image

  @Prop({
    type: MongooseSchema.Types.ObjectId
  })
  coverId: ObjectId;

  @Prop()
  cover: string;

  @Prop()
  coverBgColor: string;

  @Prop()
  bio: string;

  /**
   * Current status of the user account (active, suspended, deleted, etc.)
   */
  @Prop({
    default: USER_STATUS.ACTIVE
  })
  status: string;

  /**
   * User's gender
   */
  @Prop()
  gender: string;

  /**
   * User's current balance in the platform currency
   */
  @Prop({
    default: 0
  })
  balance: number;

  /**
   * Indicates if the user is currently online
   */
  @Prop()
  isOnline: boolean;

  /**
   * Timestamp when the user came online
   */
  @Prop()
  onlineAt: Date;

  /**
   * Timestamp when the user went offline
   */
  @Prop()
  offlineAt: Date;

  /**
   * User's date of birth
   */
  @Prop()
  dateOfBirth: Date;

  /**
 * Creator statistics and metrics
 */
  @Prop({
    type: CreatorStatsSchema,
    default: {
      totalLikes: 0,
      followers: 0,
      followings: 0,
      totalPosts: 0
    }
  })
  stats: CreatorStats;

  /**
   * Account creation timestamp
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  createdAt: Date;

  /**
   * Last update timestamp
   */
  @Prop({
    type: Date,
    default: Date.now
  })
  updatedAt: Date;

  /**
   * Flexible metadata object containing additional user information
   */
  @Prop({
    type: MongooseSchema.Types.Mixed,
    default: {}
  })
  metadata: {
    [key: string]: any;
    /** Deletion tracking information */
    deletion?: {
      /** Timestamp when the account was deleted */
      deletedAt: Date;
      /** Admin user ID who performed the deletion */
      deletedBy: ObjectId;
      /** Original username before anonymization */
      originalUsername: string;
      /** Original email before anonymization */
      originalEmail: string;
      /** Original name before anonymization */
      originalName?: string;
      /** Reason for deletion (if provided) */
      reason?: string;
      /** IP address from which deletion was performed */
      deletionIp?: string;
    };
    /** Account creation tracking */
    creation?: {
      /** IP address used during registration */
      registrationIp?: string;
      /** User agent during registration */
      registrationUserAgent?: string;
      /** Referral source */
      referralSource?: string;
    };
    /** Login tracking */
    lastLogin?: {
      /** Last login timestamp */
      timestamp: Date;
      /** IP address of last login */
      ip?: string;
      /** User agent of last login */
      userAgent?: string;
    };
    /** Additional custom metadata */
  };
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

/**
 * UNIQUE EMAIL CONSTRAINT INDEX FOR AUTHENTICATION
 *
 * Purpose: Ensures email uniqueness and enables fast login lookups
 * Business Logic: User registration and authentication system
 *
 * Query Pattern:
 * - db.users.findOne({ email: 'user@example.com' })
 * - Used for login, registration, password reset operations
 *
 * Performance: O(log n) lookup for authentication
 * Constraint: Enforces business rule of unique email addresses
 * Sparse: Allows null emails for social login users
 */
UserSchema.index({ email: 1 }, {
  name: 'idx_email_unique_auth',
  unique: true,
  sparse: true
});

/**
 * UNIQUE USERNAME CONSTRAINT INDEX FOR PROFILES
 *
 * Purpose: Ensures username uniqueness and enables profile URL lookups
 * Business Logic: User profiles accessible via /profile/username
 *
 * Query Pattern:
 * - db.users.findOne({ username: 'johndoe' })
 * - Used for profile pages, @mentions, creator discovery
 *
 * Performance: O(log n) lookup for profile access
 * Constraint: Enforces business rule of unique usernames
 * Sparse: Allows null usernames during registration process
 */
UserSchema.index({ username: 1 }, {
  name: 'idx_username_unique_profile',
  unique: true,
  sparse: true
});

/**
 * USER STATUS FILTERING INDEX FOR ADMIN OPERATIONS
 *
 * Purpose: Efficiently filter users by status for admin and system operations
 * Business Logic: Admin dashboard, user moderation, system cleanup jobs
 *
 * Query Pattern:
 * - db.users.find({ status: 'active' })
 * - db.users.find({ status: 'suspended' })
 * - Used for user management and automated system processes
 *
 * Performance: Enables fast filtering by user status
 * Use Case: Admin tools, user statistics, cleanup operations
 */
UserSchema.index({ status: 1, createdAt: -1 }, {
  name: 'idx_status_createdAt_admin'
});

/**
 * CREATOR SCORE INDEX
 *
 * Purpose: Standalone index for score field to support queries with score filters
 * Business Logic: Score-based filtering, range queries on score values
 *
 * Query Pattern:
 * - db.users.find({ score: { $gte: 100 } })
 * - db.users.find({ score: { $exists: true } })
 * - Used for score filtering and range queries
 *
 * Performance: Enables efficient score filtering and null/zero handling
 * Use Case: Score-based filtering, quality thresholds
 */
UserSchema.index({ score: -1 }, {
  name: 'idx_score_standalone'
});

/**
 * CREATOR SCORE RANKING INDEX
 *
 * Purpose: Efficiently sort creators by score for ranking and recommendations
 * Business Logic: Creator ranking, recommendation algorithms, featured creators
 *
 * Query Pattern:
 * - db.users.find({ isCreator: true }).sort({ score: -1 })
 * - Used for creator ranking and recommendation systems
 *
 * Performance: Enables efficient score-based sorting with cursor pagination
 * Use Case: Creator recommendations, ranking algorithms, popular sorting
 */
UserSchema.index({ score: -1, _id: -1 }, {
  name: 'idx_score_cursor_pagination'
});
