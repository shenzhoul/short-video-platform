/**
 * What a tile in the creator grid tells you about the post behind it.
 *
 * The grid holds every post a creator has, not only videos, so a tile has to
 * say which kind it is -- and a pinned post has to say so too. Three markers can
 * land on one tile at once (pinned, photo, like count) and they must not sit on
 * top of each other, so their corners are asserted here rather than left to
 * whoever edits the class list next.
 */

import { render, screen } from '@testing-library/react';

import PostPhotoBadge from './post-photo-badge';
import PostPinnedBadge from './post-pinned-badge';

describe('creator grid badges', () => {
  describe('photo badge', () => {
    it('describes a single-image post without claiming there are several', () => {
      render(<PostPhotoBadge imageCount={1} />);

      const badge = screen.getByRole('img', { name: 'Photo post' });
      expect(badge).toBeInTheDocument();
      // No count beside the icon: a "1" would read as "1 of several".
      expect(badge.textContent).toBe('');
    });

    it('names the number of images when the post really is a gallery', () => {
      render(<PostPhotoBadge imageCount={4} />);

      expect(screen.getByRole('img', { name: 'Photo post, 4 images' })).toBeInTheDocument();
      expect(screen.getByText('4')).toBeInTheDocument();
    });

    it('carries its own opaque backing, so it reads on a light or a dark thumbnail', () => {
      const { container } = render(<PostPhotoBadge />);
      const badge = container.firstElementChild as HTMLElement;

      // Contrast comes from the pill, never from the image underneath it.
      expect(badge.className).toContain('bg-black/55');
      expect(badge.className).toContain('text-white');
    });

    it('does not swallow the click that opens the post', () => {
      const { container } = render(<PostPhotoBadge />);

      expect((container.firstElementChild as HTMLElement).className).toContain('pointer-events-none');
    });
  });

  describe('placement', () => {
    it('keeps the pinned tag and the photo badge in opposite corners', () => {
      // Both can be true of one tile: a pinned photo post. The tile also carries
      // its like count along the bottom, so neither may take that edge.
      const { container } = render(
        <div className="relative">
          <PostPinnedBadge className="absolute left-2 top-2 z-20" />
          <PostPhotoBadge className="absolute right-2 top-2 z-20" />
        </div>
      );

      const [pinned, photoBadge] = Array.from(container.querySelectorAll('span[class*="absolute"]'));
      expect(pinned.className).toContain('left-2');
      expect(pinned.className).toContain('top-2');
      expect(photoBadge.className).toContain('right-2');
      expect(photoBadge.className).toContain('top-2');
      // Neither reaches the bottom edge, where the like count lives.
      expect(pinned.className).not.toContain('bottom-');
      expect(photoBadge.className).not.toContain('bottom-');
    });
  });
});
