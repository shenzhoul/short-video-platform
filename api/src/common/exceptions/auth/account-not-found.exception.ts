import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

export class AccountNotFoundException extends HttpException {
  constructor() {
    super(__t('errors.account_not_found'), 404);
  }
}
