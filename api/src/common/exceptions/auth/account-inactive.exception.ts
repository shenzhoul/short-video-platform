import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

export class AccountInactiveException extends HttpException {
  constructor() {
    super(__t('errors.account_inactive'), 400);
  }
}
