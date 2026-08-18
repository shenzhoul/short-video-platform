import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import CommentWrapper from './comment-wrapper';

/**
 * The comment total flows one way.
 *
 * There used to be two effects pointing at each other — one reporting the local
 * total upward whenever it changed, one mirroring the incoming prop back into
 * that same local state. Any momentary disagreement between them (an optimistic
 * +1 racing an authoritative stats snapshot) made them chase each other until
 * React aborted with "Maximum update depth exceeded".
 */

const mockSearchComments = jest.fn();
const mockResolveTarget = jest.fn();

jest.mock('@services/comment.service', () => ({
  searchComments: (...args: any[]) => mockSearchComments(...args),
  resolveCommentTarget: (...args: any[]) => mockResolveTarget(...args),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  updateComment: jest.fn()
}));

const viewer = { _id: 'viewer-1', username: 'me', name: 'Me' };
jest.mock('@providers/profile.provider', () => ({ useProfile: () => ({ current: viewer }) }));
jest.mock('react-toastify', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
jest.mock('src/socket/use-socket-listener', () => ({ useSocketListener: () => undefined }));

const onTotalChange = jest.fn();

function comment(overrides: Record<string, any> = {}) {
  return {
    _id: 'c1',
    content: 'a comment',
    objectId: 'post-1',
    objectType: 'post',
    createdBy: 'u-1',
    user: { _id: 'u-1', name: 'Author', username: 'author' },
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

function renderWrapper(props: Record<string, any> = {}) {
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
        onTotalChange={onTotalChange}
        {...props}
      />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  onTotalChange.mockClear();
  mockSearchComments.mockResolvedValue(page([comment()]));
  mockResolveTarget.mockResolvedValue({ data: { found: false, comment: null, root: null } });
});

describe('comment total flows one way', () => {
  it('does not report the total upward merely because it was received', async () => {
    renderWrapper({ initialTotalComments: 7 });
    await screen.findByText('a comment');

    // Reporting a value that came *from* the parent is what closed the loop.
    expect(onTotalChange).not.toHaveBeenCalled();
  });

  it('does not report again when the same total is received repeatedly', async () => {
    const { rerender } = renderWrapper({ initialTotalComments: 7 });
    await screen.findByText('a comment');

    const queryClient = new QueryClient();
    for (let index = 0; index < 5; index += 1) {
      rerender(
        <QueryClientProvider client={queryClient}>
          <CommentWrapper
            contentId="post-1"
            contentType="post"
            user={viewer as any}
            initialVisible
            autoload
            onTotalChange={onTotalChange}
            initialTotalComments={7}
          />
        </QueryClientProvider>
      );
    }

    expect(onTotalChange).not.toHaveBeenCalled();
  });

  it('settles when an authoritative total replaces a different one', async () => {
    const { rerender } = renderWrapper({ initialTotalComments: 7 });
    await screen.findByText('a comment');

    // What a post:stats_updated snapshot looks like from here.
    const queryClient = new QueryClient();
    rerender(
      <QueryClientProvider client={queryClient}>
        <CommentWrapper
          contentId="post-1"
          contentType="post"
          user={viewer as any}
          initialVisible
          autoload
          onTotalChange={onTotalChange}
          initialTotalComments={12}
        />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByText(/All Comments \(12\)/)).toBeInTheDocument());
    // The displayed value follows the parent without echoing back.
    expect(onTotalChange).not.toHaveBeenCalled();
  });

  it('renders the authoritative total it was given', async () => {
    renderWrapper({ initialTotalComments: 42 });
    expect(await screen.findByText(/All Comments \(42\)/)).toBeInTheDocument();
  });

  it('stays stable when a notification target is resolving', async () => {
    const target = comment({ _id: 'c-target', content: 'the target' });
    mockResolveTarget.mockResolvedValue({ data: { found: true, comment: target, root: target } });

    renderWrapper({ initialTotalComments: 7, targetCommentId: 'c-target' });

    // The notification path adds extra state writes while the total is
    // propagating, which is where the loop used to surface.
    await screen.findByTestId('comment-target-context');
    expect(onTotalChange).not.toHaveBeenCalled();
  });
});
