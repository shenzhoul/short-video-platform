import { Injectable, Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { USER_STATUS } from 'src/common/constants';
import {
  AuthTokenConsumeFailedException,
  ResetTokenInvalidException
} from 'src/common/exceptions/auth';
import { AUTH_TOKEN_TYPE } from 'src/schemas/identity/auth';

import { AuthMailService } from './auth-mail.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthService } from './auth.service';
import { AuthTokenService } from './auth-token.service';
import { TokenService } from './token.service';
import { BaseUserService } from '../user/base-user.service';

/** Cooldown and window for "email me a reset link", per address. */
const FORGOT_LIMIT = {
  action: 'password-forgot',
  cooldownSeconds: 60,
  maxPerWindow: 5,
  windowSeconds: 24 * 60 * 60
};

/**
 * Forgotten-password requests and the reset that follows.
 *
 * ## Unconfirmed accounts still get a reset link
 *
 * And completing a reset **does not** confirm the address. Those two decisions
 * go together: proving control of a mailbox by following a reset link is real
 * evidence, but folding it into email verification would mean one flow silently
 * satisfies another, and the account state after a reset would depend on which
 * route the user happened to take. An unconfirmed account whose password has
 * just been reset still cannot log in, and the login response tells it to
 * confirm — with a resend control right there.
 */
@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly authMailService: AuthMailService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly baseUserService: BaseUserService
  ) {}

  /**
   * Start a reset, if there is an account to start one for.
   *
   * **Always resolves**, and the controller returns the same body regardless.
   * Every branch below — no such address, deleted account, rate limited — is a
   * fact about somebody else's account, and an endpoint that behaves differently
   * for a registered address than for an unregistered one is a membership
   * oracle. That includes timing to a degree, though the dominant cost here is
   * the queue write, which happens in only one branch; a determined attacker
   * with a stopwatch is out of scope for this system and worth stating rather
   * than pretending otherwise.
   *
   * @returns whether a mail was queued. Logging and tests only.
   */
  public async requestReset(email: string): Promise<boolean> {
    const normalised = (email || '').trim().toLowerCase();
    if (!normalised) return false;

    // `consumeForMailDispatch`, not `consume`: this path's side effect is
    // sending mail, so an unknown rate-limit state means **do not send**. See
    // the note on that method for why failing open here would put the demo
    // sender account at risk of being locked.
    const allowed = await this.authRateLimitService.consumeForMailDispatch({
      ...FORGOT_LIMIT,
      identifier: normalised
    });
    if (!allowed) return false;

    const user = await this.baseUserService.findByEmail(normalised);
    if (!user) return false;

    // A deleted account's address is an anonymised placeholder that nobody
    // receives. Suspended and under-review accounts *do* get a link: their owner
    // may legitimately need to change a password they believe is compromised,
    // and the reset does not change the status that keeps them locked out.
    if (user.status === USER_STATUS.DELETED) return false;

    try {
      await this.authMailService.sendPasswordResetEmail({
        userId: user._id,
        email: user.email,
        name: user.name || user.username
      });
      return true;
    } catch (error: any) {
      this.logger.error(`Could not queue password reset email for user ${user._id}: ${error?.message}`);
      return false;
    }
  }

  /**
   * Set a new password from a mailed token.
   *
   * ## The sequence, and what each failure means
   *
   * 1. **Claim the token** — atomic, so two requests carrying the same token
   *    cannot both proceed. `null` is `RESET_TOKEN_INVALID`; nothing has
   *    changed.
   * 2. **Replace the credential.** On failure the claim is *released* and the
   *    call fails. Releasing is safe because the token was consumed: no other
   *    request could have taken it in between. The user retries the same link.
   * 3. **Revoke every session.** If this fails the password **stays changed**
   *    and the call still succeeds. Rolling back a stored password to tidy up a
   *    Redis error would be worse than the error, and telling the user it failed
   *    would send them to retry with a token that is now genuinely spent. It is
   *    logged at error level; the remaining sessions expire on their own TTL.
   * 4. **Supersede sibling reset tokens** — best-effort, same reasoning.
   *
   * ## Without transactions
   *
   * MongoDB here is a standalone node, so there is no transaction to wrap steps
   * 1–2 in. The ordering above is the substitute: each step's failure lands
   * somewhere recoverable, and no step reports success unless the mutation it
   * describes became the final state. The residual window is a crash between the
   * credential write and the session revocation — the password is new and old
   * sessions survive until they expire. That is documented rather than hidden,
   * and it is strictly smaller than the window a lookup-then-delete design has.
   *
   * ## What it deliberately does not do
   *
   * No session is created — resetting a password is not signing in. `status`,
   * `isAdmin`, `verifiedEmail` and every profile field are untouched, and the
   * response carries no hash, no salt and no token.
   */
  public async resetPassword(rawToken: string, hashedPassword: string): Promise<{ reset: true }> {
    const claimed = await this.authTokenService.claim(rawToken, AUTH_TOKEN_TYPE.PASSWORD_RESET);
    if (!claimed) throw new ResetTokenInvalidException();

    const user = await this.baseUserService.findById(claimed.userId);
    if (!user || user.status === USER_STATUS.DELETED) {
      // The account went away between the request and the click. Nothing to
      // reset; the spent token is correct — it must not become usable again.
      throw new ResetTokenInvalidException();
    }

    try {
      // `replaceAuthPassword`, never `createAuthPassword`: no upsert, so a reset
      // can never quietly create a credential for an account that never had one.
      // It also `$unset`s the legacy `salt` column, which is what stops a
      // rewritten row still looking like a pre-scrypt credential.
      await this.authService.replaceAuthPassword({
        userId: claimed.userId,
        type: 'password',
        value: hashedPassword,
        key: user.email
      });
    } catch (error: any) {
      await this.authTokenService.release(claimed.tokenId);
      this.logger.error(`Password reset write failed for user ${claimed.userId}: ${error?.message}`);
      throw new AuthTokenConsumeFailedException();
    }

    // The password is now the stored credential, and that is the final state.
    // Nothing below may fail this — so the guarantee is enforced here rather
    // than assumed of the collaborators, which is an implicit contract a later
    // refactor is free to break.
    await this.revokeSessions(claimed.userId);
    await this.supersedeOtherResetLinks(claimed.userId, claimed.tokenId);

    return { reset: true };
  }

  /**
   * Invalidate the account's remaining reset links.
   *
   * Never throws: the password has already changed. Leftover siblings expire on
   * their own, so the worst case is a link that stays usable until its TTL — and
   * anybody holding one already controls the mailbox.
   */
  private async supersedeOtherResetLinks(userId: ObjectId | string, tokenId: ObjectId): Promise<void> {
    try {
      await this.authTokenService.supersedeSiblings({
        userId,
        type: AUTH_TOKEN_TYPE.PASSWORD_RESET,
        exceptTokenId: tokenId
      });
    } catch (error: any) {
      this.logger.warn(`Could not supersede sibling reset tokens for ${userId}: ${error?.message}`);
    }
  }

  /**
   * Sign every session out, matching what an admin password change does.
   *
   * Never throws. See step 3 above: at this point the password has already
   * changed, so a failure here is a security shortfall to log, not a reason to
   * report an operation that succeeded as having failed.
   */
  private async revokeSessions(userId: ObjectId | string): Promise<void> {
    try {
      const removed = await this.tokenService.removeAllUserTokens(userId);
      this.logger.log(`Password reset for user ${userId}: ${removed} session(s) invalidated`);
    } catch (error: any) {
      this.logger.error(
        `Password reset for user ${userId} SUCCEEDED but session revocation failed — `
        + `existing sessions remain valid until they expire: ${error?.message}`
      );
    }
  }
}
