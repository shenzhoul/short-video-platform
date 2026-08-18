/**
 * Username Validation Constants
 *
 * Shared constants for username validation across the application.
 * Contains reserved usernames, validation rules, and configuration.
 */

/**
 * Reserved usernames organized by category
 * These usernames are forbidden to prevent routing conflicts
 */
export const RESERVED_USERNAME_CATEGORIES = {
  // Core system routes from user application
  SYSTEM_ROUTES: [
    'api', 'admin', 'www', 'mail', 'ftp', 'localhost', 'root', 'system',
    'support', 'help', 'info', 'contact', 'about', 'terms', 'privacy',
    'security', 'legal', 'dmca', 'copyright', 'abuse', 'noreply', 'no-reply'
  ],

  // Authentication and user management
  AUTH_ROUTES: [
    'auth', 'login', 'logout', 'register', 'signup', 'signin', 'password',
    'forgot', 'reset', 'verify', 'verification', 'confirm', 'confirmation',
    'activate', 'activation', 'email-verification', 'email-verified-success',
    'fan-register', 'creator-register', 'resend-verification-email'
  ],

  // Private application routes (from middleware.ts)
  PRIVATE_ROUTES: [
    'account', 'community', 'content', 'dashboard',
    'settings', 'black-list', 'blacklist', 'bookmarks', 'favorites',
    'messages', 'notifications', 'posts', 'video'
  ],

  // Public routes and content
  PUBLIC_ROUTES: [
    'post', 'posts', 'page', 'pages',
    'home', 'index', 'main', 'search', 'browse', 'explore', 'discover',
    'trending', 'popular', 'new', 'latest', 'recent', 'featured', 'recommended', 'top',
    'by-rank', 'categories', 'category', 'tags', 'tag', 'help-center',
    'blog', 'blogs', 'news', 'press', 'media', 'careers', 'jobs', 'team', 'partners',
    'affiliates', 'affiliate', 'developers', 'api-docs', 'api-documentation',
    'status', 'roadmap', 'community-guidelines', 'faq', 'faqs', 'testimonials', 'reviews',
    'events', 'event', 'contests', 'contest', 'promotions', 'promotion', 'offers', 'offer',
    'sitemap', 'rss', 'feed', 'feeds', 'widgets', 'widget', 'tools', 'tool',
    'resources', 'resource', 'tutorials', 'tutorial', 'documentation', 'docs',
    'guides', 'guide', 'terms-of-service', 'acceptable-use-policy', 'aup',
    'cookie-policy', 'cookie-settings', 'gdpr', 'ccpa', 'eu-consent', 'accessibility',
    'security-policy', 'security-incident', 'bug-bounty', 'report-bug', 'report-issue',
    'contact-us', 'feedback', 'suggestions', 'sponsors', 'sponsor', 'donate', 'donation',
    'press-kit', 'brand-assets', 'media-kit', 'investors', 'investor-relations', 'ir',
    'legal-notice', 'disclaimer', 'site-map',
    'who-we-are', 'what-we-do', 'our-mission', 'our-values', 'leadership', 'board-of-directors',
    'newsroom', 'in-the-news', 'awards', 'recognition', 'testimonials', 'case-studies', 'case-study',
    'webinars', 'webinar', 'podcasts', 'podcast', 'videos', 'video', 'press-releases', 'press-release',
    'influencers', 'influencer', 'ambassadors', 'ambassador', 'community', 'forums', 'forum', 'discussions', 'discussion',
    'groups', 'group', 'meetups', 'meetup', 'events', 'event', 'workshops', 'workshop', 'courses', 'course'
  ],

  // Technical and infrastructure
  TECHNICAL: [
    'static', 'assets', 'public', 'uploads', 'files', 'images', 'videos',
    'documents', 'media', 'download', 'cdn', 'cache', 'tmp', 'temp',
    'backup', 'logs', 'error', 'errors', '404', '500', 'maintenance',
    'revalidate', 'sitemap', 'robots', 'favicon'
  ],

  // Social media platforms
  SOCIAL_PLATFORMS: [
    'facebook', 'twitter', 'instagram', 'youtube', 'tiktok', 'snapchat',
    'linkedin', 'pinterest', 'reddit', 'discord', 'telegram', 'whatsapp'
  ],

  // Content and media types
  CONTENT_TYPES: [
    'photo', 'photos', 'video', 'videos',
    'chat', 'message', 'post', 'post', 'album', 'albums'
  ],

  // Moderation and safety
  MODERATION: [
    'report', 'reports', 'flag', 'flags', 'block', 'blocked', 'ban', 'banned',
    'suspend', 'suspended', 'delete', 'deleted', 'remove', 'removed',
    'moderate', 'moderation', 'review', 'reviews'
  ],

  // User roles and status
  USER_ROLES: [
    'user', 'users', 'profile', 'profiles', 'admin', 'administrator',
    'moderator', 'staff', 'employee', 'official', 'verified', 'premium', 'vip'
  ],

  // Development and testing
  DEVELOPMENT: [
    'test', 'testing', 'demo', 'example', 'sample', 'placeholder', 'null',
    'undefined', 'true', 'false', 'dev', 'development', 'staging', 'prod'
  ]
};

