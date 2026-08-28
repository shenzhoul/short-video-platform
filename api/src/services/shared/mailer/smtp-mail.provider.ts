import { Injectable, Logger } from '@nestjs/common';
import { createTransport, Transporter } from 'nodemailer';
import { MailMessage, MailProvider } from 'src/common/interfaces/mailer';

import { MailConfigService } from './mail-config.service';

/**
 * Real delivery over SMTP.
 *
 * ## One transport, not one per message
 *
 * `createTransport` opens a connection pool. Building a fresh transport for
 * every message throws that pool away each time and pays a full TLS handshake
 * per email — and against Gmail, a burst of new connections is exactly the
 * pattern that trips its abuse heuristics. The transport is created lazily on
 * first send and reused.
 *
 * ## Certificate validation stays on
 *
 * The reference implementation set `tls: { rejectUnauthorized: false }`, which
 * means any machine on the path can present its own certificate and read the
 * SMTP credentials in the clear. Gmail presents a valid certificate on 587;
 * there is no reason to disable the check and never was.
 */
@Injectable()
export class SmtpMailProvider implements MailProvider {
  public readonly kind = 'smtp';

  private readonly logger = new Logger(SmtpMailProvider.name);

  private transport: Transporter | null = null;

  constructor(private readonly mailConfig: MailConfigService) {}

  async send(message: MailMessage): Promise<void> {
    const transport = this.getTransport();

    try {
      await transport.sendMail({
        from: this.mailConfig.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text
      });
    } catch (error: any) {
      // What nodemailer says ("Invalid login: 535-5.7.8 Username and Password
      // not accepted") is a fact about our credentials, not advice for whoever
      // is waiting on the email. It goes to the log; the caller gets wording we
      // wrote. Throwing is deliberate — the queue worker above needs the failure
      // to get a retry.
      this.logger.error(`SMTP delivery failed for template message: ${error?.message}`);
      throw new Error('Mail delivery failed');
    }
  }

  private getTransport(): Transporter {
    if (this.transport) return this.transport;

    const { host, port, secure, user, pass } = this.mailConfig.smtp;

    this.transport = createTransport({
      host,
      port,
      // 465 → implicit TLS; 587 → plain connect then STARTTLS, which nodemailer
      // performs automatically and which `requireTLS` makes non-optional.
      secure,
      requireTLS: !secure,
      auth: { user, pass },
      pool: true,
      maxConnections: 2,
      // Gmail's submission endpoint is not fast. These bound a hung connection
      // so a stuck job fails and retries rather than occupying a worker slot.
      connectionTimeout: 15_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000
    });

    return this.transport;
  }
}
