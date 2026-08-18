import { IPost } from '@interfaces/post';
import { useCallback } from 'react';

import { PostNavigationDirection, usePostNavigationWheel } from './use-post-navigation-wheel';

interface UsePostDetailNavigationOptions {
  posts: IPost[];
  post: IPost;
  onNavigate: (post: IPost) => void;
  fallbackIndex?: number;
}

export function usePostDetailNavigation({
  posts,
  post,
  onNavigate,
  fallbackIndex = -1
}: UsePostDetailNavigationOptions) {
  const matchedIndex = posts.findIndex(item => item._id === post._id);
  const currentIndex = matchedIndex >= 0 ? matchedIndex : fallbackIndex;
  const previousPost = currentIndex > 0 ? posts[currentIndex - 1] : null;
  const nextPost = currentIndex >= 0 && currentIndex < posts.length - 1
    ? posts[currentIndex + 1]
    : null;

  const navigate = useCallback((direction: PostNavigationDirection) => {
    const targetPost = direction === 'previous' ? previousPost : nextPost;
    if (targetPost) onNavigate(targetPost);
  }, [nextPost, onNavigate, previousPost]);

  const handleWheel = usePostNavigationWheel({
    canPrevious: Boolean(previousPost),
    canNext: Boolean(nextPost),
    onNavigate: navigate
  });

  return {
    currentIndex,
    previousPost,
    nextPost,
    navigate,
    handleWheel
  };
}
