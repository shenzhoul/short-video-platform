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
 * Stored on the post as a stable `key`; the `label` is presentation only, so the UI wording (or its
 * translation) can change without touching stored data. Deliberately a constant rather than a
 * collection — there is no admin CRUD, hierarchy, or per-topic metadata to justify one yet.
 */
export const POST_TOPICS = [
  { key: 'knowledge', label: 'Knowledge' },
  { key: 'games', label: 'Games' },
  { key: 'anime', label: 'Anime' },
  { key: 'music', label: 'Music' },
  { key: 'film', label: 'Film and television' },
  { key: 'food', label: 'Gourmet' },
  { key: 'lifestyle', label: 'Life on Vlog' },
  { key: 'sports', label: 'Sports' },
  { key: 'travel', label: 'Travel' },
  { key: 'parenting', label: 'Parent-child' },
  { key: 'animals', label: 'Animals' },
  { key: 'beauty', label: 'Wearing beauty' },
  { key: 'photography', label: 'Photography' }
] as const;

export const POST_TOPIC_KEYS = POST_TOPICS.map(topic => topic.key);

export type PostTopicKey = typeof POST_TOPICS[number]['key'];

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