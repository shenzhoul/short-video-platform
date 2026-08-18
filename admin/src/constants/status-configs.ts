/**
 * Status Configuration Constants
 *
 * Centralized status configurations for all entities in the admin panel.
 * Each configuration maps status values to their display properties (color and text).
 *
 * @description This file contains all status configurations to be used with GenericStatusTag component
 */

export interface StatusConfig {
  [key: string]: {
    color: string;
    text: string;
  };
}

/**
 * User status configuration
 * Used in: user-status-tag.tsx
 */
export const USER_STATUS_CONFIG: StatusConfig = {
  active: { color: 'green', text: 'Active' },
  inactive: { color: 'red', text: 'Inactive' },
  suspended: { color: 'volcano', text: 'Suspended' },
  banned: { color: 'red', text: 'Banned' },
  deleted: { color: 'red', text: 'Deleted' }
};

/**
 * Report status configuration
 * Used in: report-status-tag.tsx
 */
export const REPORT_STATUS_CONFIG: StatusConfig = {
  reported: { color: 'orange', text: 'Reported' },
  rejected: { color: 'red', text: 'Rejected' },
  deleted: { color: 'volcano', text: 'Deleted' },
  resolved: { color: 'green', text: 'Resolved' },
  pending: { color: 'blue', text: 'Pending' }
};

/**
 * Page status configuration
 * Used in: page-status-tag.tsx
 */
export const PAGE_STATUS_CONFIG: StatusConfig = {
  published: { color: 'green', text: 'Published' },
  draft: { color: 'orange', text: 'Draft' },
  archived: { color: 'default', text: 'Archived' },
  pending: { color: 'blue', text: 'Pending' }
};

/**
 * Post type configuration (for tags)
 * Used in: post-type-tag.tsx
 */
export const POST_TYPE_CONFIG: StatusConfig = {
  text: { color: 'blue', text: 'Text' },
  photo: { color: 'green', text: 'Photo' },
  video: { color: 'purple', text: 'Video' },
};

/**
 * Generic helper to get status config with fallback
 * @param status - The status value to look up
 * @param config - The status configuration object
 * @returns Status configuration with color and text
 */
export function getStatusConfig(status: string, config: StatusConfig) {
  const normalizedStatus = status?.toLowerCase();
  return config[normalizedStatus] || {
    color: 'default',
    text: status || 'Unknown'
  };
}
