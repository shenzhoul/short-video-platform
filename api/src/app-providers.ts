/**
 * Centralized Application Providers Configuration
 *
 * This file consolidates all provider registrations for the NestJS application.
 * It includes services, guards, listeners, jobs, and gateways organized by domain.
 *
 * Provider Categories:
 * - Services: Business logic and data access services
 * - Guards: Authentication and authorization guards
 * - Listeners: Event listeners for asynchronous processing
 * - Jobs: Background job processors for scheduled tasks
 * - Gateways: WebSocket gateways for real-time communication
 *
 * Domain Organization:
 * - Core: Main application services (app, mailer, contact)
 * - Auth: Authentication and authorization components
 * - Identity: User management services
 * - Content: User-generated content services and processing
 * - Community: User interactions (comments, reactions, messaging)
 * - Publishing: Platform content management
 * - System: Platform administration and settings
 * - Shared: Cross-cutting utility services
 *
 * Architecture Notes:
 * - Orchestrator services (IdentityService, ContentService, FinanceService) are used
 *   to resolve circular dependencies between domain services
 * - Event listeners handle asynchronous processing and maintain data consistency
 * - Background jobs perform maintenance tasks and scheduled operations
 * - WebSocket gateways enable real-time features like chat and streaming
 *
 * Usage:
 * This array is imported in app.module.ts to register all providers with NestJS.
 * The dependency injection container will handle service instantiation and lifecycle.
 */

// Import all services from centralized index

// Import guards
import { FileServerService, UploadPolicyService } from 'src/services/shared/file-server';
import { AuthGuard, RoleGuard } from './common/guards';
import { WsUserConnectedGateway } from './gateways/socket/user-connected.gateway';

import {
  AppService,
  AuthService,
  PasswordHasherService,
  AuthTokenService,
  AuthMailService,
  AuthRateLimitService,
  EmailVerificationService,
  PasswordRecoveryService,
  MailConfigService,
  MailerService,
  mailProviderFactory,
  SettingService,
  TokenService,
  BaseUserService,
  UserAccountManagementService,
  UserSearchAndFilterService,
  AuthUserCacheService,
  IdentityFileService,
  PostService,
  PostSearchService,
  PostRecommendationService,
  SocketUserService,
  CommentService,
  CreatorAnalyticsService,
  NotificationService,
  ReactionService,
  FollowService,
  ConversationService,
  ConversationParticipantService,
  MessagePermissionService,
  MessageService,
  MessageSystemNoticeService,
  UserRelationshipService,
  SharedPostService,
  PostShareService,
  PostStatisticsService,
  CategoryService,
  CommunicationService,
  ContentPermissionService
} from './services';
import { CommentImageIntegrityService } from 'src/services/community/comment/comment-image-integrity.service';
import { CommentRoomService } from 'src/services/socket/comment-room.service';
import { CommentStatsCoalescerService } from 'src/services/socket/comment-stats-coalescer.service';
import { FollowStatsCoalescerService } from 'src/services/socket/follow-stats-coalescer.service';
import { PostRoomService } from 'src/services/socket/post-room.service';
import { PostStatsCoalescerService } from 'src/services/socket/post-stats-coalescer.service';
import { PostStatsFlushJob } from 'src/jobs/socket/post-stats-flush.job';
import { SocketCleanupJob } from 'src/jobs/socket/socket-cleanup.job';
import { CleanupUnusedFilesJob } from 'src/jobs/content/cleanup-unused-files.job';
import { CleanupAuthTokensJob } from 'src/jobs/identity/cleanup-auth-tokens.job';
import { TagTrendingJob } from 'src/jobs/content/tag-trending.job';
import { CreatorAssetsListener, UserConnectedListener } from 'src/listeners/identity/user';
import {
  ContentFileService,
  ContentService,
  PostCrudService,
  PostDeletionCleanupService
} from 'src/services/content';
import { PostMediaService } from 'src/services/content/post/post-media.service';
import { SearchService } from 'src/services/content/search';
import { TagStatisticsService, TagTrendingService } from 'src/services/content/tag';
import { FollowStatsListener } from 'src/listeners/community/follow-stats.listener';
import { PostRoomListener } from 'src/listeners/community/post-room.listener';
import { CommentContentListener, PostDeletionListener, ReactionAssetsListener } from 'src/listeners/content';
import { CreatorDeletePostListener } from 'src/listeners/content/post';
import { ReactionCommentListener, ReplyCommentListener } from 'src/listeners/community/comment';
import {
  MessageDeliveryListener,
  MessageMutualFollowListener,
  MessageRelationshipClearedListener
} from 'src/listeners/community/message';
import { PostShareRecordListener } from 'src/listeners/community/share';
import {
  NotificationCommentListener,
  NotificationDeliveryListener,
  NotificationPostMentionListener,
  NotificationReactionListener
} from 'src/listeners/community/notification';

