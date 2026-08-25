'use client';

import type { IMessage } from '@interfaces/message';

interface MessageSystemNoticeProps {
  message: IMessage;
  /** The other participant, shown beside the notice. */
  avatar?: string | null;
}

/**
 * A notice the system put in the thread — today, "you follow each other now".
 *
 * Deliberately not a bubble. It is nobody's message, so it carries none of the
 * things a message carries: no incoming or outgoing side, no sender name, no
 * reply, share or reaction affordances. It sits centred in the flow of the
 * conversation at the moment it happened, which is the only thing it shares with
 * the messages around it.
 *
 * The wording arrives already translated on `text`; this component never maps an
 * event name to a sentence, so a notice it does not recognise renders nothing
 * rather than showing `mutual_follow` to somebody.
 */
export default function MessageSystemNotice({ message, avatar }: MessageSystemNoticeProps) {
  if (!message.text) return null;

  return (
    <div
      data-testid="message-system-notice"
      className="flex w-full items-center justify-center px-4 py-1"
    >
      <div className="flex max-w-[min(85%,420px)] items-center gap-2 rounded-xl bg-(--surface-muted) px-3 py-2">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            className="h-6 w-6 shrink-0 rounded-full object-cover"
          />
        ) : null}
        <p className="text-[12px] leading-4 text-(--text-muted)">{message.text}</p>
      </div>
    </div>
  );
}
