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
/**
 * What to say, if anything, for each state.
 *
 * `blocked` and `restricted` read the same on purpose. A restricted person must
 * not be able to tell that they were singled out — if the two states said
 * different things, the wording would be the confirmation.
 */
function resolveNotice(
  requestState: MessageRequestState | null,
  awaitingReplyFrom: AwaitingReplyFrom
): string | null {
  if (requestState === 'blocked' || requestState === 'restricted') {
    return 'You cannot send messages in this conversation.';
  }
  if (requestState === 'waiting') {
    return awaitingReplyFrom === 'me'
      ? 'You can only send one message until they reply or follow you back.'
      : 'Until you follow each other, you can each send one message at a time.';
  }
  if (requestState === 'idle') {
    return 'Until you follow each other, you can each send one message at a time.';
  }
  // `mutual` and `accepted` are unrestricted, and a null state means the
  // conversation is not loaded yet — neither has a rule to explain.
  return null;
}

export default function MessageRestrictionNotice({
  requestState,
  awaitingReplyFrom
}: MessageRestrictionNoticeProps) {
  const text = resolveNotice(requestState, awaitingReplyFrom);
  if (!text) return null;

  return (
    <div className="shrink-0 space-y-1 px-6 py-3 text-center text-[12px] leading-4 text-(--text-faint)">
      <p>{text}
        {' '}
        Please speak politely and consciously abide by
        {' '}
        <span className="text-[#face15]">the Douyin Self-Discipline Convention</span>
      </p>
    </div>
  );
}
