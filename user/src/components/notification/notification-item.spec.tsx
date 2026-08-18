import { INotification, NOTIFICATION_TYPE } from '@interfaces/notification';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import NotificationItem from './notification-item';

/**
 * The row in isolation, where both read and unread states can be observed —
 * through the panel every row normalises to read on open.
 */

/**
 * The row now offers a delete action, which reads from the provider. This spec
 * covers the row's presentation and navigation, so only that surface is stood
 * in for — provider behaviour has its own tests.
 */
const mockRemoveNotification = jest.fn();
jest.mock('@providers/notification.provider', () => ({
  useNotifications: () => ({ removeNotification: mockRemoveNotification })
}));

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush })
}));

jest.mock('@hooks/use-follow-creator', () => ({
  useFollowCreator: (_creatorId?: string, initialIsFollowed = false) => ({
    isFollowed: initialIsFollowed,
    following: false,
    isOwner: false,
    toggleFollow: jest.fn()
  })
}));

function notification(overrides: Partial<INotification> = {}): INotification {
  return {
    _id: 'n1',
    type: NOTIFICATION_TYPE.POST_LIKE,
    actorId: 'a1',
    actor: { _id: 'a1', username: 'bee', name: 'Bee' },
    postId: 'p1',
    read: false,
    lastActivityAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    ...overrides
  };
}

const onNavigate = jest.fn();

/**
 * The row itself, not the actions menu inside it — both are buttons now, so
 * the row is reached through its content.
 */
const row = () => screen.getByText('Bee').closest('[role="button"]') as HTMLElement;

function renderItem(overrides: Partial<INotification> = {}) {
  return render(
    <NotificationItem notification={notification(overrides)} onNavigate={onNavigate} />
  );
}

describe('notification row read state', () => {
  it('marks an unread row with the indicator', () => {
    renderItem({ read: false });
    expect(screen.getByLabelText('Unread')).toBeInTheDocument();
  });

  it('drops the indicator once the row is read', () => {
    renderItem({ read: true });
    expect(screen.queryByLabelText('Unread')).not.toBeInTheDocument();
  });

  it('navigates whether the row is read or unread', async () => {
    const { unmount } = renderItem({ read: false, postId: 'p-1' });
    await userEvent.click(row());
    expect(mockPush).toHaveBeenLastCalledWith('/?modal_id=p-1');
    unmount();

    // A read row is the normal state after the first visit; losing its target
    // here would make every returning visit dead.
    renderItem({ read: true, postId: 'p-2' });
    await userEvent.click(row());
    expect(mockPush).toHaveBeenLastCalledWith('/?modal_id=p-2');
  });

  it('stays inert when there is no resolvable target', async () => {
    renderItem({ postId: null });
    await userEvent.click(row());

    expect(mockPush).not.toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('renders the removed-comment notice alongside the normal sentence', () => {
    renderItem({
      type: NOTIFICATION_TYPE.COMMENT_MENTION,
      commentId: 'c-1',
      commentDeleted: true
    });

    // Actor, notice and the original wording all survive — the interaction
    // history is kept, only the quoted content is gone.
    expect(screen.getByText('Bee')).toBeInTheDocument();
    expect(screen.getByText('This comment has been deleted.')).toBeInTheDocument();
    expect(screen.getByText('mentioned you in a comment')).toBeInTheDocument();
  });

  it('renders no notice while the comment still exists', () => {
    renderItem({ type: NOTIFICATION_TYPE.COMMENT_MENTION, commentId: 'c-1' });
    expect(screen.queryByText('This comment has been deleted.')).not.toBeInTheDocument();
  });

  it('still opens the containing post Comments tab for a deleted comment', async () => {
    renderItem({
      type: NOTIFICATION_TYPE.COMMENT_REPLY,
      postId: 'p-7',
      commentId: 'c-1',
      commentDeleted: true
    });

    await userEvent.click(row());

    // The post still exists, so the row must not become a dead end.
    expect(mockPush).toHaveBeenCalledWith('/?modal_id=p-7&modal_tab=comments&target_comment_id=c-1');
  });

  it('renders the quoted comment between the actor and the action', () => {
    renderItem({
      type: NOTIFICATION_TYPE.COMMENT_MENTION,
      commentId: 'c-1',
      commentPreview: 'Is there a good travel guide? @devuser'
    });

    expect(screen.getByText('Bee')).toBeInTheDocument();
    expect(screen.getByText('Is there a good travel guide? @devuser')).toBeInTheDocument();
    expect(screen.getByText('mentioned you in a comment')).toBeInTheDocument();
  });

  it('renders the deletion notice in place of a quote', () => {
    renderItem({
      type: NOTIFICATION_TYPE.COMMENT_MENTION,
      commentId: 'c-1',
      commentDeleted: true
    });

    expect(screen.getByText('This comment has been deleted.')).toBeInTheDocument();
    expect(screen.getByText('mentioned you in a comment')).toBeInTheDocument();
  });

  it('falls back to a placeholder avatar rather than rendering a broken image', () => {
    const { container } = renderItem({ actor: { _id: 'a1', name: 'Bee' } });
    expect(container.querySelector('img')).toHaveAttribute('src', '/no_avatar.jpeg');
  });
});
