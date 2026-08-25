import { render, screen } from '@testing-library/react';
import React from 'react';

import CommentItem from './comment-item';

/**
 * The vertical order of a posted comment.
 *
 * Text above the picture, and both above the timestamp and the actions. Order in
 * the DOM is what decides this — the image is a block in the flow, never an
 * overlay on the text — so it is asserted with `compareDocumentPosition` rather
 * than by looking at classes.
 */

jest.mock('@components/interactions', () => ({
  LikeButton: () => <button type="button">like</button>
}));

jest.mock('@components/comment/comment-replies', () => ({
  __esModule: true,
  default: () => null
}));

const author = { _id: 'u-1', username: 'author', name: 'Author' };

function comment(overrides: Record<string, any> = {}) {
  return {
    _id: 'c-1',
    content: 'what a lovely photo',
    objectId: 'post-1',
    objectType: 'post',
    createdBy: 'u-1',
    user: author,
    totalReply: 0,
    totalLike: 0,
    createdAt: new Date().toISOString(),
    image: {
      id: 'file-1',
      url: 'https://files.example/a.webp',
      width: 800,
      height: 600,
      mimeType: 'image/webp'
    },
    ...overrides
  } as any;
}

/** True when `b` comes after `a` in document order. */
const isAfter = (a: Element, b: Element) => Boolean(
  // eslint-disable-next-line no-bitwise
  a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING
);

const renderComment = ({ item, ...props }: Record<string, any> = {}) => render(
  // `item` is pulled out first: spreading the rest afterwards must not overwrite
  // the comment that was just built from it.
  <CommentItem item={comment(item)} user={author as any} {...props} />
);

describe('a posted comment with text and an image', () => {
  it('renders the text before the image', () => {
    const { container } = renderComment();

    const text = screen.getByText('what a lovely photo');
    const image = screen.getByTestId('comment-image-file-1');
    expect(isAfter(text, image)).toBe(true);
    expect(container.querySelectorAll('[data-testid="comment-image-file-1"]')).toHaveLength(1);
  });

  it('renders the image before the timestamp and the actions', () => {
    renderComment();

    const image = screen.getByTestId('comment-image-file-1');
    const actions = screen.getByText('Reply');
    expect(isAfter(image, actions)).toBe(true);
  });

  it('keeps the same order for a reply', () => {
    renderComment({ level: 1 });

    const text = screen.getByText('what a lovely photo');
    const image = screen.getByTestId('comment-image-file-1');
    expect(isAfter(text, image)).toBe(true);
  });

  it('does not overlay the image on the text', () => {
    // Both are ordinary blocks in the flow; an absolutely positioned image would
    // sit on top of the words rather than under them.
    renderComment();

    const image = screen.getByTestId('comment-image-file-1');
    expect(image.className).not.toMatch(/absolute|fixed/);
  });

  it('leaves no image space for a text-only comment', () => {
    renderComment({ item: { image: undefined } });

    expect(screen.getByText('what a lovely photo')).toBeInTheDocument();
    expect(screen.queryByTestId('comment-image-file-1')).not.toBeInTheDocument();
  });

  it('renders an image-only comment with no empty text block', () => {
    const { container } = renderComment({ item: { content: '' } });

    expect(screen.getByTestId('comment-image-file-1')).toBeInTheDocument();
    const paragraphs = [...container.querySelectorAll('p')]
      .filter((p) => (p.textContent || '').trim().length === 0);
    // An empty paragraph would still reserve a line's worth of height.
    expect(paragraphs.every((p) => p.getBoundingClientRect().height === 0)).toBe(true);
  });

  it('reserves the right box from the intrinsic size', () => {
    // Width and height on the element itself let the browser lay the space out
    // before the bytes arrive, so the thread does not jump when it loads.
    renderComment();

    const img = screen.getByTestId('comment-image-file-1').querySelector('img')!;
    expect(img.getAttribute('width')).toBe('800');
    expect(img.getAttribute('height')).toBe('600');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.className).toContain('object-contain');
  });

  it('renders nothing at all when the image has no url', () => {
    renderComment({ item: { image: { id: 'x', url: '', width: 0, height: 0, mimeType: '' } } });

    expect(screen.queryByTestId('comment-image-x')).not.toBeInTheDocument();
  });
});

describe('a posted comment carrying only an image', () => {
  /** Every paragraph the comment body rendered. */
  const paragraphs = (container: HTMLElement) => [...container.querySelectorAll('p')];

  it('draws the picture with no empty paragraph above it', () => {
    const { container } = renderComment({ item: { content: '' } });

    expect(screen.getByTestId('comment-image-file-1')).toBeInTheDocument();
    // An empty paragraph still costs its line height and its top margin, which
    // reads as a gap somebody left by accident rather than as a comment with no
    // words in it.
    expect(paragraphs(container).filter((p) => !p.textContent?.trim())).toHaveLength(0);
  });

  it('does the same when content is absent rather than empty', () => {
    // The API omits the field entirely for an image-only comment, so `''` and
    // `undefined` both have to be handled.
    const { container } = renderComment({ item: { content: undefined } });
    expect(paragraphs(container).filter((p) => !p.textContent?.trim())).toHaveLength(0);
    expect(screen.getByTestId('comment-image-file-1')).toBeInTheDocument();
  });

  it('behaves the same in a reply', () => {
    const { container } = renderComment({ item: { content: '' }, level: 1 });
    expect(paragraphs(container).filter((p) => !p.textContent?.trim())).toHaveLength(0);
    expect(screen.getByTestId('comment-image-file-1')).toBeInTheDocument();
  });

  it('still shows the author and the actions', () => {
    // The row must not collapse to a bare picture: it is somebody's comment.
    renderComment({ item: { content: '' } });
    expect(screen.getByText('Author')).toBeInTheDocument();
    expect(screen.getByText('Reply')).toBeInTheDocument();
  });

  it('keeps the paragraph when there is text', () => {
    const { container } = renderComment();
    expect(paragraphs(container).some((p) => p.textContent === 'what a lovely photo')).toBe(true);
  });
});
