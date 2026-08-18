'use client';

import { likedPosts } from '@services/post.service';
import { useEffect, useState } from 'react';

// Kept across mounts so reopening the account menu shows the last known count immediately instead of
// flashing an empty slot while the request is in flight.
let cachedCount: number | null = null;

/**
 * Total number of posts the current user has liked.
 *
 * Requests a single row purely for the `total` the endpoint returns alongside it, so this stays a
 * count query rather than loading the liked feed.
 */
export function useLikedPostCount(enabled: boolean) {
  const [count, setCount] = useState<number | null>(cachedCount);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    void (async () => {
      try {
        const response = await likedPosts({ limit: 1 });
        const total = response?.data?.total;
        if (cancelled || typeof total !== 'number') return;
        cachedCount = total;
        setCount(total);
      } catch {
        // Keep the last known value; a menu badge is not worth surfacing an error for.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return count;
}
