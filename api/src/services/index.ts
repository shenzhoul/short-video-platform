/**
 * Centralized Service Exports
 * Domain Organization:
 * - Core: Main application services
 * - Shared: Cross-cutting utility services (file, email, search, etc.)
 * - Identity: User authentication and management
 * - Publishing: Platform-managed content (banners, categories, posts)
 * - Community: User interactions (comments, reactions, messaging)
 * - Content: Creator-generated content (posts)
 * - Socket: Real-time communication services
 * - System: Platform administration and settings
 *
 * Usage:
 * ```typescript
 * // Import specific services (recommended for tree-shaking)
 * import { UserService, AuthService } from 'src/services';
 *
 * // Or import from domain-specific files
 * import { UserAccountManagementService } from 'src/services/identity/user/user.service';
 * ```
 */

// Core app services
export { AppService } from '../app.service';

// Identity services
export { AuthService } from './identity/auth/auth.service';
export { TokenService } from './identity/auth/token.service';
export { PasswordHasherService } from './identity/auth/password-hasher.service';
export { AuthTokenService } from './identity/auth/auth-token.service';
export { AuthMailService } from './identity/auth/auth-mail.service';
export { AuthRateLimitService } from './identity/auth/auth-rate-limit.service';
export { EmailVerificationService } from './identity/auth/email-verification.service';
export { PasswordRecoveryService } from './identity/auth/password-recovery.service';
export { BaseUserService } from './identity/user/base-user.service';
export { UserAccountManagementService } from './identity/user/user.service';
export { UserSearchAndFilterService } from './identity/user/user-search.service';
export { AuthUserCacheService } from './identity/auth-user-cache.service';
export { IdentityFileService } from './identity/identity.file.service';
export { CreatorAnalyticsService } from './identity/user/creator-analytics.service';

// Community services
export { CommentService } from './community/comment/comment.service';
export { NotificationService } from './community/notification';
export { ReactionService } from './community/reaction/reaction.service';
export { FollowService } from './community/follow';
export { ConversationService } from './community/message/conversation.service';
export { ConversationParticipantService } from './community/message/conversation-participant.service';
export { MessagePermissionService } from './community/message/message-permission.service';
export { MessageService } from './community/message/message.service';
export { MessageSystemNoticeService } from './community/message/message-system-notice.service';
export { UserRelationshipService } from './community/relationship/user-relationship.service';
export { SharedPostService } from './community/message/shared-post.service';
export { PostShareService } from './community/share/post-share.service';
export { CommunicationService } from './community/communication.service';
export { ContentPermissionService } from './community/content-permission.service';

// Content services
export { PostService } from './content/post/post.service';
export { PostSearchService } from './content/post/post-search.service';
export { PostStatisticsService } from './content/post/post-statistics.service';
export { CategoryService } from './content/category/category.service';

// Recommendation engine services — Home/For You candidate retrieval, scoring,
// diversity re-ranking, session pagination, and event ingestion.
export {
  RecommendationAffinityService,
  RecommendationCandidateService,
  RecommendationScoringService,
  RecommendationDiversityService,
  RecommendationSelectionService,
  RecommendationSessionService,
  PostDetailRecommendationSessionService,
  RecommendationEventService,
  RecommendationCategoryPriorService,
  RecommendationFeedService
} from './content/recommendation';

// Socket services
export { SocketUserService } from './socket/socket-user.service';

// System services
export { SettingService } from './system/setting/setting.service';

// Shared services - transactional email
export { MailConfigService } from './shared/mailer/mail-config.service';
export { MailerService } from './shared/mailer/mailer.service';
export { mailProviderFactory } from './shared/mailer/mail-provider.factory';
