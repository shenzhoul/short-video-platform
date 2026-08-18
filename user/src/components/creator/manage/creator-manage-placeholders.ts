/**
 * Frontend-only placeholders for Creator Management.
 *
 * Everything the Douyin reference shows that this API cannot answer yet lives here — in one file, so
 * "which of these numbers is real?" has a single answer instead of being scattered through the JSX.
 *
 * Nothing here is written to, read from, or typed into `IPost`. Real values come from the API and are
 * passed separately at the call site; these are display-only strings so they can never be mistaken
 * for data or accidentally submitted.
 *
 * Each entry carries a TODO naming what the backend would have to provide.
 */

export interface PlaceholderMetric {
  label: string;
  /** Display string, deliberately not a number — these are not measurements. */
  value: string;
}

export interface PlaceholderAction {
  label: string;
  /** Shown on hover to explain why the control does nothing. */
  title: string;
  tone?: 'default' | 'danger';
}

/**
 * Engagement metrics shown after the three real ones on a video post.
 *
 * TODO(backend): Collection needs `Post.totalSave` plus the tracking that increments it. Bullet
 * comment needs a danmaku feature. The three rates need per-view playback telemetry (watch time,
 * cover impressions), which no endpoint records today.
 *
 * Share is no longer here: it is measured by `Post.totalShare` and passed in at the call site.
 */
export const PLACEHOLDER_VIDEO_METRICS: PlaceholderMetric[] = [
  { label: 'Collection', value: '0' },
  { label: 'Completion rate', value: '0' },
  { label: 'Cover click through rate', value: '0%' },
  { label: 'Average watch percentage', value: '0%' },
  { label: 'Followers gained', value: '0' }
];

/**
 * The reference swaps three of the video metrics for image-specific ones on a graphic post.
 *
 * TODO(backend): same as above, plus carousel interaction tracking for swipe-away, copy expansion
 * and average images viewed.
 */
export const PLACEHOLDER_GRAPHIC_METRICS: PlaceholderMetric[] = [
  { label: 'Collection', value: '0' },
  { label: 'Completion rate', value: '0%' },
  { label: 'Copy expansion rate', value: '0%' },
  { label: 'Average view of images', value: '0' },
  { label: 'Followers gained', value: '0' }
];

/**
 * Row actions beside Edit that remain frontend-only.
 *
 * Pinning is intentionally absent: it is backed by the creator pin API and rendered directly by
 * CreatorPostRow. Set permissions still needs a per-post visibility field.
 */
export const PLACEHOLDER_ROW_ACTIONS: PlaceholderAction[] = [
  { label: 'Set permissions', title: 'Post permissions are not available yet' }
];

export const PLACEHOLDER_GRAPHIC_ROW_ACTIONS: PlaceholderAction[] = PLACEHOLDER_ROW_ACTIONS;

/**
 * Review-state filters.
 *
 * TODO(backend): `PostSearchRequest` has no `status` field and `PostSearchService.search()` ignores
 * one, so only "All of them" can be honoured. A moderation state beyond active/deleted does not
 * exist in the schema at all.
 */
export const PLACEHOLDER_STATUS_FILTERS = [
  'Published',
  'Under review',
  'It was not approved'
] as const;

/**
 * Right-hand toolbar controls.
 *
 * TODO(backend): Genre would map to `topicKey` (supported by the API but not wired here), date range
 * to `fromDate`/`toDate` (also supported), keyword search to `q`. Export has no endpoint.
 */
export const PLACEHOLDER_TOOLBAR_CONTROLS = {
  genre: 'All',
  dateRange: 'All the time',
  search: 'Search for works',
  export: 'Export data'
} as const;

/**
 * Second tab in the reference.
 *
 * TODO(backend): collections/playlists of works are not modelled — there is no schema, endpoint or
 * relation for grouping posts.
 */
export const PLACEHOLDER_COLLECTION_COUNT = 0;
