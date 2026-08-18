import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  render, screen, waitFor
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import CommentWrapper from './comment-wrapper';

/**
 * Leaving the notification context without reloading.
 *
 * The invariant under test is that dismissing is *only* a navigation-state
 * change: the canonical comment list, its ordering and its cursor are all
 * untouched, because the target was never part of that list to begin with.
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
jest.mock('@providers/profile.provider', () => ({ useProfile: () => ({ current: viewer }) }));
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('src/socket/use-socket-listener', () => ({ useSocketListener: () => undefined }));

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

function renderComments(targetId?: string | null, fallbackId?: string | null) {
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
        targetCommentId={targetId}
        targetCommentFallbackId={fallbackId}
      />
    </QueryClientProvider>
  );
}

const renderedIds = (container: HTMLElement) => Array.from(
  container.querySelectorAll('[data-comment-id]')
).map((n) => n.getAttribute('data-comment-id'));

const dismissControl = () => screen.getByRole('button', { name: 'Dismiss notification context' });

let replaceSpy: jest.SpyInstance;
let pushSpy: jest.SpyInstance;

beforeEach(() => {
  window.history.replaceState(
    null, '',
    '/?modal_id=post-1&modal_tab=comments&target_comment_id=c-target&target_comment_fallback_id=c-fb'
  );
  replaceSpy = jest.spyOn(window.history, 'replaceState');
  pushSpy = jest.spyOn(window.history, 'pushState');
  mockSearchComments.mockResolvedValue(page([
    comment({ _id: 'c1', content: 'newest' }),
    comment({ _id: 'c2', content: 'middle' }),
    comment({ _id: 'c3', content: 'oldest' })
  ]));
  mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });
});

afterEach(() => {
  replaceSpy.mockRestore();
  pushSpy.mockRestore();
});

describe('dismissing the notification context', () => {
  it('offers a dismiss control while the context is shown', async () => {
    const target = comment({ _id: 'c-target', content: 'The mentioned comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');

    await screen.findByTestId('comment-target-context');
    expect(dismissControl()).toBeInTheDocument();
  });

  it('removes the context when dismissed', async () => {
    const target = comment({ _id: 'c-target', content: 'The mentioned comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');
    await screen.findByTestId('comment-target-context');

    await userEvent.click(dismissControl());

    await waitFor(() => expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument());
  });

  it('strips only the target params, keeping the modal and tab', async () => {
    const target = comment({ _id: 'c-target' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');
    await screen.findByTestId('comment-target-context');
    await userEvent.click(dismissControl());

    const url = new URL(window.location.href);
    expect(url.searchParams.get('target_comment_id')).toBeNull();
    expect(url.searchParams.get('target_comment_fallback_id')).toBeNull();
    // The post must stay open on the conversation.
    expect(url.searchParams.get('modal_id')).toBe('post-1');
    expect(url.searchParams.get('modal_tab')).toBe('comments');
  });

  it('replaces history rather than adding an entry', async () => {
    const target = comment({ _id: 'c-target' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');
    await screen.findByTestId('comment-target-context');
    pushSpy.mockClear();

    await userEvent.click(dismissControl());

    // Back must not bounce the reader into the context they just closed.
    expect(replaceSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });

  it('leaves the canonical list and its order untouched', async () => {
    const target = comment({ _id: 'c-old', content: 'An old comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    const { container } = renderComments('c-old');
    await screen.findByTestId('comment-target-context');
    const before = renderedIds(container).filter((id) => id !== 'c-old');

    await userEvent.click(dismissControl());
    await waitFor(() => expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument());

    // Dismiss is navigation state only — nothing is prepended, re-sorted or refetched.
    expect(renderedIds(container)).toEqual(before);
    expect(renderedIds(container)).toEqual(['c1', 'c2', 'c3']);
  });

  it('does not inject an out-of-page target into the list', async () => {
    const target = comment({ _id: 'c-old', content: 'An old comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    const { container } = renderComments('c-old');
    await screen.findByTestId('comment-target-context');
    await userEvent.click(dismissControl());

    await waitFor(() => expect(container.querySelector('[data-comment-id="c-old"]')).toBeNull());
  });

  it('keeps a naturally present target in its canonical position', async () => {
    const target = comment({ _id: 'c2', content: 'middle' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    const { container } = renderComments('c2');
    await screen.findByTestId('comment-target-context');
    await userEvent.click(dismissControl());

    await waitFor(() => expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument());
    // Its natural copy returns to where the server put it, not to the top.
    expect(renderedIds(container)).toEqual(['c1', 'c2', 'c3']);
  });

  it('does not refetch the comment list', async () => {
    const target = comment({ _id: 'c-target' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');
    await screen.findByTestId('comment-target-context');
    const calls = mockSearchComments.mock.calls.length;

    await userEvent.click(dismissControl());

    // The cursor keeps its position; pagination is not restarted.
    expect(mockSearchComments.mock.calls.length).toBe(calls);
  });

  it('dismisses a deleted-target context', async () => {
    renderComments('c-gone');

    const context = await screen.findByTestId('comment-target-context');
    expect(context).toHaveTextContent('This comment has been deleted.');

    await userEvent.click(dismissControl());

    await waitFor(() => expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument());
    // The comment list is still there — only the context went.
    expect(screen.getByText('newest')).toBeInTheDocument();
  });

  it('dismisses an aggregate fallback context', async () => {
    const fallback = comment({ _id: 'c-fb', content: 'the comment that opened the group' });
    mockResolveTarget.mockImplementation((id: string) => Promise.resolve(
      id === 'c-fb'
        ? { data: { found: true, comment: fallback, root: fallback } }
        : { data: { found: false, comment: null, root: null } }
    ));

    renderComments('c-target', 'c-fb');

    const context = await screen.findByTestId('comment-target-context');
    expect(context).toHaveTextContent('the comment that opened the group');

    await userEvent.click(dismissControl());

    await waitFor(() => expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument());
  });

  it('shows the context again for a different notification target', async () => {
    const target = comment({ _id: 'c-target' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    const { rerender } = renderComments('c-target');
    await screen.findByTestId('comment-target-context');
    await userEvent.click(dismissControl());
    await waitFor(() => expect(screen.queryByTestId('comment-target-context')).not.toBeInTheDocument());

    // A new target is a new context; a previous dismissal must not suppress it.
    const queryClient = new QueryClient();
    rerender(
      <QueryClientProvider client={queryClient}>
        <CommentWrapper
          contentId="post-1"
          contentType="post"
          user={viewer as any}
          initialVisible
          autoload
          targetCommentId="c-other"
        />
      </QueryClientProvider>
    );

    expect(await screen.findByTestId('comment-target-context')).toBeInTheDocument();
  });
});
