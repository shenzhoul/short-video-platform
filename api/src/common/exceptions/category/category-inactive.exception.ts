import { HttpException, HttpStatus } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * Raised when a post request names a category that exists but is disabled.
 *
 * Distinct from "not found" on purpose: the client asked for something real that is no longer
 * offered, which is a different thing to tell a creator than "that category does not exist".
 */
export class CategoryInactiveException extends HttpException {
  constructor() {
    super(__t('errors.category_inactive'), HttpStatus.BAD_REQUEST);
  }
}
