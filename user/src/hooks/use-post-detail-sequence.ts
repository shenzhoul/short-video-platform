'use client';

import { supportsPostDetail } from '@components/content/post/home-feed-media';
import { IPost } from '@interfaces/post';
import { useEffect, useMemo, useRef } from 'react';

import { useCreatorVideos } from './use-creator-videos';
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
  | 'following-feed'
  | 'profile-videos'
  | 'creator-videos-tab'
  | 'notification'
  | 'message-shared-post'
  | 'direct-link';

/** Sources whose sequence is one creator's posts rather than a feed. */
const CREATOR_SCOPED_SOURCES: PostDetailSource[] = [
  'profile-videos',
  'creator-videos-tab'
];

interface UsePostDetailSequenceOptions {
  /** The post currently open. */
  post: IPost;
  /** The feed the modal was opened from, when there is one. */
  feedPosts: IPost[];
  /** The panel tab currently showing, or null when the panel is closed. */
  panelTab: string | null;
  /**
   * The creator grid is on screen -- so the sequence is that creator's posts.
   * For a video this is the stage's "video mode"; for a photo it is simply the
   * `videos` tab being open, because the photo layout has no separate mode.
   */
  creatorScopeActive: boolean;
  /** Where the modal was opened from, when the caller knows. */
  source?: PostDetailSource;
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
 * for a creator-scoped source: `useCreatorVideos` refetches the creator's posts
 * from the post's own `user._id`, so the sequence is rebuilt from the server
 * rather than from state that did not survive. A feed-scoped source with no
 * feed simply has no neighbours, which is honest -- better than borrowing
 * someone else's list.
 */
export function usePostDetailSequence({
  post,
  feedPosts,
  panelTab,
  creatorScopeActive,
  source,
  onNavigate
}: UsePostDetailSequenceOptions) {
  const feedIndexRef = useRef(0);

  const navigableFeedPosts = useMemo(
    () => feedPosts.filter(supportsPostDetail),
    [feedPosts]
  );

  // A creator-scoped source stays creator-scoped even with the panel shut: the
  // modal was opened from that creator's grid, so its neighbours are that
  // creator's posts, not a feed the viewer never opened.
  const creatorScope = creatorScopeActive
    || (source ? CREATOR_SCOPED_SOURCES.includes(source) : false);

  const creatorPosts = useCreatorVideos({
    userId: post.user?._id,
    currentPost: post,
    enabled: creatorScope
  });

  const feedIndex = navigableFeedPosts.findIndex((item) => item._id === post._id);
  if (feedIndex >= 0) feedIndexRef.current = feedIndex;

  // With the panel open on something other than the creator grid -- comments,
  // details -- there is nothing to scroll between, so the arrows go quiet
  // rather than moving a list the viewer cannot see.
  const navigationPosts = creatorScope
    ? creatorPosts.posts
    : panelTab
      ? []
      : navigableFeedPosts;

  const navigation = usePostDetailNavigation({
    posts: navigationPosts,
    post,
    onNavigate,
    // Only a feed sequence needs a remembered index: a post can drop out of a
    // refreshed feed page while it is open. The creator list always contains
    // the open post, because the hook places it there.
    fallbackIndex: !creatorScope && !panelTab ? feedIndexRef.current : -1
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
    /** The creator's posts, ordered, for the grid and the sequence alike. */
    creatorPosts,
    /** Exactly what the arrows, the wheel and the keyboard move through. */
    navigationPosts,
    creatorScope,
    ...navigation
  };
}