/**
 * Application Providers Array
 *
 * Complete list of all providers to be registered with the NestJS dependency injection container.
 * Providers are organized by domain and functionality for better maintainability and understanding.
 *
 * Adding New Providers:
 * 1. Import the provider class from the appropriate service/guard/listener file
 * 2. Add it to the appProviders array in the appropriate domain section
 * 3. Follow the existing organization and commenting patterns
 * 4. Consider dependencies and circular dependency prevention
 *
 * Provider Types Included:
 * - Injectable services for business logic
 * - Guards for route protection and authorization
 * - Event listeners for asynchronous processing
 * - Background jobs for scheduled tasks
 * - WebSocket gateways for real-time communication
 */
export const appProviders = [
  // Core services
  AppService,

  // File services
  FileServerService, // File server integration service
  UploadPolicyService, // Per-type upload limits, enforced before an upload URL exists
  CleanupUnusedFilesJob,
  TagTrendingJob,

  // Transactional email. `mailProviderFactory` binds the MAIL_PROVIDER token to
  // exactly one of the SMTP or log implementations, chosen from validated
  // configuration — see mail-provider.factory.ts.
  MailConfigService,
  mailProviderFactory,
  MailerService,

  // Auth services and guards
  AuthService,
  // The single owner of how a password is stored and verified.
  PasswordHasherService,
  TokenService,
  AuthGuard,
  RoleGuard,
  AuthUserCacheService,
  // Single-use email verification / password reset tokens, and the two flows
  // built on them.
  AuthTokenService,
  AuthMailService,
  AuthRateLimitService,
  EmailVerificationService,
  PasswordRecoveryService,
  CleanupAuthTokensJob,

  // Content services and listeners
  ContentService,
  ContentFileService,
  SearchService,
  CommentContentListener,
  ReactionAssetsListener,

  // Comment services and listeners
  CommentService,
  ReplyCommentListener,
  ReactionCommentListener,
  CommunicationService,
  ContentPermissionService,

  // Reaction services
  ReactionService,
  FollowService,

  // Direct message services and listeners
  ConversationService,
  ConversationParticipantService,
  MessagePermissionService,
  MessageService,
  SharedPostService,
  MessageSystemNoticeService,
  MessageDeliveryListener,
  MessageMutualFollowListener,
  MessageRelationshipClearedListener,

  // Block / restrict, and sharing a post into a message
  UserRelationshipService,
  PostShareService,
  PostShareRecordListener,

  // Notification services and listeners
  NotificationService,
  NotificationReactionListener,
  NotificationCommentListener,
  NotificationPostMentionListener,
  NotificationDeliveryListener,

  // Post services and listeners
  PostCrudService,
  PostDeletionCleanupService,
  PostMediaService,
  PostService,
  PostSearchService,
  PostRecommendationService,
  TagStatisticsService,
  TagTrendingService,
  PostDeletionListener,
  PostRoomListener,
  FollowStatsListener,
  CreatorDeletePostListener,
  PostStatisticsService,
  CategoryService,

  // Socket services and gateways
  SocketUserService,
  WsUserConnectedGateway,
  SocketCleanupJob,
  PostStatsFlushJob,
  PostRoomService,
  PostStatsCoalescerService,
  CommentImageIntegrityService,
  CommentRoomService,
  CommentStatsCoalescerService,
  FollowStatsCoalescerService,

  // User services and listeners
  BaseUserService,
  UserAccountManagementService,
  UserSearchAndFilterService,
  IdentityFileService,
  UserConnectedListener,
  CreatorAssetsListener,
  CreatorAnalyticsService,

  // Settings services
  SettingService
];
