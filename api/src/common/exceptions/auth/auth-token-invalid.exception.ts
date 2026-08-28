import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * A presented verification token did not resolve to a usable token.
 *
 * Deliberately **one** exception for four distinct causes — unknown, expired,
 * superseded by a newer link, already used. Telling them apart would let
 * somebody probing token values learn which of their guesses had ever existed,
 * and none of the four changes what the person holding the link should do next:
 * ask for a new one.
 *
 * The `error` code is what the client matches on. The `message` is for a human
 * and may be translated or reworded; a client that pattern-matches message text
 * breaks the first time somebody improves the copy.
 */
export class VerificationTokenInvalidException extends HttpException {
  constructor() {
    super({
      statusCode: 400,
      message: __t('errors.verification_token_invalid'),
      error: 'VERIFICATION_TOKEN_INVALID'
    }, 400);
  }
}

/** The password-reset counterpart. Same reasoning, its own code. */
export class ResetTokenInvalidException extends HttpException {
  constructor() {
    super({
      statusCode: 400,
      message: __t('errors.reset_token_invalid'),
      error: 'RESET_TOKEN_INVALID'
    }, 400);
  }
}

/**
 * The token was valid and was claimed, but the mutation it authorised could not
 * be completed.
 *
 * Distinct from the invalid-token cases on purpose: nothing the user did is
 * wrong, the claim has been released, and retrying the same link is the correct
 * advice. Reporting this as an invalid token would send them to request a new
 * one for no reason.
 */
export class AuthTokenConsumeFailedException extends HttpException {
  constructor() {
    super({
      statusCode: 500,
      message: __t('errors.auth_token_consume_failed'),
      error: 'AUTH_TOKEN_CONSUME_FAILED'
    }, 500);
  }
}
