import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

export class AuthErrorException extends HttpException {
  constructor() {
    super(__t('errors.cannot_authenticate'), 400);
  }
}
