import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';

import SharePopover from './share-popover';

/**
 * The share panel has two jobs that are easy to get wrong and expensive when
 * they are: it must not touch the post's statistics for anything except a real
 * share, and it must present one list of people rather than two overlapping ones.
 *
 * These tests pin both, plus the interaction details that decide whether the
 * panel is usable at all — reaching it with the pointer, and leaving it.
 */

jest.mock('next-auth/react', () => ({
  useSession: () => ({ data: { user: { _id: 'me' } }, status: 'authenticated' })
}));

const sharePostToMessage = jest.fn();
jest.mock('@services/message.service', () => ({
  sharePostToMessage: (...args: unknown[]) => sharePostToMessage(...args)
}));

const getCreatorFollowings = jest.fn();
const getCreatorFollowers = jest.fn();
jest.mock('@services/user.service', () => ({
  getCreatorFollowings: (...args: unknown[]) => getCreatorFollowings(...args),
  getCreatorFollowers: (...args: unknown[]) => getCreatorFollowers(...args)
}));

/** `recordShare` is the only thing that can move `totalShare` from the client. */
const recordShare = jest.fn();
jest.mock('@services/reaction.service', () => ({
  recordShare: (...args: unknown[]) => recordShare(...args)
}));

const page = (users: Array<{ _id: string; name: string }>) => ({ data: { data: users } });

function renderPopover(onShared = jest.fn()) {
  render(
    <SharePopover postId="post-1" shareUrl="https://example.test/?modal_id=post-1" onShared={onShared}>
      <button type="button">Share</button>
    </SharePopover>
  );
  return onShared;
}

/** Opening is a hover with intent, so the timer has to run. */
async function openPanel() {
  fireEvent.pointerEnter(screen.getByText('Share'), { pointerType: 'mouse' });
  await act(async () => { jest.advanceTimersByTime(200); });
  await screen.findByRole('dialog', { name: 'Share this post' });
}

