import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CommentWrapper from './comment-wrapper';

/**
 * Notification deep-linking into the comment list: an existing target is pulled
 * in and highlighted, a reply has its thread expanded, and a target that no
 * longer exists is explained rather than left as an empty list.
 *
 * Only the network boundaries and the viewer identity are stood in for; the
 * resolution hook, the merge and the highlight all run for real.
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

function commentPage(data: any[]) {
  return {
    data: {
      data, total: data.length, hasMore: false, nextCursor: null
    }
  };
}

function renderComments(targetCommentId?: string | null, targetCommentFallbackId?: string | null) {
  // Comment rows contain a LikeButton, which uses react-query. The real
  // provider is used rather than a stub so the rows render as they do in the app.
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
        targetCommentFallbackId={targetCommentFallbackId}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  // The loaded page deliberately does NOT contain the target, which is the
  // normal case for an old comment on a busy post.
  mockSearchComments.mockResolvedValue(commentPage([
    comment({ _id: 'c-recent', content: 'A recent comment' })
  ]));
  mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });
});

describe('deep-linking to an existing comment', () => {
  it('resolves the target by id instead of paging the list', async () => {
    const target = comment({ _id: 'c-target', content: 'The mentioned comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');

    await waitFor(() => expect(mockResolveTarget).toHaveBeenCalledWith('c-target'));
    // One direct lookup — never a walk through comment pages.
    expect(mockResolveTarget).toHaveBeenCalledTimes(1);
  });

  it('renders a target that the loaded page did not contain', async () => {
    const target = comment({ _id: 'c-target', content: 'The mentioned comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderComments('c-target');

    // Pulled in and mounted, so scrolling to it can actually find it.
    expect(await screen.findByText('The mentioned comment')).toBeInTheDocument();
    expect(screen.getByText('A recent comment')).toBeInTheDocument();
  });

  it('anchors and highlights the target', async () => {
    const target = comment({ _id: 'c-target', content: 'The mentioned comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    const { container } = renderComments('c-target');
    await screen.findByText('The mentioned comment');

    const anchor = container.querySelector('[data-comment-id="c-target"]');
    expect(anchor).toBeInTheDocument();
    await waitFor(() => expect(anchor?.className).toContain('ring-1'));
  });

  it('leaves other rows unstyled', async () => {
    const target = comment({ _id: 'c-target', content: 'The mentioned comment' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    const { container } = renderComments('c-target');
    await screen.findByText('The mentioned comment');

    const other = container.querySelector('[data-comment-id="c-recent"]');
    expect(other?.className).not.toContain('ring-1');
  });

  it('does not resolve anything when no target is given', async () => {
    renderComments(null);
    await screen.findByText('A recent comment');
    expect(mockResolveTarget).not.toHaveBeenCalled();
  });
});

describe('deep-linking to a reply', () => {
  it('resolves the root thread as well as the reply', async () => {
    const root = comment({ _id: 'c-root', content: 'Root of the thread' });
    const reply = comment({
      _id: 'c-reply',
      content: 'The reply that mentioned me',
      objectId: 'c-root',
      objectType: 'comment'
    });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: reply, root } });

    renderComments('c-reply');

    // The root is what has to be rendered and expanded; the reply is the target.
    expect(await screen.findByText('Root of the thread')).toBeInTheDocument();
    await waitFor(() => expect(mockResolveTarget).toHaveBeenCalledWith('c-reply'));
  });

  it('does not treat the root as the target', async () => {
    const root = comment({ _id: 'c-root', content: 'Root of the thread' });
    const reply = comment({
      _id: 'c-reply', content: 'The reply', objectId: 'c-root', objectType: 'comment'
    });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: reply, root } });

    const { container } = renderComments('c-reply');
    await screen.findByText('Root of the thread');

    // Highlighting the root instead would leave the reader hunting for the reply.
    await waitFor(() => {
      expect(container.querySelector('[data-comment-id="c-root"]')?.className)
        .not.toContain('ring-1');
    });
  });
});

describe('deep-linking to a deleted target', () => {
  it('explains that the comment is gone', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });

    renderComments('c-gone');

    expect(await screen.findByText('This comment has been deleted.')).toBeInTheDocument();
  });

  it('says so as its own notice, not as a fake comment row', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });

    const { container } = renderComments('c-gone');
    const notice = await screen.findByText('This comment has been deleted.');

    // A fabricated comment row would carry a comment anchor; this must not.
    expect(notice.closest('[data-comment-id]')).toBeNull();
    expect(container.querySelector('[data-comment-id="c-gone"]')).toBeNull();
  });

  it('still shows the surviving comments alongside the notice', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });

    renderComments('c-gone');

    await screen.findByText('This comment has been deleted.');
    expect(screen.getByText('A recent comment')).toBeInTheDocument();
  });

  it('explains a failed lookup the same way rather than hanging', async () => {
    mockResolveTarget.mockRejectedValue(new Error('network'));

    renderComments('c-gone');

    expect(await screen.findByText('This comment has been deleted.')).toBeInTheDocument();
  });

  it('shows no notice when there is no target at all', async () => {
    renderComments(null);
    await screen.findByText('A recent comment');
    expect(screen.queryByText('This comment has been deleted.')).not.toBeInTheDocument();
  });
});

describe('aggregated POST_COMMENT target', () => {
  it('focuses the newest represented event', async () => {
    const c7 = comment({ _id: 'c7', content: 'The newest comment' });
    mockResolveTarget.mockImplementation((id: string) => Promise.resolve(
      id === 'c7'
        ? { data: { found: true, comment: c7, root: c7 } }
        : { data: { found: false, comment: null, root: null } }
    ));

    renderComments('c7', 'c5');

    expect(await screen.findByText('The newest comment')).toBeInTheDocument();
    // The fallback is not worth a request while the preferred target resolves.
    expect(mockResolveTarget).toHaveBeenCalledTimes(1);
    expect(mockResolveTarget).toHaveBeenCalledWith('c7');
  });

  it('falls back to the originating comment when the newest event is deleted', async () => {
    const c5 = comment({ _id: 'c5', content: 'The comment that opened the group' });
    mockResolveTarget.mockImplementation((id: string) => Promise.resolve(
      id === 'c5'
        ? { data: { found: true, comment: c5, root: c5 } }
        : { data: { found: false, comment: null, root: null } }
    ));

    const { container } = renderComments('c7', 'c5');

    // C5 is a genuinely represented event, not a guess.
    expect(await screen.findByText('The comment that opened the group')).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('[data-comment-id="c5"]')?.className).toContain('ring-1');
    });
    expect(screen.queryByText('This comment has been deleted.')).not.toBeInTheDocument();
  });

  it('does not claim the comment was deleted when the row represents several events', async () => {
    // Both retained ids are gone, but C6 may well still exist — the model never
    // recorded it, so claiming a single deletion would be misleading.
    mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });

    renderComments('c7', 'c5');

    await waitFor(() => expect(mockResolveTarget).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('This comment has been deleted.')).not.toBeInTheDocument();
    // The conversation still opens rather than dead-ending.
    expect(await screen.findByText('A recent comment')).toBeInTheDocument();
  });

  it('still explains a deleted target for a single-event row', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });

    renderComments('c-gone');

    // No fallback supplied means one event, so the tombstone wording is honest.
    expect(await screen.findByText('This comment has been deleted.')).toBeInTheDocument();
  });
});
