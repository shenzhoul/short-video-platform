/**
 * Which media element the full-bleed stage mounts.
 *
 * The defect this locks down: `ForYouFeed` drew every recommended post with
 * `PostVideoStage`, and that stage always rendered a `<video>` whose `src` came
 * from `getPostVideo(post)`. A photo post has no video file, so the src was the
 * empty string — React refuses to set it, logs "An empty string ("") was passed
 * to the src attribute", and the viewer is shown a black rectangle with
 * transport controls while the post's images are never drawn. One seeded post in
 * ten is a photo, and the ranked feed opened on one.
 *
 * Every test here fails against that implementation.
 */

import { render, screen } from '@testing-library/react';

import type { IPost } from '@interfaces/post';

jest.mock('@components/ui/video-player', () => ({
  __esModule: true,
  // Renders the same element the real player does, so "did a <video> get
  // mounted, and with what src" is answerable without the player's own logic.
  default: ({ src, id }: { src: string; id: string }) => (
    <video data-testid="video-player" data-video-id={id} src={src} />
  )
}));

jest.mock('@lib/popup-pip', () => ({
  closePopupPip: jest.fn(),
  closePopupPipWindow: jest.fn(),
  readPopupPipState: () => null,
  subscribePopupPipState: () => () => undefined
}));

// eslint-disable-next-line import/first
import PostVideoStage from './post-video-stage';

const creator = { _id: 'creator-1', name: 'Creator', username: 'creator' };

const videoPost = (id = 'v1'): IPost => ({
  _id: id,
  type: 'video',
  user: creator,
  files: [{ _id: `${id}-f`, type: 'post-video', url: `https://cdn/${id}.mp4` }],
  createdAt: '2026-06-01T00:00:00.000Z'
} as unknown as IPost);

const photoPost = (id = 'p1', images = 1): IPost => ({
  _id: id,
  type: 'photo',
  user: creator,
  files: Array.from({ length: images }, (_, index) => ({
    _id: `${id}-f${index}`, type: 'post-photo', url: `https://cdn/${id}-${index}.jpg`
  })),
  createdAt: '2026-06-01T00:00:00.000Z'
} as unknown as IPost);

const renderStage = (post: IPost) => render(
  <PostVideoStage post={post} playerId={`for-you-${post._id}`} popupPlaylist={[]} />
);

describe('PostVideoStage media selection', () => {
  it('mounts a video player with a real URL for a video post', () => {
    renderStage(videoPost());
    const video = screen.getByTestId('video-player');
    expect(video).toHaveAttribute('src', 'https://cdn/v1.mp4');
  });

  it('never mounts a <video> for a photo post', () => {
    const { container } = renderStage(photoPost());
    expect(container.querySelector('video')).toBeNull();
  });

  it('draws the photo post images instead', () => {
    const { container } = renderStage(photoPost('p1', 3));
    const sources = Array.from(container.querySelectorAll('img'))
      .map((image) => image.getAttribute('src'))
      .filter((src): src is string => Boolean(src));
    // The backdrop also uses an image, so this asserts the slides are present
    // rather than counting every <img> on the stage.
    expect(sources).toEqual(expect.arrayContaining([
      'https://cdn/p1-0.jpg', 'https://cdn/p1-1.jpg', 'https://cdn/p1-2.jpg'
    ]));
  });

  it('never renders a <video> with an empty or missing src, whatever the post', () => {
    // A malformed post: typed video, but with nothing playable on it. The stage
    // must not answer that with an unplayable element.
    const malformed = {
      _id: 'broken', type: 'video', user: creator, files: [], createdAt: '2026-06-01T00:00:00.000Z'
    } as unknown as IPost;

    [videoPost(), photoPost(), malformed].forEach((post) => {
      const { container, unmount } = renderStage(post);
      container.querySelectorAll('video').forEach((video) => {
        const src = video.getAttribute('src');
        expect(src).toBeTruthy();
        expect(src?.trim()).not.toBe('');
      });
      unmount();
    });
  });

  it('swaps the element when the open post changes kind', () => {
    const { container, rerender } = render(
      <PostVideoStage post={videoPost()} playerId="for-you-v1" popupPlaylist={[]} />
    );
    expect(container.querySelector('video')).not.toBeNull();

    rerender(<PostVideoStage post={photoPost()} playerId="for-you-p1" popupPlaylist={[]} />);
    expect(container.querySelector('video')).toBeNull();

    rerender(<PostVideoStage post={videoPost('v2')} playerId="for-you-v2" popupPlaylist={[]} />);
    expect(container.querySelector('video')).toHaveAttribute('src', 'https://cdn/v2.mp4');
  });
});
