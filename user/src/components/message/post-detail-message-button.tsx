'use client';

import { useMessageWorkspace } from '@providers/message-workspace.provider';
import { useSession } from 'next-auth/react';
import { MessageIcon } from 'src/icons';

/**
 * Message action in the post detail overlay's top bar.
 *
 * Toggles the same workspace every other entry point uses — it mounts nothing of
 * its own and keeps no local open state. Unlike the profile button it names no
 * conversation, so it simply shows and hides the panel; clicking it a second
 * time closes what the first click opened.
 *
 * Styled for the overlay's dark chrome rather than the page tokens: it sits on
 * video, where the themed surface colours would disappear.
 */
export default function PostDetailMessageButton() {
  const { status } = useSession();
  const { open, toggleWorkspace } = useMessageWorkspace();

  if (status !== 'authenticated') return null;

  return (
    <button
      type="button"
      onClick={toggleWorkspace}
      aria-expanded={open}
      aria-label="Open messages"
      className="pointer-events-auto flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-white/20 bg-black/25 px-3 text-[13px] font-medium text-white/85 backdrop-blur-md transition hover:bg-white/15 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      <MessageIcon className="text-[17px]" />
      <span>Messages</span>
    </button>
  );
}
