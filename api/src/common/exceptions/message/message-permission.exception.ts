import { HttpStatus } from '@nestjs/common';
import { RuntimeException } from 'src/kernel';
import { __t } from 'src/utils/translation';

/**
 * The sender has already spent their one request message.
 *
 * Its own code rather than a bare 403 so the composer can explain *why* it is
 * disabled — this is a state that resolves itself when the other person
 * answers, unlike the two below.
 */
export class MessageRequestPendingException extends RuntimeException {
  constructor(msg: string | object = __t('errors.message_awaiting_reply'), error = 'MESSAGE_REQUEST_PENDING') {
    super(msg, error, HttpStatus.FORBIDDEN);
  }
}

/**
 * The recipient has restricted the sender.
 *
 * The user-facing text is deliberately identical to the blocked case: telling
 * someone which of the two happened tells them they were singled out, which is
 * exactly what a quiet control is meant to avoid. The distinct `error` code is
 * for the client's own branching, not for display.
 */
export class MessageRecipientRestrictedException extends RuntimeException {
  constructor(msg: string | object = __t('errors.message_recipient_restricted'), error = 'RECIPIENT_RESTRICTED') {
    super(msg, error, HttpStatus.FORBIDDEN);
  }
}

/** One of the two has blocked the other; neither may send. */
export class MessageUserBlockedException extends RuntimeException {
  constructor(msg: string | object = __t('errors.message_user_blocked'), error = 'USER_BLOCKED') {
    super(msg, error, HttpStatus.FORBIDDEN);
  }
}
