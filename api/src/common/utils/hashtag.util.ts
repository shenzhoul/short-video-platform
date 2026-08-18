/**
 * Hashtag parsing utilities for extracting tags from text content
 */

/**
 * Extracts hashtags from a text string
 * @param text - The text to parse for hashtags
 * @returns Array of unique hashtags (without the # symbol)
 */
export function parseHashtags(text: string): string[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // Regular expression to match hashtags
  // Matches # followed by word characters, numbers, and underscores
  // Supports Unicode characters for international hashtags
  const hashtagRegex = /#[\w\u00C0-\u017F\u0400-\u04FF\u4e00-\u9fff]+/g;

  const matches = text.match(hashtagRegex);

  if (!matches) {
    return [];
  }

  // Remove # symbol and convert to lowercase for consistency
  // Remove duplicates using Set
  const hashtags = [...new Set(
    matches.map((tag) => tag.substring(1).toLowerCase())
  )];

  // Filter out empty strings and limit length
  return hashtags
    .filter((tag) => tag.length > 0 && tag.length <= 50)
    .slice(0, 20); // Limit to 20 hashtags maximum
}

/**
 * Validates if a string is a valid hashtag format
 * @param tag - The tag to validate
 * @returns True if valid hashtag format
 */
export function isValidHashtag(tag: string): boolean {
  if (!tag || typeof tag !== 'string') {
    return false;
  }

  // Check length constraints
  if (tag.length === 0 || tag.length > 50) {
    return false;
  }

  // Check for valid characters (alphanumeric, underscore, and Unicode)
  const validTagRegex = /^[\w\u00C0-\u017F\u0400-\u04FF\u4e00-\u9fff]+$/;
  return validTagRegex.test(tag);
}

/**
 * Normalizes hashtags by converting to lowercase and trimming
 * @param tags - Array of tags to normalize
 * @returns Array of normalized tags
 */
export function normalizeHashtags(tags: string[]): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .map((tag) => tag.toLowerCase().trim())
    .filter((tag) => isValidHashtag(tag))
    .filter((tag, index, arr) => arr.indexOf(tag) === index); // Remove duplicates
}

/**
 * Extracts and normalizes hashtags from text
 * @param text - The text to parse
 * @returns Array of normalized hashtags
 */
export function extractAndNormalizeHashtags(text: string): string[] {
  const hashtags = parseHashtags(text);
  return normalizeHashtags(hashtags);
}
