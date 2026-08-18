import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CommentWrapper from './comment-wrapper';

/**
 * The hot comment slot.
 *
 * It is a presentation surface, not a sort: whatever it shows, the canonical
 * list underneath keeps its server order and its cursor. These tests pin that
 * boundary — what appears in the slot, who may see it, and what the list does
 * in response (which is: nothing).
 */

const mockResolveTarget = jest.fn();
const mockSearchComments = jest.fn();
const mockFetchHotComment = jest.fn();

jest.mock('@services/comment.service', () => ({
  resolveCommentTarget: (...args: any[]) => mockResolveTarget(...args),
  searchComments: (...args: any[]) => mockSearchComments(...args),
  fetchHotComment: (...args: any[]) => mockFetchHotComment(...args),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  updateComment: jest.fn()
}));

const viewer = { _id: 'owner-1', username: 'me', name: 'Me' };
jest.mock('@providers/profile.provider', () => ({ useProfile: () => ({ current: viewer }) }));
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('src/socket/use-socket-listener', () => ({ useSocketListener: () => undefined }));

function comment(overrides: Record<string, any> = {}) {
  return {
    _id: 'c-1',
    content: 'A comment',
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

function renderComments(options: {
  ownerId?: string | null;
  viewerId?: string | null;
  targetId?: string | null;
} = {}) {
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
        postOwnerId={'ownerId' in options ? options.ownerId : 'owner-1'}
        viewerId={'viewerId' in options ? options.viewerId : 'owner-1'}
        targetCommentId={options.targetId || null}
      />
    </QueryClientProvider>
  );
}

/** Ids of the canonical list only — context sections render comments too. */
const renderedIds = (container: HTMLElement) => Array.from(
  container.querySelectorAll('[data-comment-id]')
).filter((node) => !node.closest('[data-testid="hot-comment"]')
  && !node.closest('[data-testid="comment-target-context"]'))
  .map((n) => n.getAttribute('data-comment-id'));

const hotSlot = () => screen.queryByTestId('hot-comment');

beforeEach(() => {
  jest.clearAllMocks();
  mockResolveTarget.mockResolvedValue({ data: null });
  mockSearchComments.mockResolvedValue(page([
    comment({ _id: 'c-1', content: 'plain' }),
    comment({ _id: 'c-hot', content: 'the popular one', totalLike: 7 })
  ]));
  mockFetchHotComment.mockResolvedValue({
    data: { comment: comment({ _id: 'c-hot', content: 'the popular one', totalLike: 7 }) }
  });
});

describe('hot comment slot', () => {
  it('shows the promoted comment to the post owner', async () => {
    renderComments();

    await waitFor(() => expect(hotSlot()).toBeInTheDocument());
    expect(hotSlot()).toHaveTextContent('the popular one');
  });

  it('is not requested at all by a viewer who does not own the post', async () => {
    renderComments({ ownerId: 'someone-else', viewerId: 'owner-1' });

    await waitFor(() => expect(mockSearchComments).toHaveBeenCalled());
    expect(mockFetchHotComment).not.toHaveBeenCalled();
    expect(hotSlot()).not.toBeInTheDocument();
  });

  it('is not requested for a signed-out viewer', async () => {
    renderComments({ viewerId: null });

    await waitFor(() => expect(mockSearchComments).toHaveBeenCalled());
    expect(mockFetchHotComment).not.toHaveBeenCalled();
  });

  it('stays empty when the server promotes nothing', async () => {
    mockFetchHotComment.mockResolvedValue({ data: { comment: null } });

    renderComments();

    await waitFor(() => expect(mockFetchHotComment).toHaveBeenCalled());
    expect(hotSlot()).not.toBeInTheDocument();
  });

  it('leaves the list alone when the lookup fails', async () => {
    mockFetchHotComment.mockRejectedValue(new Error('boom'));

    const { container } = renderComments();

    await waitFor(() => expect(renderedIds(container)).toEqual(['c-1', 'c-hot']));
    expect(hotSlot()).not.toBeInTheDocument();
  });

  it('shows the promoted comment once, not twice', async () => {
    const { container } = renderComments();

    await waitFor(() => expect(hotSlot()).toBeInTheDocument());
    // Suppressed from the canonical list while it occupies the slot.
    expect(renderedIds(container)).not.toContain('c-hot');
    expect(screen.getAllByText('the popular one')).toHaveLength(1);
  });

  it('suppresses only that row and keeps the rest in server order', async () => {
    mockSearchComments.mockResolvedValue(page([
      comment({ _id: 'c-1' }),
      comment({ _id: 'c-hot', totalLike: 7 }),
      comment({ _id: 'c-2' })
    ]));

    const { container } = renderComments();

    await waitFor(() => expect(hotSlot()).toBeInTheDocument());
    expect(renderedIds(container)).toEqual(['c-1', 'c-2']);
  });

  it('does not refetch or re-page the list because of the slot', async () => {
    renderComments();

    await waitFor(() => expect(hotSlot()).toBeInTheDocument());
    // One page fetch, made for the list itself — promotion is render-time only.
    expect(mockSearchComments).toHaveBeenCalledTimes(1);
  });

  it('stands down when it would duplicate the notification target', async () => {
    const target = comment({ _id: 'c-hot', content: 'the popular one', totalLike: 7 });
    mockResolveTarget.mockResolvedValue({
      data: {
        found: true, comment: target, root: target, isReply: false
      }
    });

    renderComments({ targetId: 'c-hot' });

    await waitFor(() => expect(mockResolveTarget).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText('the popular one')).toHaveLength(1));
    // The notification the reader followed wins the explanation of why the
    // comment is at the top.
    expect(hotSlot()).not.toBeInTheDocument();
  });

  it('shows both sections when they are different comments', async () => {
    mockResolveTarget.mockResolvedValue({
      data: {
        found: true,
        comment: comment({ _id: 'c-1', content: 'you were mentioned here' }),
        root: comment({ _id: 'c-1', content: 'you were mentioned here' }),
        isReply: false
      }
    });

    const { container } = renderComments({ targetId: 'c-1' });

    await waitFor(() => expect(hotSlot()).toBeInTheDocument());
    expect(screen.getByText('you were mentioned here')).toBeInTheDocument();
    // Both are contextual sections, so neither is repeated in the list.
    expect(renderedIds(container)).toEqual([]);
  });

  it('marks the post author inside the slot', async () => {
    mockFetchHotComment.mockResolvedValue({
      data: {
        comment: comment({
          _id: 'c-hot',
          totalLike: 7,
          createdBy: 'owner-1',
          user: { _id: 'owner-1', name: 'Me', username: 'me' }
        })
      }
    });

    renderComments();

    await waitFor(() => expect(hotSlot()).toBeInTheDocument());
    expect(hotSlot()).toHaveTextContent('Author');
  });

  it('labels the slot for assistive technology', async () => {
    renderComments();

    await waitFor(() => expect(hotSlot()).toBeInTheDocument());
    expect(screen.getByRole('region', { name: 'Top comment' })).toBeInTheDocument();
  });
});
