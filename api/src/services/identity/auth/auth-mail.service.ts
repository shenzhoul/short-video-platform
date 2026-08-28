import { Injectable, Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { AUTH_TOKEN_TYPE } from 'src/schemas/identity/auth';
import { MailConfigService, MailerService } from 'src/services/shared/mailer';
import { renderResetPassword, renderVerifyEmail } from 'src/templates/emails';

import { AuthTokenService } from './auth-token.service';

/** Public routes on the user web app that a mailed link points at. */
export const VERIFY_EMAIL_PATH = 'auth/verify-email';
export const RESET_PASSWORD_PATH = 'auth/reset-password';

export interface AuthMailRecipient {
  userId: ObjectId | string;
  /** Already normalised (trimmed, lowercased) by the caller. */
  email: string;
  /** Display name, for the greeting only. */
  name?: string;
}

/**
 * The only two transactional emails this system sends.
 *
 * Two named use cases, not one generic `send(template, data)`. That is a
 * deliberate limit on the blast radius: there is no method anywhere that takes a
 * recipient and a template name from a caller, so there is no path — and never
 * an accidental route — by which a request could aim an arbitrary message at an
 * arbitrary address. Recipients come from a user document the server looked up.
 *
 * Each method mints a token and enqueues a fully rendered message. The raw token
 * exists only between those two lines: it goes into the URL inside the body and
 * is never returned, never logged, and never stored.
 */
@Injectable()
export class AuthMailService {
  private readonly logger = new Logger(AuthMailService.name);

  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly mailerService: MailerService,
    private readonly mailConfig: MailConfigService
  ) {}

  /**
   * Issue a verification token and queue the confirmation email.
   *
   * Throws only when the token could not be written or the job could not be
   * enqueued. Every caller treats that as "the mail did not go out" rather than
   * as "the operation failed" — the account is already created and correct, and
   * the resend control exists for exactly this.
   */
  public async sendVerificationEmail(recipient: AuthMailRecipient): Promise<void> {
    const ttlMinutes = this.mailConfig.tokenTtlMinutes.emailVerification;

    const { rawToken } = await this.authTokenService.issue({
      userId: recipient.userId,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      email: recipient.email,
      ttlMinutes
    });

    const verifyUrl = this.mailConfig.buildUserAppUrl(VERIFY_EMAIL_PATH, { token: rawToken });

    await this.mailerService.send(renderVerifyEmail({
      to: recipient.email,
      name: recipient.name || '',
      verifyUrl,
      ttlMinutes
    }));

    // Recipient and purpose only. Never the token, never the full URL.
    this.logger.log(`Queued verification email for user ${recipient.userId}`);
  }

  /** Issue a reset token and queue the recovery email. Same contract. */
  public async sendPasswordResetEmail(recipient: AuthMailRecipient): Promise<void> {
    const ttlMinutes = this.mailConfig.tokenTtlMinutes.passwordReset;

    const { rawToken } = await this.authTokenService.issue({
      userId: recipient.userId,
      type: AUTH_TOKEN_TYPE.PASSWORD_RESET,
      email: recipient.email,
      ttlMinutes
    });

    const resetUrl = this.mailConfig.buildUserAppUrl(RESET_PASSWORD_PATH, { token: rawToken });

    await this.mailerService.send(renderResetPassword({
      to: recipient.email,
      name: recipient.name || '',
      resetUrl,
      ttlMinutes
    }));

    this.logger.log(`Queued password reset email for user ${recipient.userId}`);
  }
}