beforeEach(() => {
  jest.useFakeTimers();
  sharePostToMessage.mockReset().mockResolvedValue({
    data: { shareCounted: true, conversationId: 'c1' }
  });
  recordShare.mockReset();
  getCreatorFollowings.mockReset().mockResolvedValue(page([{ _id: 'u1', name: 'Ann' }]));
  getCreatorFollowers.mockReset().mockResolvedValue(page([{ _id: 'u2', name: 'Bo' }]));
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('opening and closing', () => {
  it('opens on hover', async () => {
    renderPopover();
    await openPanel();

    expect(screen.getByRole('dialog', { name: 'Share this post' })).toBeInTheDocument();
  });

  it('survives the pointer travelling from the button to the panel', async () => {
    renderPopover();
    await openPanel();

    // Leaving the trigger starts a close timer rather than closing outright,
    // because for a moment the pointer is over the gap between the two.
    fireEvent.pointerLeave(screen.getByText('Share'), { pointerType: 'mouse' });
    await act(async () => { jest.advanceTimersByTime(100); });

    expect(screen.getByRole('dialog', { name: 'Share this post' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    renderPopover();
    await openPanel();

    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });

    expect(screen.queryByRole('dialog', { name: 'Share this post' })).not.toBeInTheDocument();
  });

  it('closes when something outside is clicked', async () => {
    renderPopover();
    await openPanel();

    await act(async () => { fireEvent.pointerDown(document.body); });

    expect(screen.queryByRole('dialog', { name: 'Share this post' })).not.toBeInTheDocument();
  });

  it('asks for nobody until it is opened', () => {
    renderPopover();

    // A feed can hold twenty of these. Fetching on mount would be twenty
    // requests for a panel nobody looked at.
    expect(getCreatorFollowings).not.toHaveBeenCalled();
    expect(getCreatorFollowers).not.toHaveBeenCalled();
  });
});

describe('recipient list', () => {
  it('merges followers and following into one list', async () => {
    renderPopover();
    await openPanel();

    expect(await screen.findByText('Ann')).toBeInTheDocument();
    expect(screen.getByText('Bo')).toBeInTheDocument();
  });

  it('shows somebody who is both a follower and a followee once', async () => {
    getCreatorFollowings.mockResolvedValue(page([{ _id: 'u1', name: 'Ann' }]));
    getCreatorFollowers.mockResolvedValue(page([{ _id: 'u1', name: 'Ann' }]));

    renderPopover();
    await openPanel();

    await screen.findByText('Ann');
    expect(screen.getAllByText('Ann')).toHaveLength(1);
  });

  it('never lists the current user', async () => {
    getCreatorFollowings.mockResolvedValue(page([{ _id: 'me', name: 'Myself' }]));
    getCreatorFollowers.mockResolvedValue(page([{ _id: 'u2', name: 'Bo' }]));

    renderPopover();
    await openPanel();

    await screen.findByText('Bo');
    expect(screen.queryByText('Myself')).not.toBeInTheDocument();
  });

  it('searches on the server rather than filtering what it has', async () => {
    renderPopover();
    await openPanel();
    await screen.findByText('Ann');

    fireEvent.change(screen.getByLabelText('Search friends'), { target: { value: 'bo' } });
    await act(async () => { jest.advanceTimersByTime(400); });

    await waitFor(() => {
      expect(getCreatorFollowings).toHaveBeenLastCalledWith('me', expect.objectContaining({ q: 'bo' }));
    });
  });

  it('offers a retry when the list cannot be loaded', async () => {
    getCreatorFollowings.mockRejectedValue(new Error('offline'));

    renderPopover();
    await openPanel();

    expect(await screen.findByText('Try again')).toBeInTheDocument();
  });

  it('says so when there is nobody to share with', async () => {
    getCreatorFollowings.mockResolvedValue(page([]));
    getCreatorFollowers.mockResolvedValue(page([]));

    renderPopover();
    await openPanel();

    expect(await screen.findByText(/Follow someone to share with them/i)).toBeInTheDocument();
  });
});

describe('sharing', () => {
  it('sends the post to the chosen person', async () => {
    renderPopover();
    await openPanel();
    await screen.findByText('Ann');

    await act(async () => { screen.getByLabelText('Share with Ann').click(); });

    expect(sharePostToMessage).toHaveBeenCalledWith('post-1', 'u1');
  });

  it('does not send twice when the button is clicked twice', async () => {
    renderPopover();
    await openPanel();
    await screen.findByText('Ann');

    const button = screen.getByLabelText('Share with Ann');
    await act(async () => { button.click(); });
    await act(async () => { button.click(); });

    expect(sharePostToMessage).toHaveBeenCalledTimes(1);
  });

  it('reports a refusal on the row it belongs to', async () => {
    sharePostToMessage.mockRejectedValue({
      details: { error: 'MESSAGE_REQUEST_PENDING' }
    });

    renderPopover();
    await openPanel();
    await screen.findByText('Ann');

    await act(async () => { screen.getByLabelText('Share with Ann').click(); });

    expect(await screen.findByText(/one message until they reply/i)).toBeInTheDocument();
  });

  it('treats a duplicate as already sent rather than as a failure', async () => {
    sharePostToMessage.mockRejectedValue({ details: { error: 'DUPLICATE_SHARE' } });

    renderPopover();
    await openPanel();
    await screen.findByText('Ann');

    await act(async () => { screen.getByLabelText('Share with Ann').click(); });

    expect(await screen.findByText('Sent')).toBeInTheDocument();
  });
});

describe('share statistics', () => {
  it('does not record a share for opening the panel', async () => {
    const onShared = renderPopover();
    await openPanel();
    await screen.findByText('Ann');

    expect(recordShare).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });

  it('does not record a share for searching', async () => {
    const onShared = renderPopover();
    await openPanel();
    fireEvent.change(screen.getByLabelText('Search friends'), { target: { value: 'an' } });
    await act(async () => { jest.advanceTimersByTime(400); });

    expect(onShared).not.toHaveBeenCalled();
  });

  it('leaves the counter alone when the server did not count the share', async () => {
    sharePostToMessage.mockResolvedValue({ data: { shareCounted: false } });

    const onShared = renderPopover();
    await openPanel();
    await screen.findByText('Ann');
    await act(async () => { screen.getByLabelText('Share with Ann').click(); });

    expect(onShared).not.toHaveBeenCalled();
  });

  it('advances the counter once for a share the server counted', async () => {
    const onShared = renderPopover();
    await openPanel();
    await screen.findByText('Ann');
    await act(async () => { screen.getByLabelText('Share with Ann').click(); });

    expect(onShared).toHaveBeenCalledTimes(1);
  });

  it('keeps the placeholder actions inert', async () => {
    const onShared = renderPopover();
    await openPanel();

    const download = screen.getByLabelText('Download — coming soon');
    expect(download).toBeDisabled();

    await act(async () => { download.click(); });

    expect(sharePostToMessage).not.toHaveBeenCalled();
    expect(onShared).not.toHaveBeenCalled();
  });
});
