import { Injectable, Logger } from '@nestjs/common';
import { MailMessage, MailProvider } from 'src/common/interfaces/mailer';

import { MailConfigService } from './mail-config.service';

/**
 * Local-development transport. Prints what it would have sent and returns.
 *
 * This is what makes the whole flow developable and testable without a Gmail
 * account: `MAIL_PROVIDER=log` and every verification and reset link appears in
 * the server console.
 *
 * ## It does not print the token
 *
 * A raw token in a log file is a live credential in a log file — collected by
 * whatever ships logs, retained for whatever the retention policy is, readable
 * by anyone with log access. So the URL is redacted down to its path and the
 * token is printed **separately and only when the process is clearly a developer
 * machine**, never as part of a link that could be pasted anywhere.
 *
 * Rather than that half-measure, the rule here is simpler: the query string is
 * always redacted, and the developer gets the usable link through a dedicated
 * `MAIL_LOG_REVEAL_LINKS=true` opt-in that is refused outside development. The
 * default is redacted.
 *
 * `MailConfigService` refuses to boot with this provider under
 * `NODE_ENV=production`, so this class cannot become the production transport by
 * accident.
 */
@Injectable()
export class LogMailProvider implements MailProvider {
  public readonly kind = 'log';

  private readonly logger = new Logger(LogMailProvider.name);

  constructor(private readonly mailConfig: MailConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const link = this.extractPrimaryLink(message.text);

    this.logger.log(
      [
        'mail (not sent — MAIL_PROVIDER=log)',
        `to=${message.to}`,
        `subject=${JSON.stringify(message.subject)}`,
        `from=${this.mailConfig.from}`,
        link ? `link=${MailConfigService.redactUrl(link)}` : 'link=<none>'
      ].join(' ')
    );

    if (link && this.revealLinks()) {
      // Opt-in, development only. This is the line a developer actually clicks.
      this.logger.debug(`mail link (MAIL_LOG_REVEAL_LINKS=true): ${link}`);
    }
  }

  /**
   * Whether the full link may be printed.
   *
   * Two independent conditions, so neither one alone is enough: the environment
   * must not be production *and* the operator must have asked.
   */
  private revealLinks(): boolean {
    return process.env.NODE_ENV !== 'production' && process.env.MAIL_LOG_REVEAL_LINKS === 'true';
  }

  /**
   * Pull the first absolute URL out of the plain-text part.
   *
   * The text part is used rather than the HTML because it has no markup to
   * confuse a naive match, and every template puts the action URL in it.
   */
  private extractPrimaryLink(text: string): string | null {
    const match = text.match(/https?:\/\/\S+/);
    return match ? match[0] : null;
  }
}
