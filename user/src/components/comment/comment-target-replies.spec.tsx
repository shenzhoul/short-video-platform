import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import CommentWrapper from './comment-wrapper';

/**
 * Replies inside the "From your notification" section.
 *
 * The section shows a comment the list below is hiding, so if its reply control
 * is inert the reader has no way to reach the thread at all without dismissing
 * the very context they arrived for. These tests pin that the control is the
 * ordinary one, backed by the ordinary reply request.
 */

const mockResolveTarget = jest.fn();
const mockSearchComments = jest.fn();

jest.mock('@services/comment.service', () => ({
  resolveCommentTarget: (...args: any[]) => mockResolveTarget(...args),
  searchComments: (...args: any[]) => mockSearchComments(...args),
  fetchHotComment: jest.fn().mockResolvedValue({ data: { comment: null } }),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  updateComment: jest.fn()
}));

const viewer = { _id: 'viewer-1', username: 'me', name: 'Me' };
jest.mock('@providers/profile.provider', () => ({ useProfile: () => ({ current: viewer }) }));
jest.mock('@douyin-clone/shared-toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('src/socket/use-socket-listener', () => ({ useSocketListener: () => undefined }));

function comment(overrides: Record<string, any> = {}) {
  return {
    _id: 'c-target',
    content: 'the comment you were told about',
    objectId: 'post-1',
    objectType: 'post',
    createdBy: 'u-1',
    user: { _id: 'u-1', name: 'Commenter', username: 'commenter' },
    totalReply: 0,
    totalLike: 0,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function page(data: any[]) {
  return {
    data: {
      data, total: data.length, hasMore: false, nextCursor: null
    }
  };
}

const reply = (overrides: Record<string, any> = {}) => comment({
  _id: 'r-1',
  content: 'the reply',
  objectId: 'c-target',
  objectType: 'comment',
  ...overrides
});

/** Replies are requested against the parent comment, not the post. */
function respondWith(replies: any[]) {
  mockSearchComments.mockImplementation((contentType: string) => (
    contentType === 'comment'
      ? Promise.resolve(page(replies))
      : Promise.resolve(page([comment({ totalReply: replies.length })]))
  ));
}

function renderComments() {
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
        canReply
        targetCommentId="c-target"
      />
    </QueryClientProvider>
  );
}

const context = () => screen.getByTestId('comment-target-context');
const expandControl = () => screen.getByRole('button', { name: /Expand \d+ replies/ });

beforeEach(() => {
  jest.clearAllMocks();
  respondWith([reply()]);
  mockResolveTarget.mockResolvedValue({
    data: {
      found: true,
      comment: comment({ totalReply: 1 }),
      root: comment({ totalReply: 1 }),
      isReply: false
    }
  });
});

describe('replies in the notification context section', () => {
  it('loads the thread from the section itself', async () => {
    renderComments();

    await waitFor(() => expect(context()).toBeInTheDocument());
    await userEvent.click(expandControl());

    await waitFor(() => expect(screen.getByText('the reply')).toBeInTheDocument());
    // Requested against the parent comment, exactly as the canonical list does.
    expect(mockSearchComments).toHaveBeenCalledWith(
      'comment', 'c-target', expect.anything()
    );
  });

  it('shows the replies inside the section, not somewhere else on the page', async () => {
    renderComments();

    await waitFor(() => expect(context()).toBeInTheDocument());
    await userEvent.click(expandControl());

    await waitFor(() => expect(context()).toHaveTextContent('the reply'));
  });

  it('does not make the reader dismiss the context first', async () => {
    renderComments();

    await waitFor(() => expect(context()).toBeInTheDocument());
    await userEvent.click(expandControl());

    await waitFor(() => expect(screen.getByText('the reply')).toBeInTheDocument());
    // The section the reader arrived through is still there.
    expect(context()).toBeInTheDocument();
  });

  it('collapses and expands again', async () => {
    renderComments();

    await waitFor(() => expect(context()).toBeInTheDocument());

    await userEvent.click(expandControl());
    await waitFor(() => expect(screen.getByText('the reply')).toBeInTheDocument());

    await userEvent.click(screen.getByRole('button', { name: /Collapse/ }));
    await waitFor(() => expect(screen.queryByText('the reply')).not.toBeInTheDocument());

    await userEvent.click(expandControl());
    await waitFor(() => expect(screen.getByText('the reply')).toBeInTheDocument());
  });

  it('loads every reply, not just the first', async () => {
    respondWith([reply(), reply({ _id: 'r-2', content: 'second reply' })]);

    renderComments();

    await waitFor(() => expect(context()).toBeInTheDocument());
    await userEvent.click(expandControl());

    await waitFor(() => expect(screen.getByText('second reply')).toBeInTheDocument());
    expect(screen.getByText('the reply')).toBeInTheDocument();
  });

  it('offers nothing to expand on a comment without replies', async () => {
    respondWith([]);
    mockResolveTarget.mockResolvedValue({
      data: {
        found: true, comment: comment({ totalReply: 0 }), root: comment(), isReply: false
      }
    });

    renderComments();

    await waitFor(() => expect(context()).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Expand/ })).not.toBeInTheDocument();
  });

  it('survives a failed reply request', async () => {
    mockSearchComments.mockImplementation((contentType: string) => (
      contentType === 'comment'
        ? Promise.reject(new Error('network'))
        : Promise.resolve(page([comment({ totalReply: 1 })]))
    ));

    renderComments();

    await waitFor(() => expect(context()).toBeInTheDocument());
    await userEvent.click(expandControl());

    // The section keeps the comment it was opened for rather than blanking out.
    await waitFor(() => expect(context())
      .toHaveTextContent('the comment you were told about'));
  });

  it('shows a deleted target without offering replies', async () => {
    mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });

    renderComments();

    await waitFor(() => expect(context()).toHaveTextContent('This comment has been deleted.'));
    // The list below still offers its own rows; the tombstone has nothing to open.
    expect(within(context()).queryByRole('button', { name: /Expand/ })).not.toBeInTheDocument();
  });
});
