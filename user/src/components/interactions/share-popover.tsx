'use client';

import { useHoverPopover } from '@hooks/use-hover-popover';
import { ShareRecipient, useShareRecipients } from '@hooks/use-share-recipients';
import { isDuplicateShare, resolveShareError } from '@lib/share-errors';
import { useAuthModal } from '@providers/auth-modal.provider';
import { sharePostToMessage } from '@services/message.service';
import { useSession } from 'next-auth/react';
import { ReactNode, useCallback, useState } from 'react';
import { FiAlertTriangle, FiDownload, FiGrid, FiLink, FiSearch } from 'react-icons/fi';

import ShareRecipientRow, { ShareRowStatus } from './share-recipient-row';

interface SharePopoverProps {
  postId: string;
  /** Link copied by the secondary action. */
  shareUrl: string;
  /** The Share control this panel hangs off. */
  children: ReactNode;
  /** Where the panel sits relative to the trigger. */
  panelPositionClassName?: string;
  /** Reports a share that moved the post's counter, so the rail can advance. */
  onShared?: () => void;
}

interface RowState {
  status: ShareRowStatus;
  error?: string | null;
}

/**
 * The share panel: send this post to someone, or copy a link.
 *
 * One component for every surface that shows a Share control — feed card, post
 * detail, video rail — because three implementations of a list with a permission
 * boundary in it is three places for the boundary to be wrong.
 *
 * Opening it does nothing to the post. The counter moves only when a share
 * actually succeeds, and it is the server that says whether it moved: shares are
 * counted per distinct sharer, so sending the same post to a second friend is a
 * real share that changes no number. Hovering, searching, and the secondary
 * actions below are all free.
 *
 * The recipient list is only fetched once the panel has been opened. Mounting it
 * eagerly would have every card in a feed asking for the viewer's followers.
 */
