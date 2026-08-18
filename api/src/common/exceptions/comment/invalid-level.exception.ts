import { HttpStatus } from '@nestjs/common';
import { RuntimeException } from 'src/kernel';
import { __t } from 'src/utils/translation';

export class InvalidCommentLevelException extends RuntimeException {
  constructor(msg: string | object = __t('errors.invalid_comment_level'), error = 'INVALID_COMMENT_LEVEL') {
    super(msg, error, HttpStatus.BAD_REQUEST);
  }
}
