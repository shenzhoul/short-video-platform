import { HttpException, HttpStatus } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * Raised when an admin tries to create a category whose key already exists.
 *
 * A conflict rather than a validation error: the payload is well-formed, it just collides with a
 * record that is already there. The admin resolves it by choosing a different key — the server never
 * invents one, because the key ends up stored on every post filed under the category.
 */
export class CategoryKeyTakenException extends HttpException {
  constructor() {
    super(__t('errors.category_key_taken'), HttpStatus.CONFLICT);
  }
}
