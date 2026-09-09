import { IPost } from '@interfaces/post';
import { render, screen } from '@testing-library/react';

import PostFeedDragViewport from './post-feed-drag-viewport';

// Strip the Next-only props so React does not warn about unknown DOM
// attributes; what this spec asserts is the geometry around the image, not the
// loader.
jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ fill, sizes, unoptimized, priority, placeholder, ...rest }: any) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...rest} />
  )
}));

const ITEM_HEIGHT = 956;

function post(id: string): IPost {
  return {
    _id: id,
    title: id,
    type: 'video',
    files: [{ type: 'video', url: `https://cdn.test/${id}.mp4`, thumbnails: [`https://cdn.test/${id}.jpg`] }],
    user: { _id: 'creator-1', username: 'creator' }
  } as unknown as IPost;
}

function renderViewport(overrides: Partial<React.ComponentProps<typeof PostFeedDragViewport>> = {}) {
  return render(
    <PostFeedDragViewport
      itemHeight={ITEM_HEIGHT}
      dragDeltaY={0}
      transitionMs={0}
      previewDirection={null}
      previousPost={post('previous')}
      nextPost={post('next')}
      {...overrides}
    >
      <video data-testid="live-stage" src="https://cdn.test/current.mp4" autoPlay />
    </PostFeedDragViewport>
  );
}

describe('PostFeedDragViewport', () => {
  it('clips the stage, so a neighbour offset by one screen is invisible at rest', () => {
    renderViewport();
    expect(screen.getByTestId('post-drag-viewport')).toHaveClass('overflow-hidden');
  });

  it('keeps both adjacent slides mounted, so a drag has nothing left to load', () => {
    // Mounting on `pointerdown` was measured showing a bare blur placeholder
    // for the first third of every drag: the cover had no time to fetch.
    renderViewport();
    expect(screen.getByTestId('post-drag-preview-next')).toBeInTheDocument();
    expect(screen.getByTestId('post-drag-preview-previous')).toBeInTheDocument();
  });

  it('renders current and adjacent only — nothing further down the sequence', () => {
    renderViewport();
    expect(screen.getAllByTestId(/^post-drag-(current|preview-)/)).toHaveLength(3);
  });

  it('parks both neighbours exactly one stage away at rest', () => {
    renderViewport();
    expect(screen.getByTestId('post-drag-preview-next')).toHaveStyle({
      transform: `translate3d(0, ${ITEM_HEIGHT}px, 0)`
    });
    expect(screen.getByTestId('post-drag-preview-previous')).toHaveStyle({
      transform: `translate3d(0, ${-ITEM_HEIGHT}px, 0)`
    });
  });

  it('applies the current slide transform as composited translate3d', () => {
    renderViewport({ dragDeltaY: -137 });
    expect(screen.getByTestId('post-drag-current')).toHaveStyle({
      transform: 'translate3d(0, -137px, 0)'
    });
  });

  it('places the next preview exactly one stage below, moving with the finger', () => {
    renderViewport({ dragDeltaY: -137, previewDirection: 'next' });
    expect(screen.getByTestId('post-drag-preview-next')).toHaveStyle({
      transform: `translate3d(0, ${ITEM_HEIGHT - 137}px, 0)`
    });
  });

  it('places the previous preview exactly one stage above', () => {
    renderViewport({ dragDeltaY: 137, previewDirection: 'previous' });
    expect(screen.getByTestId('post-drag-preview-previous')).toHaveStyle({
      transform: `translate3d(0, ${-ITEM_HEIGHT + 137}px, 0)`
    });
  });

  it('marks which neighbour the drag is actually uncovering', () => {
    renderViewport({ dragDeltaY: -137, previewDirection: 'next' });
    expect(screen.getByTestId('post-drag-preview-next')).toHaveAttribute('data-uncovered', 'true');
    expect(screen.getByTestId('post-drag-preview-previous')).toHaveAttribute('data-uncovered', 'false');
  });

  it('draws the preview as a still — no second video, so nothing autoplays or is counted as watched', () => {
    renderViewport({ dragDeltaY: -137, previewDirection: 'next' });
    const previewSlide = screen.getByTestId('post-drag-preview-next');
    expect(previewSlide.querySelector('video')).toBeNull();
    expect(previewSlide.querySelector('img')).not.toBeNull();
    // The one real stage is still the only live post.
    expect(screen.getAllByTestId('live-stage')).toHaveLength(1);
  });

  it('hides the preview from assistive technology — it is a hint, not content', () => {
    renderViewport({ dragDeltaY: -137, previewDirection: 'next' });
    expect(screen.getByTestId('post-drag-preview-next')).toHaveAttribute('aria-hidden', 'true');
  });

  it('runs no transition while the finger is down', () => {
    renderViewport({ dragDeltaY: -137, previewDirection: 'next', transitionMs: 0 });
    expect(screen.getByTestId('post-drag-current')).toHaveStyle({ transition: 'none' });
    expect(screen.getByTestId('post-drag-preview-next')).toHaveStyle({ transition: 'none' });
  });

  it('animates both slides identically on commit, so they never separate', () => {
    renderViewport({ dragDeltaY: -ITEM_HEIGHT, previewDirection: 'next', transitionMs: 240 });
    const expected = 'transform 240ms cubic-bezier(0.22, 0.61, 0.36, 1)';
    expect(screen.getByTestId('post-drag-current')).toHaveStyle({ transition: expected });
    expect(screen.getByTestId('post-drag-preview-next')).toHaveStyle({ transition: expected });
  });

  it('draws nothing extra before the stage has been measured', () => {
    renderViewport({ itemHeight: 0, dragDeltaY: -137, previewDirection: 'next' });
    expect(screen.queryByTestId('post-drag-preview-next')).not.toBeInTheDocument();
    expect(screen.queryByTestId('post-drag-preview-previous')).not.toBeInTheDocument();
  });

  it('renders no preview when the sequence has no neighbour in that direction', () => {
    renderViewport({ dragDeltaY: -137, previewDirection: 'next', nextPost: null });
    expect(screen.queryByTestId('post-drag-preview-next')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('live-stage')).toHaveLength(1);
  });
});
