import { HttpStatus } from '@nestjs/common';
import { RuntimeException } from 'src/kernel';
import { __t } from 'src/utils/translation';

/**
 * The same post was shared with the same person twice in quick succession.
 *
 * A conflict rather than an error: the user's intent already succeeded, so the
 * client should show the recipient as shared rather than surfacing a failure.
 * The distinct code exists so it can tell the two apart.
 */
export class DuplicateShareException extends RuntimeException {
  constructor(msg: string | object = __t('errors.message_share_duplicate'), error = 'DUPLICATE_SHARE') {
    super(msg, error, HttpStatus.CONFLICT);
  }
}
