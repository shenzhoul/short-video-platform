'use client';

import { insertPostInOrder, mergeCreatorPosts } from '@components/content/post/creator-post-order';
import { CursorInfo } from '@interfaces/pagination';
import { IPost } from '@interfaces/post';
import { subscribePostInteraction } from '@lib/post-interaction-bus';
import { applyPostInteractionPatchToPosts } from '@lib/post-interactions';
import { getCreatorPosts } from '@services/post.service';
import {
  useCallback, useEffect, useRef, useState
} from 'react';

interface UseCreatorVideosOptions {
  userId?: string;
  currentPost?: IPost | null;
  enabled: boolean;
}

interface CreatorPostPage {
  data: IPost[];
  hasMore: boolean;
  nextCursor: CursorInfo | null;
}

/** Everything loaded for one creator. Cached per creator id, never per open post. */
interface CreatorCacheEntry {
  posts: IPost[];
  nextCursor: CursorInfo | null;
  hasMore: boolean;
  /** A first page has genuinely been fetched and applied for this creator. */
  loaded: boolean;
}

const emptyEntry = (): CreatorCacheEntry => ({
  posts: [], nextCursor: null, hasMore: true, loaded: false
});

/**
 * One creator's posts, for the Post Detail creator grid and the sequence that
 * grid represents.
 *
 * ## Keyed by creator, cached by creator
 *
 * The list is a `Map<creatorId, CreatorCacheEntry>`, and the visible state is a
 * mirror of the entry for the creator currently on screen. Closing the modal
 * hides the list; it does not destroy what was loaded.
 *
 * That is the fix for a production defect. The previous version kept the posts
 * in state and the "already loaded" mark in a ref, and cleared **only the
 * posts** when the modal closed (`if (!currentPost || !userId) setPosts([])`).
 * Reopening the same creator then took the "keep the loaded pages" branch —
 * `insertPostInOrder(existing, currentPost)` over an array that had just been
 * emptied — so the grid showed exactly **one** video, and `hasMore`/`nextCursor`
 * still held the end-of-list values from the first load, so it also announced
 * "All videos loaded". Two pieces of state describing the same thing, cleared
 * separately.
 *
 * ## Why responses are stamped with the creator they were asked for
 *
 * Two things could previously put another creator's posts in this list.
 *
 * The server side was the larger one: `getCreatorPosts` used to call
 * `/posts/home-posts`, which became the ranked Home recommendation feed and
 * stopped honouring `userId` — so a request for one creator answered with a mix
 * of eight. That is fixed at the route (`/posts/creator-posts`).
 *
 * The client side was a race. The "already loaded" mark was set *before*
 * knowing the fetch had begun, while `fetchPage` silently returned early
 * whenever another request was in flight. Moving between creators quickly
 * therefore marked the new creator as loaded without ever asking for them, and
 * the previous creator's response — arriving after — was merged in and never
 * corrected. `loadMore` then paged the *new* creator using the *old* creator's
 * cursor, mixing both into one grid.
 *
 * So: every response carries the creator it was requested for and is discarded
 * if that is no longer the creator being shown, and the loaded mark is only set
 * once a request has genuinely been applied.
 */
