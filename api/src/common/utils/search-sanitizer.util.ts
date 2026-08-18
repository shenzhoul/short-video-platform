/**
 * Maximum allowed length for search queries to prevent DoS attacks
 */
const MAX_SEARCH_LENGTH = 100;

/**
 * MongoDB operators that should be removed from search queries
 * These operators could be used for injection attacks
 */
const MONGODB_OPERATORS = [
  '$where', '$regex', '$options', '$text', '$search',
  '$eq', '$ne', '$gt', '$gte', '$lt', '$lte',
  '$in', '$nin', '$exists', '$type', '$mod',
  '$all', '$elemMatch', '$size', '$slice',
  '$or', '$and', '$not', '$nor',
  '$expr', '$jsonSchema', '$geoIntersects',
  '$geoWithin', '$near', '$nearSphere'
];

/**
 * Characters a search term may keep.
 *
 * Letters, digits and combining marks from **any** script, plus whitespace, hyphen and underscore.
 * Deliberately Unicode-aware: an ASCII-only whitelist erased Chinese, Japanese, Korean and
 * decomposed Vietnamese entirely, which did not merely fail to match — it left the caller with an
 * empty term, and callers that skip their filter on an empty term then returned *every* document.
 *
 * Dropping the ASCII restriction is safe because nothing here is ever concatenated into a query
 * string: `createSafeSearchRegex` escapes what survives and hands Mongo a `RegExp` object, so the
 * characters that matter for injection are the regex metacharacters, and those are escaped, not
 * whitelisted away.
 */
const UNSAFE_SEARCH_CHARACTERS = /[^\p{L}\p{N}\p{M}\s\-_]/gu;

/**
 * Sanitize search query to prevent NoSQL injection attacks
 *
 * ✅ SECURITY: Comprehensive protection against MongoDB injection
 *
 * This function performs multiple layers of sanitization:
 * 1. Type validation - ensures input is a string
 * 2. Length validation - prevents DoS attacks
 * 3. MongoDB operator removal - prevents operator injection
 * 4. Special character sanitization - removes dangerous characters
 * 5. Whitelist filtering - only allows letters, digits, marks and separators
 *
 * @param query - Raw search query from user input
 * @returns Sanitized search query safe for MongoDB regex operations
 * @throws Error if input is not a string or is too long
 *
 * @example
 * ```typescript
 * // Safe usage
 * const userInput = "john doe";
 * const safeQuery = sanitizeSearchQuery(userInput);
 * const regex = new RegExp(safeQuery, 'i');
 *
 * // Prevents injection
 * const maliciousInput = { $where: "this.password.length > 0" };
 * const safeQuery = sanitizeSearchQuery(maliciousInput); // Throws error
 * ```
 *
 * @security CRITICAL - Prevents NoSQL injection in search operations
 */
export function sanitizeSearchQuery(query: any): string {
  // 1. Type validation - prevent object injection
  if (typeof query !== 'string') {
    throw new Error('Search query must be a string');
  }

  // 2. Length validation - prevent DoS attacks
  if (query.length > MAX_SEARCH_LENGTH) {
    throw new Error(`Search query too long. Maximum length is ${MAX_SEARCH_LENGTH} characters`);
  }

  // 3. Early return for empty queries
  if (!query || query.trim().length === 0) {
    return '';
  }

  let sanitized = query.trim();

  // 4. Remove MongoDB operators (case-insensitive)
  MONGODB_OPERATORS.forEach((operator) => {
    const regex = new RegExp(operator.replace('$', '\\$'), 'gi');
    sanitized = sanitized.replace(regex, '');
  });

  // 5. Remove dangerous characters that could be used for injection, keeping letters and digits of
  // every script so non-Latin searches survive
  sanitized = sanitized.replace(UNSAFE_SEARCH_CHARACTERS, '');

  // 6. Normalize whitespace - replace multiple spaces with single space
  sanitized = sanitized.replace(/\s+/g, ' ').trim();

  // 7. Final length check after sanitization
  if (sanitized.length === 0) {
    return '';
  }

  return sanitized;
}

/**
 * Create a safe MongoDB regex object from sanitized search query
 *
 * ✅ SECURITY: Safe regex creation for MongoDB queries
 *
 * This function combines sanitization with regex creation to provide
 * a complete solution for safe search operations in MongoDB.
 *
 * @param query - Raw search query from user input
 * @param options - Regex options (default: 'i' for case-insensitive)
 * @returns MongoDB-safe regex object or null if query is empty
 *
 * @example
 * ```typescript
 * // Create safe search regex
 * const searchRegex = createSafeSearchRegex(userInput);
 * if (searchRegex) {
 *   const mongoQuery = {
 *     $or: [
 *       { name: { $regex: searchRegex } },
 *       { username: { $regex: searchRegex } }
 *     ]
 *   };
 * }
 * ```
 *
 * @security CRITICAL - Provides safe regex for MongoDB operations
 */
export function createSafeSearchRegex(query: any, options: string = 'i'): RegExp | null {
  try {
    const sanitizedQuery = sanitizeSearchQuery(query);

    if (!sanitizedQuery) {
      return null;
    }

    // Escape any remaining regex special characters for literal matching
    const escapedQuery = sanitizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    return new RegExp(escapedQuery, options);
  } catch {
    // Log the error but don't expose details to prevent information disclosure
    return null;
  }
}