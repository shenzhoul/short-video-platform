import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * The password was correct, but the account's email address has not been
 * confirmed.
 *
 * ## Why this is reached only after the password check
 *
 * "This account exists and is unverified" is information about somebody else's
 * account. It is only safe to disclose to a caller who has already proved they
 * hold the password — which is why `AuthService.login` verifies the credential
 * first and a wrong password returns the ordinary invalid-credentials error
 * instead.
 *
 * ## Why no session is issued
 *
 * The alternative — issue a token and have a guard reject every subsequent
 * request — creates a half-authenticated state, a bypass allow-list that rots,
 * and a client holding a session it cannot use. Refusing at login means there is
 * exactly one place the rule lives.
 *
 * ## The shape
 *
 * The object form, not a bare string, because the client branches on
 * `error === 'EMAIL_VERIFICATION_REQUIRED'` to switch the login dialog into its
 * "verify your email" pane. Matching on message text would break the first time
 * the copy is reworded or translated. 403 rather than 400: the credentials were
 * accepted and the request is understood; it is the account state that forbids
 * it.
 */
export class EmailNotVerifiedException extends HttpException {
  constructor() {
    super({
      statusCode: 403,
      message: __t('errors.email_not_verified'),
      error: 'EMAIL_VERIFICATION_REQUIRED'
    }, 403);
  }
}
