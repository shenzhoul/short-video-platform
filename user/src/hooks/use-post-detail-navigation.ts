import { IPost } from '@interfaces/post';
import { useCallback, useEffect, useRef, useState } from 'react';

import { PostNavigationDirection, usePostNavigationWheel } from './use-post-navigation-wheel';

interface UsePostDetailNavigationOptions {
  posts: IPost[];
  post: IPost;
  onNavigate: (post: IPost) => void;
  fallbackIndex?: number;
  /**
   * More posts are still coming for this sequence even though the array ends
   * here. Keeps the Next control enabled while a refill is in flight, and lets
   * a click made during that window take effect when the post lands instead of
   * being dropped.
   */
  hasMoreAhead?: boolean;
}

export function usePostDetailNavigation({
  posts,
  post,
  onNavigate,
  fallbackIndex = -1,
  hasMoreAhead = false
}: UsePostDetailNavigationOptions) {
  const matchedIndex = posts.findIndex(item => item._id === post._id);
  const currentIndex = matchedIndex >= 0 ? matchedIndex : fallbackIndex;
  const previousPost = currentIndex > 0 ? posts[currentIndex - 1] : null;
  const nextPost = currentIndex >= 0 && currentIndex < posts.length - 1
    ? posts[currentIndex + 1]
    : null;

  /*
   * A "next" pressed at the tail while the sequence is still refilling.
   *
   * Without this the control has only two honest states — a loaded neighbour,
   * or the end of the feed — and a refill that has not landed yet is
   * indistinguishable from exhaustion. Holding the intent for one step means a
   * fast click is answered rather than swallowed, and the control never claims
   * the feed has ended when the server has not said so.
   */
  const [awaitingNext, setAwaitingNext] = useState(false);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  useEffect(() => {
    if (!awaitingNext) return;
    if (nextPost) {
      setAwaitingNext(false);
      onNavigateRef.current(nextPost);
      return;
    }
    // The sequence ended before the post arrived — drop the intent rather than
    // leaving it armed to fire on some later, unrelated append.
    if (!hasMoreAhead) setAwaitingNext(false);
  }, [awaitingNext, hasMoreAhead, nextPost]);

  // Moving anywhere else cancels a pending intent.
  useEffect(() => {
    setAwaitingNext(false);
  }, [post._id]);

  const canNext = Boolean(nextPost) || hasMoreAhead;

  const navigate = useCallback((direction: PostNavigationDirection) => {
    if (direction === 'previous') {
      if (previousPost) onNavigate(previousPost);
      return;
    }
    if (nextPost) {
      onNavigate(nextPost);
      return;
    }
    if (hasMoreAhead) setAwaitingNext(true);
  }, [hasMoreAhead, nextPost, onNavigate, previousPost]);

  const handleWheel = usePostNavigationWheel({
    canPrevious: Boolean(previousPost),
    canNext,
    onNavigate: navigate
  });

  return {
    currentIndex,
    previousPost,
    nextPost,
    /** True when "next" is a real option — a loaded neighbour, or one on its way. */
    canNext,
    /** Waiting for a refill to land so a click made at the tail can take effect. */
    awaitingNext,
    navigate,
    handleWheel
  };
}
