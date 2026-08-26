// ===== FILE CONSTANTS =====

/**
 * File reference types
 * Defines what types of entities files can be attached to
 */
export const FILE_REFERENCE_TYPES = {
  /** File attached to post post */
  POST: 'post',
  /** File attached to user profile */
  USER: 'user'
} as const;

// ===== POST CONSTANTS =====

/**
 * Social post content types
 * Different types of content that can be posted to posts
 */
export const POST_TYPES = {
  /** Text post — plain text with optional formatting (bold/emoji/links) */
  TEXT: 'text',
  /** Photo post — single or multiple photos */
  PHOTO: 'photo',
  /** Video post — single or video carousel with preview & thumbnail selection */
  VIDEO: 'video'
} as const;

/** Post type: text | photo | video | audio | scheduled_stream */
export const POST_CREATE_TYPES = ['text', 'photo', 'video'] as const;

/**
 * Broad content categories a creator can file a post under.
 *
 * The catalogue itself lives in the `categories` collection and is managed from the admin app —
 * these constants only describe the shape a category key must have. A post stores the category's
 * stable `key` in `Post.topicKey`, so renaming a category never touches stored post data.
 */

/** Statuses a category can be in. `inactive` hides it from the catalogue without deleting it. */
export const POST_CATEGORY_STATUSES = ['active', 'inactive'] as const;

export type PostCategoryStatus = typeof POST_CATEGORY_STATUSES[number];

/**
 * Longest accepted category key. Keys are identifiers stored on every matching post, not prose —
 * this is generous for a slug and still short enough to stay readable in a query.
 */
export const POST_CATEGORY_KEY_MAX_LENGTH = 50;

/** Longest accepted category display name. */
export const POST_CATEGORY_NAME_MAX_LENGTH = 100;

/** Longest accepted category description. */
export const POST_CATEGORY_DESCRIPTION_MAX_LENGTH = 500;

/** Highest accepted `ordering` value. Keeps the field a display hint rather than an arbitrary int. */
export const POST_CATEGORY_MAX_ORDERING = 9999;

/**
 * Accepted category key format: lowercase letters and digits, single hyphens between segments.
 *
 * Deliberately narrower than a generic slug. The key is compared verbatim against `Post.topicKey`
 * and appears in query strings, so anything needing escaping or case folding is refused up front.
 */
export const POST_CATEGORY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Post-related event channels
 * Socket/queue channels for post events
 */
export const POST_CHANNELS = {
  /** Creator post events */
  CREATOR_POST: 'CREATOR_POST_CHANNEL',
  /** Post video events */
  POST_VIDEO: 'POST_VIDEO_CHANNEL',
  /** Post teaser events */
  POST_TEASER: 'POST_TEASER_CHANNEL'
} as const;