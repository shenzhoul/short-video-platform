'use client';

import type { ShareRecipient } from '@hooks/use-share-recipients';

/** Where one recipient's share stands. */
export type ShareRowStatus = 'idle' | 'sharing' | 'sent' | 'failed';

interface ShareRecipientRowProps {
  recipient: ShareRecipient;
  status: ShareRowStatus;
  error?: string | null;
  onShare: (recipient: ShareRecipient) => void;
}

const FALLBACK_AVATAR = '/no-avatar.png';

/**
 * One person in the share list.
 *
 * The button reports its own outcome rather than raising a toast: several
 * shares can be in flight from one popover, and a stack of toasts would not say
 * which recipient each one belonged to. It stays disabled after success so the
 * same post is not sent twice by a second click on a row that already worked.
 */
export default function ShareRecipientRow({
  recipient,
  status,
  error,
  onShare
}: ShareRecipientRowProps) {
  const name = recipient.name || recipient.username || 'Unknown';
  const secondary = recipient.username && recipient.name ? `@${recipient.username}` : null;
  const busy = status === 'sharing';
  const done = status === 'sent';

  const label = (() => {
    if (busy) return 'Sharing…';
    if (done) return 'Sent';
    if (status === 'failed') return 'Retry';
    return 'Share';
  })();

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <img
        src={recipient.avatar || FALLBACK_AVATAR}
        alt=""
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />

      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] leading-5 text-(--text-strong)">{name}</p>
        {/* The failure replaces the handle: it is the more useful of the two
            once something has gone wrong, and stacking both crowds the row. */}
        {status === 'failed' && error ? (
          <p className="truncate text-[12px] leading-4 text-[#fe2c55]">{error}</p>
        ) : secondary ? (
          <p className="truncate text-[12px] leading-4 text-(--text-faint)">{secondary}</p>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => onShare(recipient)}
        disabled={busy || done}
        aria-label={`Share with ${name}`}
        className={`h-7 shrink-0 rounded-md px-3.5 text-[13px] font-medium transition ${
          done
            ? 'cursor-default bg-(--btn-bg) text-(--text-faint)'
            : 'cursor-pointer bg-[#fe2c55] text-white hover:bg-[#e02950] disabled:cursor-wait disabled:opacity-70'
        }`}
      >
        {label}
      </button>
    </li>
  );
}
