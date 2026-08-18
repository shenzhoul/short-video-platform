/**
 * Server-side in-memory cache for API responses
 *
 * This cache helps prevent duplicate API calls during server-side rendering,
 * particularly useful when the same data is needed in both generateMetadata
 * and the page component.
 *
 * Features:
 * - Automatic TTL-based expiration
 * - Memory-efficient with size limits
 * - Type-safe with generics
 * - Perfect for deduplicating requests in the same render cycle
 *
 * Vercel Deployment Notes:
 * - On Vercel serverless functions, cache is per-instance and ephemeral
 * - Cache is not shared between function instances or regions
 * - Cache is cleared when function goes idle (~5-10 min) or on new deployment
 * - Still effective for request deduplication within the same function instance
 * - For distributed caching across instances, consider using Next.js unstable_cache() or Vercel KV
 * - Best suited for short-term caching and deduplication in single requests
 */

import { getApiErrorStatus } from '@lib/api-error';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class ServerCache {
  private cache: Map<string, CacheEntry<any>>;
  private maxSize: number;
  private defaultTTL: number;

  constructor(maxSize = 1000, defaultTTL = 60000 * 60) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL; // Default: 60 minutes
  }

  /**
   * Get cached data if available and not expired
   * @param key Cache key
   * @param ttl Time to live in milliseconds (optional, uses default if not provided)
   * @returns Cached data or null if not found/expired
   */
  get<T>(key: string, ttl?: number): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const maxAge = ttl ?? this.defaultTTL;
    const age = Date.now() - entry.timestamp;

    if (age > maxAge) {
      // Expired, remove from cache
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  /**
   * Set data in cache
   * @param key Cache key
   * @param data Data to cache
   */
  set<T>(key: string, data: T): void {
    // If cache is full, remove oldest entry
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Wrap an async function with caching
   * @param key Cache key
   * @param fn Async function to execute if cache miss
   * @param ttl Time to live in milliseconds (optional)
   * @returns Cached or fresh data
   */
  async getOrSet<T>(
    key: string,
    fn: () => Promise<T>,
    ttl?: number
  ): Promise<T> {
    const cached = this.get<T>(key, ttl);
    if (cached !== null) {
      return cached;
    }

    const data = await fn();
    this.set(key, data);
    return data;
  }

  /**
  * Read a cache entry without applying TTL logic.
  * Useful when callers need different TTLs for different cached payloads.
  */
  getEntry<T>(key: string): CacheEntry<T> | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    return entry as CacheEntry<T>;
  }

  /**
  * Clear specific key from cache
  * @param key Cache key to clear
  */
  clear(key: string): void {
    this.cache.delete(key);
  }
}

// Export singleton instance
export const serverCache = new ServerCache(5000, 60000 * 60); // 10000 entries, 60 minutes TTL

// Helper function to generate cache keys
export function generateCacheKey(prefix: string, ...params: (string | number | undefined)[]): string {
  return `${prefix}:${params.filter(p => p !== undefined).join(':')}`;
}

/**
 * Cached post fetcher to prevent duplicate API calls
 * between generateMetadata and page component
 *
 * @param postId Post ID
 * @param requestHeaders Optional headers for authenticated requests
 * @returns Post data
 */
export async function getCachedPost(
  postId: string,
  requestHeaders?: { [key: string]: string }
) {
  const { findOne } = await import('@services/post.service');

  // For metadata (no headers), use cache
  // For page component with auth (has headers), fetch fresh data
  if (requestHeaders) {
    const response = await findOne(postId, requestHeaders);
    return response.data;
  }

  const cacheKey = generateCacheKey('post', postId);

  return serverCache.getOrSet(
    cacheKey,
    async () => {
      const response = await findOne(postId);
      return response.data;
    }
  );
}

export type CachedCreatorLookupResult<T = any> =
  | { status: 'found'; creator: T }
  | { status: 'not-found' }
  | { status: 'gone' };

/**
 * Cached creator lookup that classifies expected 404/410 outcomes without
 * re-throwing them through every public creator page render path.
 *
 * This lets public routes treat missing creators as normal control flow and
 * caches only short-lived miss states so crawlers do not hammer the same 404 path.
 */
export async function getCachedCreatorLookup(
  username: string,
  requestHeaders?: { [key: string]: string }
): Promise<CachedCreatorLookupResult> {
  const { findCreatorByUsername } = await import('@services/creator.service');

  const hasAuthToken = !!(
    requestHeaders?.['Authorization'] ||
    requestHeaders?.['authorization']
  );

  const fetchCreator = async (): Promise<CachedCreatorLookupResult> => {
    const headersForApi =
      requestHeaders && Object.keys(requestHeaders).length > 0
        ? requestHeaders
        : undefined;

    try {
      const response = await findCreatorByUsername(username, headersForApi);
      if (!response?.data) {
        return { status: 'not-found' };
      }

      return {
        status: 'found',
        creator: response.data
      };
    } catch (error) {
      const status = getApiErrorStatus(error);

      if (status === 404) {
        return { status: 'not-found' };
      }

      if (status === 410) {
        return { status: 'gone' };
      }

      throw error;
    }
  };

  if (hasAuthToken) {
    // Authenticated page renders can include user-specific state like
    // subscription flags, so keep those lookups fresh.
    return fetchCreator();
  }

  const cacheKey = generateCacheKey('creator-lookup', username);
  const cachedEntry = serverCache.getEntry<CachedCreatorLookupResult>(cacheKey);

  if (cachedEntry) {
    const creatorLookupTTL = 60 * 1000;
    const age = Date.now() - cachedEntry.timestamp;

    if (age <= creatorLookupTTL) {
      return cachedEntry.data;
    }

    serverCache.clear(cacheKey);
  }

  const result = await fetchCreator();
  if (result.status !== 'found') {
    serverCache.set(cacheKey, result);
  }

  return result;
}
