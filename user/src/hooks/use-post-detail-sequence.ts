'use client';

import { supportsPostDetail } from '@components/content/post/home-feed-media';
import { IPost } from '@interfaces/post';
import { useEffect, useMemo, useRef } from 'react';

import { useCreatorVideos } from './use-creator-videos';
import type { PostDetailMode } from './use-post-detail-mode';
import { usePostDetailNavigation } from './use-post-detail-navigation';

/**
 * Where the open post came from, and therefore what "next" means.
 *
 * The modal is reachable from several places and they do not all navigate the
 * same list. Naming the source rather than inferring it from the post is what
 * stops the two from drifting apart.
 */
export type PostDetailSource =
  | 'home-feed'
  | 'for-you'
  | 'following-feed'
  | 'search'
  | 'profile-videos'
  | 'creator-videos-tab'
  | 'notification'
  | 'message-shared-post'
  | 'direct-link';

interface UsePostDetailSequenceOptions {
  /** The post currently open. */
  post: IPost;
  /** The feed the modal was opened from, when there is one. */
  feedPosts: IPost[];
  /** Which list owns the sequence right now — see `usePostDetailMode`. */
  mode: PostDetailMode;
  /** The creator whose posts are the sequence in creator mode, captured on entry. */
  creatorId: string | null;
  /**
   * The recommendation session has more to hand out even though the loaded
   * array happens to end here. Keeps "next" from reporting the end of the feed
   * while a refill is in flight.
   */
  hasMoreAhead?: boolean;
  onNavigate: (post: IPost) => void;
}

/**
 * One sequence for the detail modal: the grid, the highlight and the arrows.
 *
 * ## Why this is shared rather than written twice
 *
 * It was written twice. The video layout switched its navigation to the creator
 * list whenever the creator grid was on screen; the photo layout never did --
 * it fetched the creator posts to *render* the grid, then navigated the feed
 * that happened to be behind the modal. So opening a photo from the home feed
 * and pressing next moved to whatever post came after it in the home feed,
 * which is usually a different creator entirely, while the grid beside it still
 * showed this creator's work.
 *
 * The bug was not "photos are handled wrongly". It was that *the sequence had
 * no single owner*, so one of the two copies could be missing a rule and
 * nothing would notice. This hook is that owner: both layouts call it, and
 * whatever it returns is what the grid renders, what the highlight matches and
 * what the arrows, the wheel and the keyboard move through.
 *
 * ## Deep links and reloads
 *
 * After a refresh there is no feed behind the modal to navigate. That is fine
 * for creator mode: `useCreatorVideos` refetches the creator's posts from the
 * captured creator id, so the sequence is rebuilt from the server rather than
 * from state that did not survive. Recommendation mode with no session simply
 * has no neighbours, which is honest -- better than borrowing someone else's
 * list.
 */
export function usePostDetailSequence({
  post,
  feedPosts,
  mode,
  creatorId,
  hasMoreAhead = false,
  onNavigate
}: UsePostDetailSequenceOptions) {
  const feedIndexRef = useRef(0);
  const creatorScope = mode === 'creator';

  const navigableFeedPosts = useMemo(
    () => feedPosts.filter(supportsPostDetail),
    [feedPosts]
  );

  const creatorPosts = useCreatorVideos({
    userId: creatorScope ? creatorId || undefined : undefined,
    currentPost: post,
    enabled: creatorScope
  });

  const feedIndex = navigableFeedPosts.findIndex((item) => item._id === post._id);
  if (feedIndex >= 0) feedIndexRef.current = feedIndex;

  /*
   * Creator mode's invariant, enforced rather than assumed: every item in the
   * sequence belongs to the captured creator.
   *
   * The grid used to be filled by `/posts/home-posts`, which stopped honouring
   * `userId` when it became the ranked Home feed — so a request for Iris's
   * posts came back holding eight creators' work, under Iris's name, and
   * next/previous walked straight out of her catalogue. The server side of that
   * is fixed (`/posts/creator-posts`), and this is the belt: a response that
   * still names somebody else is dropped here rather than rendered.
   */
  const creatorScopedPosts = useMemo(() => {
    if (!creatorScope || !creatorId) return creatorPosts.posts;
    const own = creatorPosts.posts.filter((item) => (item.user?._id || null) === creatorId);
    if (process.env.NODE_ENV !== 'production' && own.length !== creatorPosts.posts.length) {
      const strangers = creatorPosts.posts.filter((item) => (item.user?._id || null) !== creatorId);
      console.error(
        `[post-detail] creator mode is scoped to ${creatorId} but the list held `
        + `${strangers.length} post(s) from other creators: `
        + `${strangers.map((item) => `${item._id}@${item.user?._id}`).join(', ')}`
      );
    }
    return own;
  }, [creatorId, creatorPosts.posts, creatorScope]);

  // A panel tab that is not the creator grid has nothing to scroll between, so
  // the arrows go quiet rather than moving a list the viewer cannot see.
  const navigationPosts = creatorScope
    ? creatorScopedPosts
    : mode === 'disabled'
      ? []
      : navigableFeedPosts;

  const navigation = usePostDetailNavigation({
    posts: navigationPosts,
    post,
    onNavigate,
    // Only a feed sequence needs a remembered index: a post can drop out of a
    // refreshed feed page while it is open. The creator list always contains
    // the open post, because the hook places it there.
    fallbackIndex: mode === 'recommendation' ? feedIndexRef.current : -1,
    // Only the recommendation session refills; a creator list pages instead,
    // and a disabled context navigates nothing.
    hasMoreAhead: mode === 'recommendation' && hasMoreAhead
  });

  // Fetch ahead so the arrows do not stop at a page boundary the viewer cannot
  // see. Four from the end is roughly one screen of the three-column grid.
  useEffect(() => {
    if (!creatorScope || navigation.currentIndex < 0) return;
    const remaining = creatorPosts.posts.length - navigation.currentIndex;
    if (remaining <= 4 && creatorPosts.hasMore && !creatorPosts.loading) {
      creatorPosts.loadMore();
    }
  }, [creatorPosts, creatorScope, navigation.currentIndex]);

  return {
    /** The creator's posts, ordered and scoped, for the grid and the sequence alike. */
    creatorPosts: { ...creatorPosts, posts: creatorScopedPosts },
    /** Exactly what the arrows, the wheel and the keyboard move through. */
    navigationPosts,
    creatorScope,
    mode,
    ...navigation
  };
}
