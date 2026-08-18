import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act, render, screen, waitFor
} from '@testing-library/react';
import React from 'react';

import CommentWrapper from './comment-wrapper';

/**
 * Two behaviours that share the same component:
 *
 * - the notification target is navigation *context*, so it must never change
 *   the canonical comment ordering;
 * - the list pages by cursor as it is scrolled, rather than revealing comments
 *   already held in memory behind a button.
 */

const mockResolveTarget = jest.fn();
const mockSearchComments = jest.fn();

jest.mock('@services/comment.service', () => ({
  resolveCommentTarget: (...args: any[]) => mockResolveTarget(...args),
  searchComments: (...args: any[]) => mockSearchComments(...args),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  updateComment: jest.fn()
}));

const viewer = { _id: 'viewer-1', username: 'me', name: 'Me' };
jest.mock('@providers/profile.provider', () => ({
  useProfile: () => ({ current: viewer })
}));

jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

function comment(overrides: Record<string, any> = {}) {
  return {
    _id: 'c-root',
    content: 'A root comment',
    objectId: 'post-1',
    objectType: 'post',
    createdBy: 'u-1',
    user: { _id: 'u-1', name: 'Root Author', username: 'root' },
    totalReply: 0,
    totalLike: 0,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function page(data: any[], extra: Record<string, any> = {}) {
  return {
    data: {
      data, total: data.length, hasMore: false, nextCursor: null, ...extra
    }
  };
}

function renderComments(targetCommentId?: string | null, fallbackId?: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommentWrapper
        contentId="post-1"
        contentType="post"
        user={viewer as any}
        initialVisible
        autoload
        targetCommentId={targetCommentId}
        targetCommentFallbackId={fallbackId}
      />
    </QueryClientProvider>
  );
}

/** Ids of every rendered comment row, in DOM order. */
function renderedIds(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-comment-id]'))
    .map((node) => node.getAttribute('data-comment-id'));
}

beforeEach(() => {
  mockSearchComments.mockResolvedValue(page([comment({ _id: 'c-recent', content: 'A recent comment' })]));
  mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });
});

describe('notification target is context, not part of the ordering', () => {
  it('renders the target in a distinct context section', async () => {
    const target = comment({ _id: 'c-target', content: 'The mentioned comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');

    const context = await screen.findByTestId('comment-target-context');
    expect(context).toHaveTextContent('The mentioned comment');
    expect(context).toHaveTextContent('From your notification');
  });

  it('does not hoist the target into the canonical order', async () => {
    const target = comment({ _id: 'c-old', content: 'An old comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });
    mockSearchComments.mockResolvedValue(page([
      comment({ _id: 'c1', content: 'newest' }),
      comment({ _id: 'c2', content: 'middle' }),
      comment({ _id: 'c3', content: 'oldest' })
    ]));

    const { container } = renderComments('c-old');
    await screen.findByTestId('comment-target-context');

    // Server order untouched; the target was not moved to index 0 of the list.
    expect(renderedIds(container).filter((id) => id !== 'c-old')).toEqual(['c1', 'c2', 'c3']);
  });

  it('shows the target once when it is also on the loaded page', async () => {
    const target = comment({ _id: 'c2', content: 'middle' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });
    mockSearchComments.mockResolvedValue(page([
      comment({ _id: 'c1', content: 'newest' }),
      comment({ _id: 'c2', content: 'middle' }),
      comment({ _id: 'c3', content: 'oldest' })
    ]));

    const { container } = renderComments('c2');
    await screen.findByTestId('comment-target-context');

    expect(container.querySelectorAll('[data-comment-id="c2"]')).toHaveLength(1);
    // The survivors keep their relative server order; only the duplicate went.
    expect(renderedIds(container)).toEqual(['c2', 'c1', 'c3']);
  });

  it('shows no context section when the tab is opened normally', async () => {
    renderComments(null);
    await screen.findByText('A recent comment');
    expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument();
  });

  it('renders a deleted target inside the context section', async () => {
    renderComments('c-gone');

    const context = await screen.findByTestId('comment-target-context');
    expect(context).toHaveTextContent('This comment has been deleted.');
    expect(context).toHaveTextContent('From your notification');
  });

  it('shows root and reply together for a reply target', async () => {
    const root = comment({ _id: 'c-root', content: 'Root of the thread' });
    const reply = comment({
      _id: 'c-reply', content: 'The actual reply', objectId: 'c-root', objectType: 'comment'
    });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: reply, root } });

    renderComments('c-reply');

    const context = await screen.findByTestId('comment-target-context');
    // The root alone would not explain what was replied to.
    expect(context).toHaveTextContent('Root of the thread');
    expect(context).toHaveTextContent('The actual reply');
  });

  it('uses the aggregate fallback when the newest event is gone', async () => {
    const c5 = comment({ _id: 'c5', content: 'The comment that opened the group' });
    mockResolveTarget.mockImplementation((id: string) => Promise.resolve(
      id === 'c5'
        ? { data: { found: true, comment: c5, root: c5 } }
        : { data: { found: false, comment: null, root: null } }
    ));

    renderComments('c7', 'c5');

    const context = await screen.findByTestId('comment-target-context');
    expect(context).toHaveTextContent('The comment that opened the group');
  });

  it('renders no context section when every retained aggregate id is gone', async () => {
    renderComments('c7', 'c5');

    await waitFor(() => expect(mockResolveTarget).toHaveBeenCalledTimes(2));
    // Middle events may still exist, so claiming a deletion would be wrong.
    expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument();
  });
});