export default function SharePopover({
  postId,
  shareUrl,
  children,
  panelPositionClassName = 'bottom-0 right-full mr-3',
  onShared
}: SharePopoverProps) {
  const { data: session, status } = useSession();
  const currentUserId = (session?.user as any)?._id || null;
  const { openAuthModal } = useAuthModal();
  // Sharing a post *into a message* needs an account, and so does the recipient
  // list it is chosen from. Resolved from the session rather than from whether a
  // request happens to fail, so nothing private is requested at all.
  const canShare = status === 'authenticated';

  const [activated, setActivated] = useState(false);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [copied, setCopied] = useState(false);

  const popover = useHoverPopover({ onOpen: () => setActivated(true) });
  const {
    recipients, loading, loadingMore, error, hasMore, keyword, setKeyword, loadMore, retry
  } = useShareRecipients({ currentUserId, enabled: activated && canShare });

  const share = useCallback(async (recipient: ShareRecipient) => {
    setRows(current => ({ ...current, [recipient._id]: { status: 'sharing' } }));

    try {
      const response = await sharePostToMessage(postId, recipient._id);
      setRows(current => ({ ...current, [recipient._id]: { status: 'sent' } }));

      // Only a share the server counted moves the rail. `totalShare` counts
      // distinct sharers, so the second friend costs nothing.
      if (response?.data?.shareCounted) onShared?.();

      // Nothing else to do here: the server emits `conversation:updated` to
      // both participants, so the sender's own conversation list and its
      // preview move on their own. Refetching would just race that.
    } catch (err: any) {
      // A duplicate means the first click already worked. Showing a failure for
      // it would be wrong, so the row simply settles as sent.
      if (isDuplicateShare(err)) {
        setRows(current => ({ ...current, [recipient._id]: { status: 'sent' } }));
        return;
      }
      setRows(current => ({
        ...current,
        [recipient._id]: { status: 'failed', error: resolveShareError(err) }
      }));
    }
  }, [onShared, postId]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard access can be refused. Nothing was shared, so nothing to undo.
    }
  }, [shareUrl]);

  return (
    <div ref={popover.containerRef} className="relative" {...popover.hoverProps}>
      <div {...popover.triggerProps}>{children}</div>

      {popover.open ? (
        <div
          role="dialog"
          aria-label="Share this post"
          className={`absolute z-100 w-75 overflow-hidden rounded-xl border border-(--border-faint) bg-(--surface-raised) shadow-(--shadow-popover) ${panelPositionClassName}`}
        >
          {!canShare ? (
            <div className="px-4 py-5 text-center">
              <p className="text-[13px] leading-5 text-(--text-muted)">
                Log in to send this post to a friend.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal()}
                className="mt-3 h-8 w-full cursor-pointer rounded-lg bg-[#fe2c55] text-[13px] font-medium text-white transition hover:bg-[#ff4772]"
              >
                Log in
              </button>
            </div>
          ) : (
            <>
              <div className="p-3 pb-1.5">
                <label className="flex items-center gap-2 rounded-lg bg-(--field-bg) px-2.5 py-1.5">
                  <FiSearch aria-hidden="true" className="shrink-0 text-(--text-faint)" />
                  <input
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    placeholder="Search"
                    aria-label="Search friends"
                    className="min-w-0 flex-1 bg-transparent text-[13px] leading-5 text-(--text-strong) outline-none placeholder:text-(--text-faint)"
                  />
                </label>
              </div>

              <p className="px-3 py-1 text-[12px] leading-4 text-(--text-faint)">Share with friends</p>

              <div className="max-h-70 overflow-y-auto">
                {loading ? (
                  <p className="px-3 py-6 text-center text-[13px] text-(--text-faint)">Loading…</p>
            ) : error ? (
              <div className="px-3 py-5 text-center">
                <p className="text-[13px] text-(--text-muted)">{error}</p>
                <button
                  type="button"
                  onClick={retry}
                  className="mt-2 cursor-pointer text-[13px] font-medium text-[#fe2c55]"
                >
                  Try again
                </button>
              </div>
            ) : !recipients.length ? (
              <p className="px-3 py-6 text-center text-[13px] text-(--text-faint)">
                {keyword ? 'No one matches that name.' : 'Follow someone to share with them.'}
              </p>
            ) : (
              <ul>
                {recipients.map(recipient => (
                  <ShareRecipientRow
                    key={recipient._id}
                    recipient={recipient}
                    status={rows[recipient._id]?.status || 'idle'}
                    error={rows[recipient._id]?.error}
                    onShare={share}
                  />
                ))}
              </ul>
            )}

                {!loading && !error && recipients.length ? (
              hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="w-full cursor-pointer py-2 text-center text-[12px] text-(--text-faint) hover:text-(--text-muted) disabled:cursor-wait"
                >
                  {loadingMore ? 'Loading…' : 'Show more'}
                </button>
              ) : (
                <p className="py-2 text-center text-[12px] text-(--text-faint)">No more for now</p>
              )
            ) : null}
              </div>

            </>
          )}

          <div className="flex items-center gap-2 border-t border-(--border-faint) p-3">
            <button
              type="button"
              onClick={copyLink}
              className="flex h-8 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-(--field-bg) text-[13px] text-(--text-strong) transition hover:bg-(--surface-hover)"
            >
              <FiLink aria-hidden="true" />
              {copied ? 'Link copied' : 'Copy the link'}
            </button>

            {/*
              Not implemented yet, and deliberately inert rather than absent: the
              row is part of the design, and a control that silently does nothing
              — or worse, reports success — is the thing to avoid. They are
              disabled, so they cannot share, cannot create a message, and cannot
              move the counter.
            */}
            {[
              { icon: <FiDownload aria-hidden="true" />, label: 'Download' },
              { icon: <FiGrid aria-hidden="true" />, label: 'QR code' },
              { icon: <FiAlertTriangle aria-hidden="true" />, label: 'Report' }
            ].map(action => (
              <button
                key={action.label}
                type="button"
                disabled
                title={`${action.label} — coming soon`}
                aria-label={`${action.label} — coming soon`}
                className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg bg-(--field-bg) text-(--text-faint) opacity-60"
              >
                {action.icon}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
