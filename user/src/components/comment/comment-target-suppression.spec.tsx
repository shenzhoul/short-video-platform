import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CommentWrapper from './comment-wrapper';

/**
 * One thread, shown once.
 *
 * The notification card and the canonical list can both be showing the same
 * thread, so exactly one of them must render it. Suppression was keyed on the
 * *target's* id, which works for a top-level comment and silently does nothing
 * for a reply: a reply's id never matches a row in a list that holds only
 * top-level comments, so the whole thread rendered twice.
 *
 * The fix is to suppress by the thread's **root** id. These tests pin that
 * distinction, because it is invisible in the top-level case that used to be the
 * only one exercised.
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

jest.mock('@douyin-clone/shared-toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

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

const rootA = comment({ _id: 'root-a', content: 'Thread A root', totalReply: 1 });
const rootB = comment({ _id: 'root-b', content: 'Thread B root' });
const replyInA = comment({
  _id: 'reply-a1', content: 'Reply inside A', objectId: 'root-a', objectType: 'comment'
});

/** Rows the canonical list is currently rendering, in order. */
function canonicalIds(container: HTMLElement) {
  const card = container.querySelector('[data-testid="comment-target-context"]');
  return [...container.querySelectorAll('[data-comment-id]')]
    .filter((node) => !card || !card.contains(node))
    .map((node) => node.getAttribute('data-comment-id'));
}

function renderComments(targetCommentId?: string | null, initialTotalComments = 0) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <CommentWrapper
        contentId="post-1"
        contentType="post"
        user={viewer as any}
        initialVisible
        autoload
        canReply
        initialTotalComments={initialTotalComments}
        targetCommentId={targetCommentId ?? undefined}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mockResolveTarget.mockReset();
  mockSearchComments.mockReset();
  mockSearchComments.mockImplementation((objectType: string) => Promise.resolve(
    objectType === 'comment' ? page([replyInA]) : page([rootA, rootB])
  ));
});

