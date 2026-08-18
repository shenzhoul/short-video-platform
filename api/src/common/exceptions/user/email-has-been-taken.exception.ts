import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

export class EmailHasBeenTakenException extends HttpException {
  constructor() {
    super(__t('errors.email_taken'), 400);
  }
}
