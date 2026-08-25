'use client';

import type { IConversation } from '@interfaces/message';
import { useMessages } from '@providers/message.provider';
import { clearUserRelationship, setUserRelationship } from '@services/user.service';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FiMoreHorizontal } from 'react-icons/fi';

interface MessageThreadActionsProps {
  conversation?: IConversation;
}

/**
 * Restrict and block, from inside the conversation they apply to.
 *
 * These are the only two controls a person has over their own inbox now that
 * unfollowing no longer withdraws consent to message. That is the trade this
 * menu exists to complete: a durable "yes" needs an explicit "no" beside it,
 * otherwise the only way out of a conversation is to block someone you merely
 * wanted to stop hearing from.
 *
 * Both are the viewer's own flags, and only the viewer's own: the API never
 * reports that somebody else restricted you, so there is nothing here to show
 * for the other direction.
 *
 * The menu refetches the conversation after every change rather than guessing
 * the new permission locally — the server owns that decision, and a client that
 * predicts it will eventually predict it wrong.
 */
export default function MessageThreadActions({ conversation }: MessageThreadActionsProps) {
  const { refreshConversation } = useMessages();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const participantId = conversation?.participant?._id;
  const blocked = Boolean(conversation?.blockedByMe);
  const restricted = Boolean(conversation?.restrictedByMe);

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Closes this menu only. The workspace can sit over the post detail, which
      // closes itself on Escape from `window`; `document` bubbles first, so
      // stopping here keeps the two layers independent.
      event.stopPropagation();
      setOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const apply = useCallback(async (type: 'block' | 'restrict', enable: boolean) => {
    if (!participantId || !conversation?._id || busy) return;

    setBusy(true);
    try {
      if (enable) await setUserRelationship(participantId, type);
      else await clearUserRelationship(participantId, type);
      await refreshConversation(conversation._id);
      setOpen(false);
    } catch {
      // Nothing changed on the server, so nothing to undo here. The menu stays
      // open showing the previous state, which is the honest thing to show.
    } finally {
      setBusy(false);
    }
  }, [busy, conversation?._id, participantId, refreshConversation]);

  if (!participantId) return null;

  const items = [
    {
      key: 'restrict',
      label: restricted ? 'Unrestrict' : 'Restrict',
      // Said plainly, because "restrict" means different things on different
      // products and the consequence is what the user is choosing.
      hint: restricted ? 'Let them message you again' : 'They can no longer message you',
      run: () => apply('restrict', !restricted)
    },
    {
      key: 'block',
      label: blocked ? 'Unblock' : 'Block',
      hint: blocked ? 'Allow messages both ways' : 'Neither of you can message the other',
      run: () => apply('block', !blocked)
    }
  ];

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-expanded={open}
        aria-label="Conversation options"
        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-[18px] text-(--text-muted) transition hover:bg-(--hover-bg) hover:text-(--text-strong)"
      >
        <FiMoreHorizontal aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-100 mt-1 w-60 overflow-hidden rounded-xl border border-(--border-faint) bg-(--surface-raised) py-1 shadow-(--shadow-popover)"
        >
          {items.map(item => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={busy}
              onClick={item.run}
              className="block w-full cursor-pointer px-3 py-2 text-left transition hover:bg-(--hover-bg) disabled:cursor-wait disabled:opacity-60"
            >
              <span className="block text-[14px] leading-5 text-(--text-strong)">{item.label}</span>
              <span className="block text-[12px] leading-4 text-(--text-faint)">{item.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
