'use client';

import { useMessages } from '@providers/message.provider';
import { useMessageWorkspace } from '@providers/message-workspace.provider';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useState } from 'react';

interface ProfileMessageButtonProps {
  /** Creator whose profile this is. */
  creatorId?: string;
  className?: string;
}

/**
 * "Message" action on another creator's profile.
 *
 * Unlike the header and post-detail entry points, this one knows *who* the user
 * wants to talk to, so it resolves the canonical conversation first and opens
 * the workspace straight into that thread rather than onto the list.
 *
 * It uses the same shared workspace as every other entry point — nothing is
 * mounted here — and the same get-or-create endpoint, so the pair's single
 * canonical conversation is reused rather than duplicated.
 *
 * The profile only renders this for other people's profiles, so self-messaging
 * cannot be reached from here; a signed-out visitor is sent to sign in, because
 * every conversation is private.
 */
export default function ProfileMessageButton({
  creatorId,
  className = ''
}: ProfileMessageButtonProps) {
  const { status } = useSession();
  const router = useRouter();
  const { openConversationWith } = useMessages();
  const { openWorkspace } = useMessageWorkspace();
  const [opening, setOpening] = useState(false);

  const handleClick = async () => {
    if (!creatorId || opening) return;

    if (status !== 'authenticated') {
      router.push('/auth/login');
      return;
    }

    setOpening(true);
    try {
      const conversation = await openConversationWith(creatorId);
      // Only open the workspace once there is a thread to show. Opening it on
      // failure would land the user on an empty list with no explanation of
      // what happened to the person they clicked.
      if (conversation?._id) openWorkspace(conversation._id);
    } finally {
      setOpening(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={opening}
      aria-label="Message this creator"
      className={className}
    >
      <span className="flex items-center">Message</span>
    </button>
  );
}
