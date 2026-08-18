import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

export class UsernameTakenException extends HttpException {
  constructor() {
    super(__t('errors.username_taken'), 400);
  }
}
