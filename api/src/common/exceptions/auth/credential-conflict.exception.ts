import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * A credential already exists where one was being created.
 *
 * Raised by `createAuthPassword` when the logical key is already taken and the
 * requested password is *not* the one already stored.
 *
 * The distinction matters because the alternative is a false success. An upsert
 * that `$set`s unconditionally lets two concurrent creates both report success
 * while only one password survives — so one caller is told their password was
 * saved when the account will not accept it. A 409 is the honest answer: the
 * credential was not created, and the caller can decide whether to retry as a
 * replacement.
 *
 * When the requested password *does* match what is stored, no exception is
 * raised: the caller asked for a state that already holds, which is idempotent
 * rather than conflicting.
 */
export class CredentialAlreadyExistsException extends HttpException {
  constructor() {
    super(__t('errors.credential_already_exists'), 409);
  }
}

/**
 * A credential was being replaced but there is none to replace.
 *
 * Password *change* must never quietly become password *creation*. An account
 * with no credential is a different situation from one whose password is being
 * updated — it has never had a password at all — and a caller that wants to set
 * a first password must say so by calling `createAuthPassword`, not by having a
 * replace silently upsert one.
 */
export class CredentialNotFoundException extends HttpException {
  constructor() {
    super(__t('errors.credential_not_found'), 404);
  }
}
