'use client';

import { IPost } from '@interfaces/post';
import { PostNavigationContext, resolveNavigationContext } from '@lib/post-navigation-context';
import { useEffect, useRef, useState } from 'react';

import { PostDetailSource } from './use-post-detail-sequence';

/**
 * Which list owns "current post", "next", "previous" and prefetch — exactly
 * one at a time. See `resolveNavigationContext`, which is the definition; this
 * alias exists so the popup's long-standing name keeps working.
 */
export type PostDetailMode = PostNavigationContext;

export interface PostDetailModeState {
  mode: PostDetailMode;
  /**
   * The creator whose posts are the sequence, captured when creator mode was
   * entered and held unchanged until it is left.
   *
   * Captured rather than read from the open post, because in creator mode the
   * open post *is* one of this creator's posts and reading it back would be
   * circular: one stale response naming somebody else, once, would re-point the
   * whole sequence at that other creator and the grid would never come back.
   */
  creatorId: string | null;
}

interface UsePostDetailModeOptions {
  /** The post currently open. */
  post: IPost;
  /** The panel tab currently showing, or null when the panel is closed. */
  panelTab: string | null;
  /** Where the modal was opened from. */
  source?: PostDetailSource;
  /** A text field has focus, or a pointer is held on a seek bar or a scroller. */
  inputActive?: boolean;
  /** The Messages workspace is open beside the stage. */
  messagesOpen?: boolean;
}

/**
 * Derives the navigation mode, and captures the creator when creator mode
 * begins.
 *
 * This replaces three independent booleans (`videoModeActive`,
 * `videoModeDismissed`, and each layout's own reading of `panelTab`) that could
 * all be true at once and were re-derived separately by the photo layout and
 * the video layout. They disagreed: the video layout switched to the creator's
 * posts when the grid was open, the photo layout drew the same grid and
 * navigated the feed behind the modal instead.
 *
 * Must be called *above* the photo/video layout swap. A photo and a video are
 * different components, so stepping between them unmounts one and mounts the
 * other; anything captured inside either of them is destroyed exactly when the
 * viewer crosses a media-type boundary — which is the one moment the captured
 * creator matters most.
 */
export function usePostDetailMode({
  post, panelTab, source, inputActive = false, messagesOpen = false
}: UsePostDetailModeOptions): PostDetailModeState {
  const context = resolveNavigationContext({ panelTab, source, inputActive, messagesOpen });
  const inCreatorMode = context === 'creator';

  const [creatorId, setCreatorId] = useState<string | null>(
    inCreatorMode ? post.user?._id || null : null
  );
  const wasInCreatorModeRef = useRef(inCreatorMode);

  useEffect(() => {
    if (inCreatorMode && !wasInCreatorModeRef.current) {
      // Entering: capture the creator of the post that was open at that moment.
      setCreatorId(post.user?._id || null);
    } else if (!inCreatorMode && wasInCreatorModeRef.current) {
      // Leaving: forget it, so re-entering later captures afresh.
      setCreatorId(null);
    }
    wasInCreatorModeRef.current = inCreatorMode;
  }, [inCreatorMode, post]);

  // Entering and the first render of it happen together, so the sequence never
  // sees a frame of creator mode with no creator (which would read as an empty
  // list and disable the arrows).
  const resolvedCreatorId = inCreatorMode
    ? (wasInCreatorModeRef.current ? creatorId : post.user?._id || null) ?? creatorId
    : null;

  if (inCreatorMode) return { mode: 'creator', creatorId: resolvedCreatorId };
  return { mode: context, creatorId: null };
}
