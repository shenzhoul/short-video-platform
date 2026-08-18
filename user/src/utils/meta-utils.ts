/**
 * Meta Utils - Helper functions for generating SEO metadata
 *
 * Provides utilities for:
 * - Trimming and sanitizing names and usernames
 * - Limiting description character counts
 * - Generating consistent meta tags across pages
 * - Handling fallback values for missing data
 */

/**
 * Trims and sanitizes a name or username
 * Removes extra whitespace and limits length
 */
export function trimName(name: string | null | undefined, maxLength: number = 50): string {
  if (!name) return '';

  return name
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .substring(0, maxLength)
    .trim();
}

/**
 * Trims and sanitizes a username
 * Removes @ symbol if present and limits length
 */
export function trimUsername(username: string | null | undefined, maxLength: number = 30): string {
  if (!username) return '';

  return username
    .trim()
    .replace(/^@+/, '') // Remove leading @ symbols
    .replace(/\s+/g, '') // Remove all spaces
    .substring(0, maxLength)
    .trim();
}

/**
 * Default meta values for fallback
 */
export const DEFAULT_META = {
  siteName: 'Douyin Clone',
  defaultTitle: 'Douyin Clone - Premium Content Platform',
  defaultDescription: 'Discover amazing content creators and exclusive content on Douyin Clone.',
  defaultKeywords: 'content creators, premium content, subscription platform, live streaming',
  defaultImage: '/og-image.jpg'
} as const;

/**
 * Gets the base URL for the site
 */
function getBaseUrl(): string {
  return process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:8081';
}

/**
 * Gets the default OG image URL
 */
function getDefaultImageUrl(): string {
  const baseUrl = getBaseUrl();
  return `${baseUrl}/og-image.jpg`;
}

/**
 * Generates a canonical URL for the current page
 */
export function getCanonicalUrl(path: string): string {
  const baseUrl = getBaseUrl();
  return `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Generates a display name from name and username
 * Prioritizes name, falls back to username, with proper trimming
 */
export function getDisplayName(name: string | null | undefined, username: string | null | undefined): string {
  const trimmedName = trimName(name);
  const trimmedUsername = trimUsername(username);

  if (trimmedName) {
    return trimmedName;
  }

  if (trimmedUsername) {
    return `@${trimmedUsername}`;
  }

  return 'User';
}

/**
 * Limits description text and adds ellipsis if truncated
 * Removes extra whitespace and HTML tags
 */
export function limitDescription(description: string | null | undefined, maxLength: number = 160): string {
  if (!description) return '';

  // Remove HTML tags and normalize whitespace
  const cleanText = description
    .replace(/<[^>]*>/g, '') // Remove HTML tags
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .trim();

  if (cleanText.length <= maxLength) {
    return cleanText;
  }

  // Find the last complete word within the limit
  const truncated = cleanText.substring(0, maxLength);
  const lastSpaceIndex = truncated.lastIndexOf(' ');

  if (lastSpaceIndex > maxLength * 0.8) {
    // If we can find a good word boundary, use it
    return truncated.substring(0, lastSpaceIndex) + '...';
  } else {
    // Otherwise, just truncate at the limit
    return truncated + '...';
  }
}

/**
 * Generates SEO-friendly keywords from various inputs
 * Combines and deduplicates keywords
 */
export function generateKeywords(...inputs: (string | null | undefined)[]): string {
  const keywords = inputs
    .filter(Boolean)
    .map(input => input!.toLowerCase().trim())
    .join(', ')
    .split(/[,\s]+/)
    .filter(keyword => keyword.length > 2)
    .filter((keyword, index, array) => array.indexOf(keyword) === index) // Remove duplicates
    .slice(0, 10); // Limit to 10 keywords

  return keywords.join(', ');
}

/**
 * Sanitizes text for use in meta tags
 * Removes special characters that might break HTML
 */
export function sanitizeForMeta(text: string | null | undefined): string {
  if (!text) return '';

  return text
    .replace(/[<>'"&]/g, '') // Remove HTML-breaking characters
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generates complete metadata object for a creator profile
 */
export function generateCreatorMeta(creator: {
  name?: string | null;
  username?: string | null;
  bio?: string | null;
  avatar?: string | null;
}) {
  const displayName = getDisplayName(creator.name, creator.username);
  const trimmedUsername = trimUsername(creator.username);
  const description = limitDescription(
    creator.bio || `Check out ${displayName}'s profile.`
  );
  const keywords = generateKeywords(
    trimmedUsername,
    trimName(creator.name),
    'model',
    'creator',
    'content'
  );

  const imageUrl = creator.avatar || getDefaultImageUrl();

  return {
    title: `${displayName}`, //  | ${DEFAULT_META.siteName} // in the layout we have site name suffix
    description: sanitizeForMeta(description),
    keywords,
    openGraph: {
      title: displayName,
      description: sanitizeForMeta(description),
      images: [imageUrl],
      type: 'profile' as const
    },
    twitter: {
      card: 'summary_large_image' as const,
      title: displayName,
      description: sanitizeForMeta(description),
      images: [imageUrl]
    }
  };
}
