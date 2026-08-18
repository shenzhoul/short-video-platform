import { Injectable } from '@nestjs/common';
import { ExecutionContext } from '@nestjs/common';
import { I18nResolver } from 'nestjs-i18n';

@Injectable()
export class UserLangResolver implements I18nResolver {
  async resolve(context: ExecutionContext): Promise<string | undefined> {
    const request = context.switchToHttp().getRequest();
    const user = request.user; // Assumes user is set by auth guard
    return user?.language;
  }
}
