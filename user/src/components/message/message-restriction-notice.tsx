'use client';

import type { AwaitingReplyFrom, MessageRequestState } from '@interfaces/message';

interface MessageRestrictionNoticeProps {
  requestState: MessageRequestState | null;
  awaitingReplyFrom: AwaitingReplyFrom;
}

/**
 * Explains the message-request rule inside the thread.
 *
 * Sits directly above the composer, since it describes what that composer will
 * accept. It is phrased as context rather than as a validation error, and the
 * composer stays in place and disabled underneath it — there is never a second
 * notice down there.
 *
 * The condition is the server's `requestState`, not the follow relation. Those
 * are not the same thing: once a request has been answered both people may
 * message freely even though they still do not follow each other, and a notice
 * keyed on `isMutualFollow` alone stayed on screen forever describing a rule
 * that no longer applied. Only the two restricted states say anything.
 */
export default function MessageRestrictionNotice({
  requestState,
  awaitingReplyFrom
}: MessageRestrictionNoticeProps) {
  const restricted = requestState === 'idle' || requestState === 'waiting';
  if (!restricted) return null;

  const text = awaitingReplyFrom === 'me'
    ? 'You can only send one message until they reply or follow you back.'
    : 'Until you follow each other, you can each send one message at a time.';

  return (
    <div className="shrink-0 px-6 py-3 text-center text-[12px] leading-4 text-(--text-faint)">
      {text}
      Please speak politely and consciously abide by <span className="text-[#face15]">the Douyin Self-Discipline Convention</span>
    </div>
  );
}