describe('suppressing the thread the notification card already shows', () => {
  it('hides the canonical row for a top-level target', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: rootA, root: rootA } });

    const { container } = renderComments('root-a');
    await screen.findByTestId('comment-target-context');

    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-b']));
  });

  it('hides the canonical ROOT thread for a reply target', async () => {
    // The bug: the reply's own id matches nothing in a list of top-level
    // comments, so nothing was suppressed and the thread rendered twice.
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: replyInA, root: rootA } });

    const { container } = renderComments('reply-a1');
    await screen.findByTestId('comment-target-context');

    await waitFor(() => expect(canonicalIds(container)).not.toContain('root-a'));
    expect(canonicalIds(container)).toEqual(['root-b']);
  });

  it('resolves a deeply nested target back to its first root', async () => {
    // Whatever the depth, the server reports the top-level root, and that is the
    // id the list has to filter on.
    const nested = comment({
      _id: 'reply-deep', content: 'Nested reply', objectId: 'reply-a1', objectType: 'comment'
    });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: nested, root: rootA } });

    const { container } = renderComments('reply-deep');
    await screen.findByTestId('comment-target-context');

    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-b']));
  });

  it('leaves every unrelated thread alone', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: replyInA, root: rootA } });

    const { container } = renderComments('reply-a1');
    await screen.findByTestId('comment-target-context');

    // Only the targeted thread goes; B keeps its place.
    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-b']));
  });

  it('suppresses a root that is not on the loaded page without disturbing it', async () => {
    // A reply can point at a root that no loaded page contains. Filtering must
    // simply match nothing, never fetch and never reorder.
    const offPageRoot = comment({ _id: 'root-offpage', content: 'Not on this page' });
    mockResolveTarget.mockResolvedValue({
      data: { found: true, comment: replyInA, root: offPageRoot }
    });

    const { container } = renderComments('reply-a1');
    await screen.findByTestId('comment-target-context');

    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-a', 'root-b']));
    // One page fetch for the list; nothing extra was issued to resolve this.
    const listCalls = mockSearchComments.mock.calls.filter(([type]) => type === 'post');
    expect(listCalls).toHaveLength(1);
  });

  it('restores the thread exactly once when the card is dismissed', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: replyInA, root: rootA } });

    const { container } = renderComments('reply-a1');
    const card = await screen.findByTestId('comment-target-context');
    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-b']));

    await act(async () => {
      card.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification context"]')?.click();
    });

    await waitFor(() => expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument());
    // Back in its own position, ahead of B, and only one of it. The reply sits
    // inside it because the thread is still expanded — that is the state being
    // preserved, not a duplicate.
    const restored = canonicalIds(container);
    expect(restored.filter((id) => id === 'root-a')).toHaveLength(1);
    expect(restored.indexOf('root-a')).toBeLessThan(restored.indexOf('root-b'));
    expect(container.querySelectorAll('[data-comment-id="root-a"]')).toHaveLength(1);
  });

  it('does not refetch the list to hide or restore a thread', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: replyInA, root: rootA } });

    const { container } = renderComments('reply-a1');
    const card = await screen.findByTestId('comment-target-context');
    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-b']));

    const before = mockSearchComments.mock.calls.filter(([type]) => type === 'post').length;
    await act(async () => {
      card.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification context"]')?.click();
    });
    await waitFor(() => expect(canonicalIds(container)).toContain('root-a'));

    // Suppression is a render-time filter over the array the cursor pages into.
    // Refetching would reset the cursor and could reorder what is on screen.
    expect(mockSearchComments.mock.calls.filter(([type]) => type === 'post')).toHaveLength(before);
  });

  it('keeps the total honest while a thread is hidden', async () => {
    // The comment is still there; it is only being shown somewhere else.
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: replyInA, root: rootA } });

    const { container } = renderComments('reply-a1', 2);
    const card = await screen.findByTestId('comment-target-context');
    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-b']));

    // Two top-level comments exist; one is merely being shown elsewhere. A
    // presentation filter must never make the count read 1.
    const shownWhileHidden = (container.textContent || '').match(/All Comments \((\d+)\)/);
    expect(shownWhileHidden?.[1]).toBe('2');

    await act(async () => {
      card.querySelector<HTMLButtonElement>('button[aria-label="Dismiss notification context"]')?.click();
    });
    await waitFor(() => expect(canonicalIds(container)).toContain('root-a'));

    // And restoring it does not inflate the count either.
    const shownAfter = (container.textContent || '').match(/All Comments \((\d+)\)/);
    expect(shownAfter?.[1]).toBe('2');
  });

  it('renders no duplicate entity for the target reply', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: replyInA, root: rootA } });

    const { container } = renderComments('reply-a1');
    await screen.findByTestId('comment-target-context');
    await waitFor(() => expect(container.querySelectorAll('[data-comment-id="reply-a1"]').length)
      .toBeGreaterThan(0));

    // One root and one reply on screen, wherever they are rendered.
    expect(container.querySelectorAll('[data-comment-id="root-a"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-comment-id="reply-a1"]')).toHaveLength(1);
  });

  it('falls back safely when the target cannot be resolved', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });

    const { container } = renderComments('gone');
    await screen.findByTestId('comment-target-context');

    // Nothing resolved means nothing to suppress: the list stays whole.
    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-a', 'root-b']));
  });

  it('switches suppression when a new notification arrives', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: replyInA, root: rootA } });
    const { container, rerender } = renderComments('reply-a1');
    await screen.findByTestId('comment-target-context');
    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-b']));

    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: rootB, root: rootB } });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <CommentWrapper
          contentId="post-1"
          contentType="post"
          user={viewer as any}
          initialVisible
          autoload
          canReply
          targetCommentId="root-b"
        />
      </QueryClientProvider>
    );

    // The previous thread comes back and the new one goes — never both hidden.
    await waitFor(() => expect(canonicalIds(container)).toEqual(['root-a']));
  });
});
