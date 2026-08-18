'use client';

import Modal from '@components/ui/modal';
import NoData from '@components/ui/no-data';
import { useFollowList } from '@hooks/use-follow-list';
import { useProfile } from '@providers/profile.provider';
import { useEffect, useRef, useState } from 'react';
import { AiOutlineShareAlt } from 'react-icons/ai';
import { FiCopy } from 'react-icons/fi';

interface SharePanelProps {
  open: boolean;
  onClose: () => void;
  /** Absolute link to the content being shared. */
  shareUrl: string;
  shareTitle?: string;
  shareMessage?: string;
  /**
   * Called once the user has actually completed a share. Opening the panel, or
   * pressing a control that does nothing, must not call this — the share
   * statistic is meant to count real shares.
   */
  onShared: () => void;
}

/**
 * The application's own share surface.
 *
 * Rendered in the shared `Modal` primitive rather than a bespoke popover so the
 * panel cannot be clipped by the post detail overlay it is opened from, and so
 * focus handling, the backdrop and escape-to-close come from one place.
 *
 * The people list is real — it reuses the viewer's following relationships — but
 * sending to a person is deliberately inert: there is no messaging backend, and
 * a button that silently did nothing, or claimed success, would be worse than
 * one that is visibly unavailable.
 */
export default function SharePanel({
  open, onClose, shareUrl, shareTitle, shareMessage, onShared
}: SharePanelProps) {
  const { current } = useProfile();
  const [keyword, setKeyword] = useState('');
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const {
    users, loading, hasMore, loadMore
  } = useFollowList({
    userId: current?._id,
    type: 'following',
    // Nothing is fetched until the panel is actually open.
    enabled: open,
    keyword
  });

  useEffect(() => {
    if (!open) {
      setKeyword('');
      setCopied(false);
    }
  }, [open]);

  const copyLink = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(shareUrl);
      } else {
        const field = document.createElement('textarea');
        field.value = shareUrl;
        field.setAttribute('readonly', '');
        field.style.position = 'absolute';
        field.style.left = '-9999px';
        document.body.appendChild(field);
        field.select();
        document.execCommand('copy');
        document.body.removeChild(field);
      }
      setCopied(true);
      // Only a completed copy counts as a share.
      onShared();
    } catch {
      setCopied(false);
    }
  };

  const nativeShare = async () => {
    if (!navigator.share) return;
    try {
      await navigator.share({ title: shareTitle, text: shareMessage, url: shareUrl });
      // Resolves only when the platform reports the share went through; a
      // cancelled share rejects and is intentionally not counted.
      onShared();
      onClose();
    } catch {
      // Cancelled or unsupported — leave the panel open and count nothing.
    }
  };

  const handleScroll = () => {
    const element = listRef.current;
    if (!element || loading || !hasMore) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 80) loadMore();
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="Share to"
      footer={null}
      width={420}
      noPadding
    >
      <div className="flex flex-col">
        <div className="px-4 pt-3">
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="Search"
            className="w-full rounded-lg bg-(--field-bg) px-3 py-2 text-[14px] leading-5 text-(--text-strong) outline-none placeholder:text-(--text-muted)"
          />
        </div>

        <div className="px-4 pt-3 pb-1 text-[13px] leading-4 text-(--text-muted)">
          Share with people you follow
        </div>

        <div
          ref={listRef}
          onScroll={handleScroll}
          className="max-h-64 min-h-24 overflow-y-auto overscroll-contain px-2"
        >
          {users.length === 0 && !loading ? (
            <NoData
              title="No one to show"
              description={keyword ? 'No match in the people you follow.' : 'Follow someone to see them here.'}
              className="py-6"
            />
          ) : (
            users.map((user) => (
              <div key={user._id} className="flex items-center gap-3 rounded-lg px-2 py-2">
                <img
                  src={user.avatar || '/no_avatar.jpeg'}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-[14px] leading-5 text-(--text-strong)">
                  {user.name || user.username}
                </span>
                {/*
                  Disabled until direct messages exist. Sending has no backend,
                  so this must not report success or record a share.
                */}
                <button
                  type="button"
                  disabled
                  title="Sending to a person needs direct messages, which are not available yet"
                  className="shrink-0 cursor-not-allowed rounded-lg bg-(--btn-bg) px-3 py-1 text-[13px] leading-5 text-(--text-muted) opacity-60"
                >
                  Share
                </button>
              </div>
            ))
          )}
          {loading ? (
            <div className="px-2 py-3 text-[13px] leading-5 text-(--text-muted)">Loading…</div>
          ) : null}
        </div>

        <div className="mt-1 flex items-center gap-2 border-t border-(--border-faint) px-4 py-3">
          <button
            type="button"
            onClick={copyLink}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-(--btn-bg) px-3 py-2 text-[14px] leading-5 text-(--text-strong) transition hover:bg-(--btn-bg-hover)"
          >
            <FiCopy />
            {copied ? 'Link copied' : 'Copy link'}
          </button>
          {typeof navigator !== 'undefined' && navigator.share ? (
            <button
              type="button"
              onClick={nativeShare}
              title="Share using another app"
              className="flex items-center justify-center gap-2 rounded-lg bg-(--btn-bg) px-3 py-2 text-[14px] leading-5 text-(--text-strong) transition hover:bg-(--btn-bg-hover)"
            >
              <AiOutlineShareAlt />
              More
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
