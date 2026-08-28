import { Logger, Provider } from '@nestjs/common';
import { MAIL_PROVIDER, MailProvider } from 'src/common/interfaces/mailer';

import { LogMailProvider } from './log-mail.provider';
import { MailConfigService } from './mail-config.service';
import { SmtpMailProvider } from './smtp-mail.provider';

/**
 * Chooses the transport once, from validated configuration.
 *
 * Both implementations are constructed **here**, not registered as Nest
 * providers, so exactly one of them is ever instantiated. That is a property
 * worth having rather than a stylistic choice: it means a test suite can assert
 * that no SMTP transport object exists in the process at all, and it removes any
 * path by which the SMTP provider could be injected somewhere by accident.
 *
 * `MailConfigService.onModuleInit` has already refused to boot on an invalid
 * combination — including `MAIL_PROVIDER=log` under `NODE_ENV=production` — so
 * this cannot silently downgrade a production deployment to printing links.
 */
export const mailProviderFactory: Provider = {
  provide: MAIL_PROVIDER,
  inject: [MailConfigService],
  useFactory: (config: MailConfigService): MailProvider => {
    const provider = config.provider === 'smtp'
      ? new SmtpMailProvider(config)
      : new LogMailProvider(config);

    new Logger('MailProviderFactory').log(`Using the '${provider.kind}' mail transport`);
    return provider;
  }
};
