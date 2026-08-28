/**
 * One rendered message, ready to hand to a transport.
 *
 * There is no `template` field and no `data` field on purpose. Rendering happens
 * before a message reaches a provider, so a provider cannot be asked to look a
 * template up, and a queue payload never carries the variables that produced the
 * body — which is what keeps a raw token out of Redis.
 */
export interface MailMessage {
  /** A single recipient. Bulk send is not a capability this system has. */
  to: string;
  subject: string;
  html: string;
  /**
   * Required, not optional. A message with no plain-text alternative scores
   * worse with every spam filter that exists, and a text part costs one template
   * function to produce.
   */
  text: string;
}

/**
 * The whole transport contract.
 *
 * Two implementations: `SmtpMailProvider` for real delivery and `LogMailProvider`
 * for local development and tests. A test injects a fake rather than reaching
 * for either.
 *
 * `send` **throws** on failure. The queue worker above it relies on that to get
 * a BullMQ retry — a provider that swallows its own errors turns a dead SMTP
 * host into a perfectly healthy-looking application that silently delivers
 * nothing.
 */
export interface MailProvider {
  /** Identifies the implementation in logs and in the boot banner. */
  readonly kind: string;

  send(message: MailMessage): Promise<void>;
}

/** DI token. `MailProvider` is an interface, so it cannot be one itself. */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');