// Flatten all reserved usernames into a single array
export const ALL_RESERVED_USERNAMES = Object.values(RESERVED_USERNAME_CATEGORIES).flat();

/**
 * Username validation configuration
 */
export const USERNAME_CONFIG = {
  MIN_LENGTH: 3,
  MAX_LENGTH: 30,
  ALLOWED_PATTERN: /^[a-zA-Z0-9_]{3,30}$/,
  FORBIDDEN_PATTERNS: [
    /^_/, // Cannot start with underscore
    /_$/, // Cannot end with underscore
    /__/, // Cannot contain consecutive underscores
    /^\d+$/, // Cannot be all numbers
    /^[_\d]+$/ // Cannot be only underscores and numbers
  ]
};

/**
 * Username validation utility functions
 */
export const USERNAME_UTILS = {
  /**
   * Check if username format is valid
   */
  isValidFormat(username: string): boolean {
    return USERNAME_CONFIG.ALLOWED_PATTERN.test(username);
  },

  /**
   * Check if username is reserved
   */
  isReserved(username: string): boolean {
    const lowercaseUsername = username.toLowerCase();
    return ALL_RESERVED_USERNAMES.includes(lowercaseUsername);
  },

  /**
   * Check if username matches forbidden patterns
   */
  matchesForbiddenPattern(username: string): boolean {
    return USERNAME_CONFIG.FORBIDDEN_PATTERNS.some((pattern) => pattern.test(username));
  },

  /**
   * Get reserved username category
   */
  getReservedCategory(username: string): string | null {
    const lowercaseUsername = username.toLowerCase();
    const categoryEntry = Object.entries(RESERVED_USERNAME_CATEGORIES).find(([, words]) => words.includes(lowercaseUsername));

    if (categoryEntry) {
      const [category] = categoryEntry;
      return category.toLowerCase().replace('_', ' ');
    }

    return null;
  },

  /**
   * Validate username completely
   */
  validate(username: string): { isValid: boolean; reason?: string; category?: string } {
    if (!username) {
      return { isValid: false, reason: 'Username is required' };
    }

    if (!this.isValidFormat(username)) {
      return {
        isValid: false,
        reason: `Username must be ${USERNAME_CONFIG.MIN_LENGTH}-${USERNAME_CONFIG.MAX_LENGTH} characters and contain only letters, numbers, and underscores`
      };
    }

    if (this.isReserved(username)) {
      const category = this.getReservedCategory(username);
      return {
        isValid: false,
        reason: 'Username is reserved and cannot be used',
        category
      };
    }

    if (this.matchesForbiddenPattern(username)) {
      return {
        isValid: false,
        reason: 'Username format is invalid (cannot start/end with underscore, be all numbers, or contain consecutive underscores)'
      };
    }

    return { isValid: true };
  }
};