export function useCreatorVideos({ userId, currentPost, enabled }: UseCreatorVideosOptions) {
  const cacheRef = useRef<Map<string, CreatorCacheEntry>>(new Map());
  const [posts, setPosts] = useState<IPost[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightUserIdRef = useRef<string | null>(null);
  /** The creator the list currently represents; a late response for anyone else is dropped. */
  const activeUserIdRef = useRef<string | null>(null);
  activeUserIdRef.current = userId || null;

  const entryFor = useCallback((creatorId: string): CreatorCacheEntry => {
    const existing = cacheRef.current.get(creatorId);
    if (existing) return existing;
    const created = emptyEntry();
    cacheRef.current.set(creatorId, created);
    return created;
  }, []);

  /** Write an entry back to the cache, and mirror it into state if it is the visible creator. */
  const commitEntry = useCallback((creatorId: string, entry: CreatorCacheEntry) => {
    cacheRef.current.set(creatorId, entry);
    if (activeUserIdRef.current !== creatorId) return;
    setPosts(entry.posts);
    // The cursor itself is read from the cache by `loadMore`, never from state:
    // it belongs to a creator, not to whatever the component last rendered.
    setHasMore(entry.hasMore);
  }, []);

  /*
   * A like made anywhere else must reach the card in this grid too. The grid is
   * frequently on screen beside the post being liked, which is exactly where a
   * stale copy is visible: before this, liking from the modal's action rail
   * left the same post's card here showing the old total.
   */
  useEffect(() => subscribePostInteraction((postId, patch) => {
    cacheRef.current.forEach((entry, creatorId) => {
      const nextPosts = applyPostInteractionPatchToPosts(entry.posts, postId, patch);
      if (nextPosts === entry.posts) return;
      cacheRef.current.set(creatorId, { ...entry, posts: nextPosts });
      if (activeUserIdRef.current === creatorId) setPosts(nextPosts);
    });
  }), []);

  const fetchPage = useCallback(async (requestedUserId: string, cursor: CursorInfo | null, reset: boolean) => {
    // Two requests for the *same* creator would duplicate a page; a request for
    // a different creator must not be dropped, because dropping it is what left
    // the grid showing somebody else.
    if (inFlightUserIdRef.current === requestedUserId) return;
    inFlightUserIdRef.current = requestedUserId;
    setLoading(true);
    setError(null);

    try {
      const response = await getCreatorPosts(requestedUserId, {
        limit: 12,
        sortBy: 'createdAt',
        sort: 'desc',
        ...(cursor ? {
          cursor: cursor.id,
          lastCreatedAt: new Date(cursor.createdAt).toISOString(),
          ...(typeof cursor.isPinned === 'boolean' ? { lastIsPinned: cursor.isPinned } : {}),
          ...(cursor.pinnedAt ? { lastPinnedAt: new Date(cursor.pinnedAt).toISOString() } : {})
        } : {})
      });
      // The viewer moved on while this was in flight: this page belongs to a
      // creator no longer on screen. It is still cached — reopening them should
      // not have to fetch again — but it must not be shown now.
      const stillActive = activeUserIdRef.current === requestedUserId;

      const page = response.data as CreatorPostPage;
      const incoming = page.data || [];
      const previous = entryFor(requestedUserId);

      // Ordered by the shared comparator, not by arrival. The open post is
      // *placed*, not appended: it may live on a page that has not been fetched
      // yet, and putting it at the end made the grid highlight one tile while
      // the arrows moved between its neighbours somewhere else.
      const merged = mergeCreatorPosts(reset ? [] : previous.posts, incoming);
      commitEntry(requestedUserId, {
        posts: insertPostInOrder(merged, stillActive ? currentPost : null),
        nextCursor: page.nextCursor || null,
        hasMore: Boolean(page.hasMore),
        loaded: true
      });
    } catch {
      if (activeUserIdRef.current === requestedUserId) {
        setError('Unable to load posts from this creator.');
      }
      // Not marked loaded, so re-entering this creator tries again rather than
      // showing a permanently one-tile grid.
      cacheRef.current.set(requestedUserId, { ...entryFor(requestedUserId), loaded: false });
    } finally {
      if (inFlightUserIdRef.current === requestedUserId) inFlightUserIdRef.current = null;
      if (activeUserIdRef.current === requestedUserId) setLoading(false);
    }
  }, [commitEntry, currentPost, entryFor]);

  useEffect(() => {
    if (!currentPost || !userId) {
      // Hide the grid, but keep every creator's pages. Clearing them here while
      // leaving the "loaded" mark behind is what collapsed the grid to a single
      // video on reopening.
      setPosts([]);
      return;
    }

    const entry = entryFor(userId);
    if (entry.loaded) {
      // Already have this creator: show it again, placing the newly opened post
      // if it is not among the loaded pages yet.
      commitEntry(userId, { ...entry, posts: insertPostInOrder(entry.posts, currentPost) });
      return;
    }

    // Nothing loaded for this creator yet. Show the open post while the first
    // page is on its way, so the grid is never blank.
    commitEntry(userId, { ...entry, posts: insertPostInOrder(entry.posts, currentPost) });
    setError(null);
    if (enabled) void fetchPage(userId, null, true);
  }, [commitEntry, currentPost, enabled, entryFor, fetchPage, userId]);

  const loadMore = useCallback(() => {
    if (!enabled || !userId) return;
    const entry = cacheRef.current.get(userId);
    // A cursor only means anything against the creator it came from, and only
    // once that creator's first page has actually landed.
    if (!entry?.loaded || !entry.hasMore || !entry.nextCursor) return;
    void fetchPage(userId, entry.nextCursor, false);
  }, [enabled, fetchPage, userId]);

  return {
    posts, hasMore, loading, error, loadMore
  };
}
