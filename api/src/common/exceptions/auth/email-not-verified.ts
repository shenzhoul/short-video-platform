import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

export class EmailNotVerifiedException extends HttpException {
  constructor() {
    super(__t('errors.email_not_verified'), 400);
  }
}
