import { MongooseModule } from '@nestjs/mongoose';
import {
  // Identity schemas
  Auth, AuthSchema,
  // User schemas
  User, UserSchema,
  // System schemas
  Setting, SettingSchema,
  // Content schemas
  Post, PostSchema,
  TagSummary, TagSummarySchema,
  PostMediaSchema, PostMedia,
  // Community schemas
  Comment, CommentSchema,
  Conversation, ConversationSchema,
  ConversationParticipant, ConversationParticipantSchema,
  Message, MessageSchema,
  Notification, NotificationSchema,
  ReactionSchema, Reaction,
} from './index';

/**
 * Centralized Mongoose Schema Registration
 *
 * This file consolidates all MongoDB schema registrations for the NestJS application.
 * It provides a single MongooseModule.forFeature configuration that registers all schemas
 * with their appropriate names and discriminators.
 *
 * Features:
 * - Centralized schema registration for better maintainability
 * - Organized by domain for easy navigation
 * - Includes discriminator configurations for inheritance (e.g., User)
 * - Single import in app.module.ts reduces boilerplate
 *
 * Schema Organization:
 * - Shared: Cross-cutting schemas (email templates, files, logging)
 * - Identity: User management and authentication schemas
 * - Publishing: Platform content management schemas
 * - Community: User interaction and social feature schemas
 * - Content: Creator-generated content schemas
 * - System: Platform administration schemas
 *
 * Usage:
 * This module is imported in app.module.ts to register all schemas with MongoDB.
 * Individual services can then inject models using @InjectModel decorator.
 *
 * Adding New Schemas:
 * 1. Import the schema class and schema definition from the appropriate domain
 * 2. Add the schema registration to the mongooseFeatures array
 * 3. Follow the existing naming and organization patterns
 * 4. Add discriminators if the schema extends another schema
 */
export const mongooseFeatures = MongooseModule.forFeature([
  // Identity schemas - Auth
  { name: Auth.name, schema: AuthSchema },

  // Identity schemas - User
  { name: User.name, schema: UserSchema },

  // System schemas
  { name: Setting.name, schema: SettingSchema },

  // Content schemas - Post
  { name: Post.name, schema: PostSchema },
  { name: PostMedia.name, schema: PostMediaSchema },

  // Content schemas - Tag
  { name: TagSummary.name, schema: TagSummarySchema },

  // Community schemas
  { name: Comment.name, schema: CommentSchema },
  { name: Conversation.name, schema: ConversationSchema },
  { name: ConversationParticipant.name, schema: ConversationParticipantSchema },
  { name: Message.name, schema: MessageSchema },
  { name: Notification.name, schema: NotificationSchema },
  { name: Reaction.name, schema: ReactionSchema }
])