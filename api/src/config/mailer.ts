/**
 * Mail configuration.
 *
 * Read from the environment and nowhere else. There is deliberately no
 * settings-backed override: an SMTP password in Mongo is the same secret stored
 * in two more places (the collection, and the admin form that edits it) for no
 * benefit on a single-tenant deployment. See `docs/features/email-verification-and-password-reset.md`.
 *
 * Nothing here is validated at import time — a module that throws while being
 * loaded produces a stack trace instead of a message. `MailConfigService`
 * validates on boot and refuses to start with a sentence naming the missing
 * variable.
 */

/** How mail leaves the process. */
export type MailProviderKind = 'smtp' | 'log';

export interface MailerConfig {
  provider: MailProviderKind;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user: string;
    pass: string;
  };
  from: {
    name: string;
    address: string;
  };
  /**
   * The canonical origin of the user web app, and the only base every emailed
   * link is built from.
   *
   * Never derived from a request. `Host`, `Origin` and `X-Forwarded-Host` are
   * all attacker-controlled, and a password-reset link built from one of them is
   * a credential-harvesting link on somebody else's domain.
   */
  userAppUrl: string;
  tokenTtlMinutes: {
    emailVerification: number;
    passwordReset: number;
  };
}

function toInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default (): MailerConfig => ({
  provider: (process.env.MAIL_PROVIDER || 'log') as MailProviderKind,
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: toInt(process.env.SMTP_PORT, 587),
    // Implicit TLS is 465 only. 587 is STARTTLS, which nodemailer upgrades to
    // on its own with `secure: false` — that is not "insecure", it is the
    // correct setting for the submission port.
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  },
  from: {
    name: process.env.MAIL_FROM_NAME || '',
    address: process.env.MAIL_FROM_ADDRESS || ''
  },
  userAppUrl: process.env.USER_APP_URL || '',
  tokenTtlMinutes: {
    emailVerification: toInt(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES, 24 * 60),
    passwordReset: toInt(process.env.PASSWORD_RESET_TOKEN_TTL_MINUTES, 60)
  }
});