describe('comment infinite scroll', () => {
  let triggerSentinel: (() => void) | null = null;

  beforeEach(() => {
    triggerSentinel = null;
    (window as any).IntersectionObserver = class {
      constructor(callback: any) {
        triggerSentinel = () => callback([{ isIntersecting: true }]);
      }

      observe() { return undefined; }

      unobserve() { return undefined; }

      disconnect() { return undefined; }

      takeRecords() { return []; }
    };
  });

  it('renders the initial page with a single request', async () => {
    mockSearchComments.mockResolvedValue(page([comment({ _id: 'c1', content: 'first page' })]));

    renderComments(null);

    expect(await screen.findByText('first page')).toBeInTheDocument();
    expect(mockSearchComments).toHaveBeenCalledTimes(1);
  });

  it('replaces the manual control with a sentinel while a page remains', async () => {
    mockSearchComments.mockResolvedValue(page(
      [comment({ _id: 'c1', content: 'page one' })],
      { hasMore: true, nextCursor: { id: 'c1', createdAt: 1 } }
    ));

    renderComments(null);
    await screen.findByText('page one');

    expect(screen.getByTestId('comment-scroll-sentinel')).toBeInTheDocument();
    expect(screen.queryByText('View more comments')).not.toBeInTheDocument();
  });

  it('stops observing once there is no next page', async () => {
    mockSearchComments.mockResolvedValue(page([comment({ _id: 'c1', content: 'only page' })]));

    renderComments(null);
    await screen.findByText('only page');

    expect(screen.queryByTestId('comment-scroll-sentinel')).not.toBeInTheDocument();
  });

  it('appends the next page when the sentinel is reached', async () => {
    mockSearchComments.mockResolvedValueOnce(page(
      [comment({ _id: 'c1', content: 'page one' })],
      { hasMore: true, nextCursor: { id: 'c1', createdAt: 1 } }
    ));
    renderComments(null);
    await screen.findByText('page one');

    mockSearchComments.mockResolvedValueOnce(page([comment({ _id: 'c2', content: 'page two' })]));
    await act(async () => { triggerSentinel?.(); });

    // Appended, with the first page preserved.
    expect(await screen.findByText('page two')).toBeInTheDocument();
    expect(screen.getByText('page one')).toBeInTheDocument();
  });

  it('pages with the cursor rather than refetching from the start', async () => {
    mockSearchComments.mockResolvedValueOnce(page(
      [comment({ _id: 'c1', content: 'page one' })],
      { hasMore: true, nextCursor: { id: 'c1', createdAt: 99 } }
    ));
    renderComments(null);
    await screen.findByText('page one');

    mockSearchComments.mockResolvedValueOnce(page([comment({ _id: 'c2', content: 'page two' })]));
    await act(async () => { triggerSentinel?.(); });
    await screen.findByText('page two');

    expect(mockSearchComments).toHaveBeenLastCalledWith(
      'post',
      'post-1',
      expect.objectContaining({ cursor: 'c1', lastCreatedAt: '99' })
    );
  });

  it('does not start a second request while one is in flight', async () => {
    mockSearchComments.mockResolvedValueOnce(page(
      [comment({ _id: 'c1', content: 'page one' })],
      { hasMore: true, nextCursor: { id: 'c1', createdAt: 1 } }
    ));
    renderComments(null);
    await screen.findByText('page one');

    // Held open so all three triggers land during the same load.
    let release: (value: any) => void = () => undefined;
    mockSearchComments.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));

    await act(async () => {
      triggerSentinel?.();
      triggerSentinel?.();
      triggerSentinel?.();
    });

    // One initial page plus one in-flight request — the repeats were dropped.
    expect(mockSearchComments).toHaveBeenCalledTimes(2);
    await act(async () => { release(page([comment({ _id: 'c2', content: 'page two' })])); });
  });
});
