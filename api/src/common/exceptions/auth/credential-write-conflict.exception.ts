import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * A credential could not be written.
 *
 * Raised when the atomic upsert in `AuthService.createAuthPassword` fails for a
 * reason that is not an idempotent re-insert of the same logical credential —
 * a collision on a different index, a write concern failure, a storage error.
 *
 * It exists so that none of those reach the client as a raw MongoDB error. A
 * driver message names the database, the collection and the index, and arrives
 * as a 500 that says nothing actionable; this says the request failed and can
 * be retried, and leaves the detail in the log where it belongs.
 */
export class CredentialWriteConflictException extends HttpException {
  constructor() {
    super(__t('errors.credential_write_failed'), 409);
  }
}
