import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

export class PasswordIncorrectException extends HttpException {
  constructor() {
    super(__t('errors.password_incorrect'), 400);
  }
}
