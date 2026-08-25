/**
 * Turns an API refusal into something a person can act on.
 *
 * The server sends a machine code alongside its message precisely so the client
 * does not have to match on display text — that text is translated and expected
 * to change. Codes are matched first; the server's own message is the fallback,
 * and a generic line is the last resort so a failure never renders as blank.
 */

export type ShareErrorCode =
  | 'MESSAGE_REQUEST_PENDING'
  | 'RECIPIENT_RESTRICTED'
  | 'USER_BLOCKED'
  | 'POST_NOT_ACCESSIBLE'
  | 'POST_DELETED'
  | 'DUPLICATE_SHARE';

const MESSAGES: Record<ShareErrorCode, string> = {
  // Resolves itself when the other person answers, so the wording says to wait
  // rather than suggesting anything is wrong.
  MESSAGE_REQUEST_PENDING: 'You can send one message until they reply.',
  // Restricted and blocked read identically on purpose: telling somebody which
  // one happened tells them they were singled out, which is what a quiet
  // control exists to avoid.
  RECIPIENT_RESTRICTED: 'You cannot send messages to this account.',
  USER_BLOCKED: 'You cannot send messages to this account.',
  POST_NOT_ACCESSIBLE: 'This post cannot be shared with this person.',
  POST_DELETED: 'This post is no longer available.',
  DUPLICATE_SHARE: 'Already shared.'
};

/** The API's code for this failure, wherever the transport happened to put it. */
export function readErrorCode(error: any): ShareErrorCode | null {
  const code = error?.details?.error || error?.error || error?.data?.error;
  return code && code in MESSAGES ? code as ShareErrorCode : null;
}

/** A duplicate is the same share arriving twice — the user's intent succeeded. */
export function isDuplicateShare(error: any): boolean {
  return readErrorCode(error) === 'DUPLICATE_SHARE'
    || error?.statusCode === 409
    || error?.status === 409;
}

export function resolveShareError(error: any): string {
  const code = readErrorCode(error);
  if (code) return MESSAGES[code];

  return error?.details?.message
    || error?.message
    || error?.data?.message
    || 'Could not share this post.';
}
