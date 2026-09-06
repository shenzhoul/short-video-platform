import { render, screen } from '@testing-library/react';
import React from 'react';

import { IPost } from '@interfaces/post';

import CreatorProfileWorkItem from './creator-profile-work-item';

/**
 * "Pinned on top" is a statement about **one creator's own ordering**, not a
 * property of the post.
 *
 * The badge was rendered from `post.isPinned` alone, and the profile grid tile
 * is shared between the Works tab and the "I like it" tab — so a liked post
 * from another creator, sitting in your own likes, announced that it was pinned
 * to the top of a list it was not even in.
 *
 * The pin metadata is untouched: the API still returns it and creator ordering
 * still uses it. What changed is that the badge needs to be asked for.
 */

jest.mock('@hooks/use-post-video-hover-playback', () => ({
  usePostVideoHoverPlayback: () => ({
    videoRef: { current: null },
    isHovered: false,
    showVideo: false,
    showCompactChrome: false,
    isMuted: true,
    isPlaying: false,
    hoverTime: 0,
    hoverDuration: 0,
    compactProgress: 0,
    mediaUrl: 'https://media.test/cover.jpg',
    videoUrl: '',
    description: '',
    duration: '',
    hasVideo: false,
    isCurrentPopup: false,
    handlers: {}
  })
}));

const pinnedPost = {
  _id: 'p1',
  type: 'photo',
  isPinned: true,
  totalLike: 3,
  totalView: 9,
  user: { _id: 'creator-a', username: 'creator-a' },
  files: [{ type: 'photo', url: 'https://media.test/p1.jpg' }]
} as unknown as IPost;

function renderTile(showPinnedBadge?: boolean) {
  return render(
    <ul>
      <CreatorProfileWorkItem
        post={pinnedPost}
        metricVariant="likes"
        popupPipState={null}
        onCompactHoverChange={jest.fn()}
        onOpenDetail={jest.fn()}
        batchMode={false}
        selected={false}
        onToggleSelection={jest.fn()}
        {...(showPinnedBadge === undefined ? {} : { showPinnedBadge })}
      />
    </ul>
  );
}

describe('the pinned badge is contextual', () => {
  /** Regression 1 — the creator's own Works grid. */
  it('shows on a surface that is the creator\'s own collection', () => {
    renderTile(true);
    expect(screen.getByText('Pinned on top')).toBeInTheDocument();
  });

  /** Regression 2 — "I like it", and every other generic grid. */
  it('does not show when the surface has not asked for it', () => {
    renderTile(false);
    expect(screen.queryByText('Pinned on top')).not.toBeInTheDocument();
  });

  /*
   * Regression 3 — Search, Home, For You, collections and any future listing.
   * The default is what protects them: a new grid that forgets the prop shows
   * no badge rather than the wrong one.
   */
  it('defaults to hidden', () => {
    renderTile(undefined);
    expect(screen.queryByText('Pinned on top')).not.toBeInTheDocument();
  });

  /** Regression 4 — nothing about the post itself changed. */
  it('leaves the pin metadata on the post untouched', () => {
    renderTile(false);
    expect(pinnedPost.isPinned).toBe(true);
  });
});
