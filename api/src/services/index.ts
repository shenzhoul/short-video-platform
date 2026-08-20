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
export { CommunicationService } from './community/communication.service';
export { ContentPermissionService } from './community/content-permission.service';

// Content services
export { PostService } from './content/post/post.service';
export { PostSearchService } from './content/post/post-search.service';
export { PostRecommendationService } from './content/post/post-recommendation.service';
export { PostStatisticsService } from './content/post/post-statistics.service';

// Socket services
export { SocketUserService } from './socket/socket-user.service';

// System services
export { SettingService } from './system/setting/setting.service';
