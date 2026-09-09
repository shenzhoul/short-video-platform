/**
 * The Post Detail navigation mode, and the creator it captures.
 *
 * Before this existed, three independent booleans decided the same thing and
 * could all be true at once — `videoModeActive`, `videoModeDismissed`, and each
 * layout's own reading of the panel tab. The photo layout and the video layout
 * derived them separately and disagreed: with the creator grid open, the video
 * layout navigated the creator's posts while the photo layout navigated the feed
 * behind the modal.
 *
 * The captured creator matters most exactly where it used to be lost: stepping
 * from a photo to a video (or back) unmounts one layout and mounts the other, so
 * anything held inside either of them is destroyed at that moment.
 */

import { renderHook } from '@testing-library/react';

import type { IPost } from '@interfaces/post';

import { usePostDetailMode } from './use-post-detail-mode';

const IRIS = 'creator-iris';
const SOFIA = 'creator-sofia';

const make = (id: string, userId: string, type = 'video'): IPost => ({
  _id: id, type, user: { _id: userId, username: userId }
} as unknown as IPost);

type Props = Parameters<typeof usePostDetailMode>[0];

const renderMode = (initialProps: Props) => renderHook(
  (props: Props) => usePostDetailMode(props),
  { initialProps }
);

describe('usePostDetailMode', () => {
  it('is recommendation mode with the panel closed', () => {
    const { result } = renderMode({ post: make('v1', IRIS), panelTab: null, source: 'home-feed' });
    expect(result.current.mode).toBe('recommendation');
    expect(result.current.creatorId).toBeNull();
  });

  it('is creator mode with the Videos tab open, capturing that post\'s creator', () => {
    const { result } = renderMode({ post: make('v1', IRIS), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.mode).toBe('creator');
    expect(result.current.creatorId).toBe(IRIS);
  });

  it('is disabled for any other open tab', () => {
    ['details', 'comments', 'related', 'ask-ai'].forEach((tab) => {
      const { result } = renderMode({ post: make('v1', IRIS), panelTab: tab, source: 'home-feed' });
      expect(result.current.mode).toBe('disabled');
      expect(result.current.creatorId).toBeNull();
    });
  });

  it('is creator mode for a creator-scoped source whatever the panel shows', () => {
    (['profile-videos', 'creator-videos-tab'] as const).forEach((source) => {
      const { result } = renderMode({ post: make('v1', IRIS), panelTab: null, source });
      expect(result.current.mode).toBe('creator');
      expect(result.current.creatorId).toBe(IRIS);
    });
  });

  it('holds the captured creator even if the open post names somebody else', () => {
    const { result, rerender } = renderMode({ post: make('v1', IRIS), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.creatorId).toBe(IRIS);

    // A stale response, or a late prefetch, sets a post from another creator as
    // current. The sequence must not follow it out of Iris's catalogue.
    rerender({ post: make('s1', SOFIA), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.mode).toBe('creator');
    expect(result.current.creatorId).toBe(IRIS);
  });

  it('survives the photo/video layout swap', () => {
    const { result, rerender } = renderMode({ post: make('v1', IRIS, 'video'), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.creatorId).toBe(IRIS);

    rerender({ post: make('p1', IRIS, 'photo'), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.mode).toBe('creator');
    expect(result.current.creatorId).toBe(IRIS);

    rerender({ post: make('v2', IRIS, 'video'), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.creatorId).toBe(IRIS);
  });

  it('captures afresh on re-entry, so a later creator grid is that creator\'s', () => {
    const { result, rerender } = renderMode({ post: make('v1', IRIS), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.creatorId).toBe(IRIS);

    // Close the grid, move to another creator's post, open it again.
    rerender({ post: make('v1', IRIS), panelTab: null, source: 'home-feed' });
    expect(result.current.mode).toBe('recommendation');
    expect(result.current.creatorId).toBeNull();

    rerender({ post: make('s1', SOFIA), panelTab: null, source: 'home-feed' });
    rerender({ post: make('s1', SOFIA), panelTab: 'videos', source: 'home-feed' });
    expect(result.current.mode).toBe('creator');
    expect(result.current.creatorId).toBe(SOFIA);
  });

  it('walks every mode transition without ever leaving a creator id behind', () => {
    const { result, rerender } = renderMode({ post: make('v1', IRIS), panelTab: null, source: 'home-feed' });

    const step = (panelTab: string | null, expected: string, creator: string | null) => {
      rerender({ post: make('v1', IRIS), panelTab, source: 'home-feed' });
      expect(result.current.mode).toBe(expected);
      expect(result.current.creatorId).toBe(creator);
    };

    step('videos', 'creator', IRIS); // recommendation -> creator
    step('details', 'disabled', null); // creator -> disabled
    step('videos', 'creator', IRIS); // disabled -> creator
    step(null, 'recommendation', null); // creator -> recommendation
    step('comments', 'disabled', null); // recommendation -> disabled
    step(null, 'recommendation', null); // disabled -> recommendation
  });
});
