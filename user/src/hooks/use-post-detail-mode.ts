'use client';

import { IPost } from '@interfaces/post';
import { useEffect, useRef, useState } from 'react';

import { PostDetailSource } from './use-post-detail-sequence';

/**
 * Which list owns "current post", "next", "previous" and prefetch — exactly
 * one at a time.
 *
 * | mode           | sequence owner                  | may change creator | scroll moves post |
 * |----------------|---------------------------------|--------------------|-------------------|
 * | recommendation | the recommendation session      | yes                | yes               |
 * | creator        | one creator's posts             | no                 | yes               |
 * | locked         | nothing                         | n/a                | no                |
 */
export type PostDetailMode = 'recommendation' | 'creator' | 'locked';

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

/** Sources whose sequence is one creator's posts however the panel is set. */
const CREATOR_SCOPED_SOURCES: PostDetailSource[] = ['profile-videos', 'creator-videos-tab'];

/** The one panel tab that navigates; every other open tab locks navigation. */
const CREATOR_TAB = 'videos';

interface UsePostDetailModeOptions {
  /** The post currently open. */
  post: IPost;
  /** The panel tab currently showing, or null when the panel is closed. */
  panelTab: string | null;
  /** Where the modal was opened from. */
  source?: PostDetailSource;
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
  post, panelTab, source
}: UsePostDetailModeOptions): PostDetailModeState {
  const sourceIsCreatorScoped = source ? CREATOR_SCOPED_SOURCES.includes(source) : false;
  const inCreatorMode = sourceIsCreatorScoped || panelTab === CREATOR_TAB;

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
  if (panelTab) return { mode: 'locked', creatorId: null };
  return { mode: 'recommendation', creatorId: null };
}
