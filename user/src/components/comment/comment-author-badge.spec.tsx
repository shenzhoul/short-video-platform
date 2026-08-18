import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import React from 'react';

import ListComments from './list-comments';

/**
 * Marking the post author's own comments.
 *
 * Ownership is decided by id. Display names are neither unique nor stable, so
 * matching on them would label the wrong people.
 */

jest.mock('@services/comment.service', () => ({
  searchComments: jest.fn().mockResolvedValue({ data: { data: [], hasMore: false } }),
  resolveCommentTarget: jest.fn(),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
  updateComment: jest.fn()
}));

const OWNER = 'u-owner';

function comment(overrides: Record<string, any> = {}) {
  return {
    _id: 'c1',
    content: 'a comment',
    objectId: 'post-1',
    objectType: 'post',
    createdBy: 'u-other',
    user: { _id: 'u-other', name: 'Someone Else', username: 'someone' },
    totalReply: 0,
    totalLike: 0,
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

function renderList(comments: any[], postOwnerId?: string | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ListComments comments={comments} requesting={false} postOwnerId={postOwnerId} />
    </QueryClientProvider>
  );
}

const ownerComment = () => comment({
  createdBy: OWNER, user: { _id: OWNER, name: 'The Creator', username: 'creator' }
});

describe('Author badge', () => {
  it('marks a comment written by the post owner', () => {
    renderList([ownerComment()], OWNER);
    expect(screen.getByText('Author')).toBeInTheDocument();
  });

  it('leaves another viewer comment unmarked', () => {
    renderList([comment()], OWNER);
    expect(screen.queryByText('Author')).not.toBeInTheDocument();
  });

  it('marks nothing when the post owner is unknown', () => {
    renderList([ownerComment()], null);
    expect(screen.queryByText('Author')).not.toBeInTheDocument();
  });

  it('compares ids rather than display names', () => {
    // Same displayed name, different person.
    const impostor = comment({
      createdBy: 'u-impostor',
      user: { _id: 'u-impostor', name: 'The Creator', username: 'creator' }
    });

    renderList([impostor], OWNER);

    expect(screen.queryByText('Author')).not.toBeInTheDocument();
  });

  it('marks only the owner rows in a mixed list', () => {
    renderList([
      ownerComment(),
      comment({ _id: 'c2' }),
      comment({ _id: 'c3', createdBy: OWNER, user: { _id: OWNER, name: 'The Creator', username: 'creator' } })
    ], OWNER);

    expect(screen.getAllByText('Author')).toHaveLength(2);
  });

  it('does not change the order comments are rendered in', () => {
    const { container } = renderList([
      comment({ _id: 'c1' }),
      { ...ownerComment(), _id: 'c2' },
      comment({ _id: 'c3' })
    ], OWNER);

    // The badge is presentation only — it must never reorder or promote a row.
    const ids = Array.from(container.querySelectorAll('[data-comment-id]'))
      .map((node) => node.getAttribute('data-comment-id'));
    expect(ids).toEqual(['c1', 'c2', 'c3']);
  });
});
