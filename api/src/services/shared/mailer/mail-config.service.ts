import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MailerConfig, MailProviderKind } from 'src/config/mailer';

/**
 * Validates the mail configuration once, at boot, and refuses to start when it
 * is wrong.
 *
 * ## Why boot and not send time
 *
 * The reference implementation this replaces validated inside the transport
 * factory, which runs inside a queue worker whose handler caught everything and
 * only logged. The result was the worst possible failure shape: an application
 * that starts cleanly, reports every job complete, and silently delivers no mail
 * at all. Nobody notices until a user says they never got the link.
 *
 * Failing at boot converts that into the one thing an operator cannot miss — the
 * process does not come up, and the message names the variable.
 *
 * ## Why there is no fallback to `log`
 *
 * A production process that cannot reach SMTP must not quietly start printing
 * verification links to stdout instead. That is a silent downgrade from
 * "delivers mail" to "delivers nothing, and writes credentials-adjacent URLs
 * into the log aggregator". `MAIL_PROVIDER=log` in production is refused for the
 * same reason.
 */
@Injectable()
export class MailConfigService implements OnModuleInit {
  private readonly logger = new Logger(MailConfigService.name);

  private readonly config: MailerConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get<MailerConfig>('mailer');
  }

  onModuleInit(): void {
    this.validate();
    this.logger.log(
      `Mail provider: ${this.provider}; links built from ${this.config.userAppUrl}`
    );
  }

  get provider(): MailProviderKind {
    return this.config.provider;
  }

  get smtp() {
    return this.config.smtp;
  }

  get userAppUrl(): string {
    return this.config.userAppUrl;
  }

  get tokenTtlMinutes() {
    return this.config.tokenTtlMinutes;
  }

  /**
   * The `From` header value.
   *
   * A display name is not decoration: a bare `no-reply@gmail.com` from an
   * unfamiliar address is markedly more likely to be filed as spam than the same
   * address with a product name in front of it. The name is quoted and stripped
   * of the two characters that would let it break the header apart.
   */
  get from(): string {
    const { name, address } = this.config.from;
    if (!name) return address;
    const safeName = name.replace(/["\\\r\n]/g, '').trim();
    return safeName ? `"${safeName}" <${address}>` : address;
  }

  /**
   * Build an absolute link into the user web app.
   *
   * `new URL` rather than string concatenation, and `URLSearchParams` rather
   * than manual encoding, so a token containing a `+` or `/` survives the round
   * trip. `base64url` avoids both, but relying on that is relying on a detail of
   * the encoder rather than on the URL rules.
   */
  buildUserAppUrl(path: string, params: Record<string, string> = {}): string {
    const url = new URL(path, this.ensureTrailingSlash(this.config.userAppUrl));
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.href;
  }

  /**
   * Redact a link for logging.
   *
   * The `log` provider prints what it would have sent, which is what makes local
   * development possible without Gmail — but it must not put a live token into a
   * log file, so the query string is replaced wholesale rather than trimmed.
   */
  static redactUrl(value: string): string {
    try {
      const url = new URL(value);
      return url.search ? `${url.origin}${url.pathname}?<redacted>` : url.href;
    } catch {
      return '<unparseable-url>';
    }
  }

  private ensureTrailingSlash(value: string): string {
    return value.endsWith('/') ? value : `${value}/`;
  }

  private validate(): void {
    const problems: string[] = [];
    const isProduction = process.env.NODE_ENV === 'production';
    const { provider, smtp, from, userAppUrl, tokenTtlMinutes } = this.config;

    if (provider !== 'smtp' && provider !== 'log') {
      problems.push(`MAIL_PROVIDER must be 'smtp' or 'log' (received '${provider}')`);
    }

    if (isProduction && provider !== 'smtp') {
      problems.push(
        "MAIL_PROVIDER must be 'smtp' in production — the log provider writes links to stdout and delivers nothing"
      );
    }

    // Required in every environment: it is what every emailed link is built
    // from, and a link built from a request header is host-header injection.
    if (!userAppUrl) {
      problems.push('USER_APP_URL is required (the canonical origin of the user web app)');
    } else if (!/^https?:\/\/[^\s]+$/i.test(userAppUrl)) {
      problems.push(`USER_APP_URL must be an absolute http(s) URL (received '${userAppUrl}')`);
    } else if (isProduction && userAppUrl.startsWith('http://')) {
      problems.push('USER_APP_URL must use https in production — verification and reset links must not travel over plaintext');
    }

    if (provider === 'smtp') {
      if (!smtp.host) problems.push('SMTP_HOST is required when MAIL_PROVIDER=smtp');
      if (!Number.isInteger(smtp.port) || smtp.port <= 0 || smtp.port > 65535) {
        problems.push(`SMTP_PORT must be a valid port number (received '${process.env.SMTP_PORT}')`);
      }
      if (!smtp.user) problems.push('SMTP_USER is required when MAIL_PROVIDER=smtp');
      if (!smtp.pass) problems.push('SMTP_PASS is required when MAIL_PROVIDER=smtp');
      if (!from.address) problems.push('MAIL_FROM_ADDRESS is required when MAIL_PROVIDER=smtp');
      // 465 is implicit TLS and 587 is STARTTLS. Getting these the wrong way
      // round produces a connection that hangs rather than an error, which is a
      // miserable thing to debug at 2am.
      if (smtp.port === 465 && !smtp.secure) {
        problems.push('SMTP_PORT=465 requires SMTP_SECURE=true (implicit TLS)');
      }
      if (smtp.port === 587 && smtp.secure) {
        problems.push('SMTP_PORT=587 requires SMTP_SECURE=false (STARTTLS is negotiated after connecting)');
      }
    }

    if (tokenTtlMinutes.emailVerification <= 0) {
      problems.push('EMAIL_VERIFICATION_TOKEN_TTL_MINUTES must be greater than zero');
    }
    if (tokenTtlMinutes.passwordReset <= 0) {
      problems.push('PASSWORD_RESET_TOKEN_TTL_MINUTES must be greater than zero');
    }

    if (problems.length) {
      // No values are echoed except the ones that are safe to echo. The password
      // is only ever reported as present or absent.
      throw new Error(
        `Invalid mail configuration:\n  - ${problems.join('\n  - ')}\n`
        + 'See api/.env.example and docs/features/email-verification-and-password-reset.md'
      );
    }
  }
}
