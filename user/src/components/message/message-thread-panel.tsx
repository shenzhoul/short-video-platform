'use client';

import { useMessageThread } from '@hooks/use-message-thread';
import { useMessages } from '@providers/message.provider';

import MessageComposer from './message-composer';
import MessageRestrictionNotice from './message-restriction-notice';
import MessageThreadView from './message-thread-view';

interface MessageThreadPanelProps {
  conversationId: string;
  /** Rendered above the history — back button, name, close, page link. */
  header?: React.ReactNode;
}

/**
 * A complete conversation: notice, history and composer.
 *
 * The one place a thread is assembled. The compact sidebar and the full page
 * both render this and supply their own header, which is the only part that
 * genuinely differs between them — everything below the header is identical, so
 * duplicating it would only create two things to keep in sync.
 */
export default function MessageThreadPanel({
  conversationId,
  header
}: MessageThreadPanelProps) {
  const { getConversation } = useMessages();
  const conversation = getConversation(conversationId);
  const thread = useMessageThread(conversationId);

  return (
    // A container, so the thread and composer inside can size themselves to the
    // surface they landed in — the 360px panel or the wide page — instead of
    // taking a prop that says which one it is.
    <div className="@container flex h-full min-h-0 flex-col">
      {header}

      <MessageThreadView conversation={conversation} thread={thread} />

      {/*
        Directly above the composer, because it explains what the composer will
        and will not accept. At the top of the history it scrolled away from the
        control it describes, and the composer grew its own copy to compensate.
      */}
      <MessageRestrictionNotice
        requestState={thread.requestState}
        awaitingReplyFrom={thread.awaitingReplyFrom}
      />

      <MessageComposer
        canSend={thread.canSend}
        sending={thread.sending}
        awaitingReplyFrom={thread.awaitingReplyFrom}
        onSend={thread.send}
      />
    </div>
  );
}
