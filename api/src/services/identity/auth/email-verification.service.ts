import { Injectable, Logger } from '@nestjs/common';
import { VerificationTokenInvalidException } from 'src/common/exceptions/auth';
import { requiresEmailVerification } from 'src/common/lib/email-verification.lib';
import { AUTH_TOKEN_TYPE } from 'src/schemas/identity/auth';

import { AuthTokenService } from './auth-token.service';
import { AuthMailService } from './auth-mail.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthUserCacheService } from '../auth-user-cache.service';
import { BaseUserService } from '../user/base-user.service';

/** Cooldown and window for "send it again", per account. */
const RESEND_LIMIT = {
  action: 'verification-resend',
  cooldownSeconds: 60,
  maxPerWindow: 5,
  windowSeconds: 24 * 60 * 60
};

export interface VerifyEmailResult {
  verified: true;
  /** True when the account was already confirmed before this call. */
  alreadyVerified: boolean;
}

/**
 * Confirming an email address, and asking for the link again.
 *
 * Kept apart from `AuthService`, which owns credentials and sessions. Neither
 * operation here touches either, and that separation is what makes it easy to
 * see that a verification link cannot change a password or mint a session.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly authTokenService: AuthTokenService,
    private readonly authMailService: AuthMailService,
    private readonly authRateLimitService: AuthRateLimitService,
    private readonly baseUserService: BaseUserService,
    private readonly authUserCacheService: AuthUserCacheService
  ) {}

  /**
   * Confirm an address from a mailed token.
   *
   * ## The sequence, and what happens when each step fails
   *
   * 1. **Claim the token.** Atomic: the validity check and the consumption are
   *    one `findOneAndUpdate`, so two requests carrying the same token cannot
   *    both proceed. `null` — unknown, expired, superseded, already used — is
   *    one error with one code.
   * 2. **Set `verifiedEmail`.** If this throws, the claim is *released* and the
   *    caller gets a failure. Releasing is safe precisely because the token was
   *    consumed: nothing else could have taken it meanwhile.
   * 3. **Everything after** — superseding sibling links, refreshing the cached
   *    auth user — is best-effort. The address is confirmed and that is the
   *    final state; reporting failure now would be a lie about a change that
   *    did happen, and would send the user to click a link that no longer works.
   *
   * ## Idempotency
   *
   * A second click on the same link fails at step 1 — it is genuinely spent. But
   * a user with two live links who clicks the second one after the first, and a
   * user whose account was confirmed some other way, both land on
   * `alreadyVerified: true` rather than an error. `markEmailVerified` filters on
   * `verifiedEmail: { $ne: true }`, so its return value answers "did this call
   * perform the transition" without a second read.
   *
   * ## What it deliberately does not do
   *
   * No status change, no role change, no credential change, no session. An
   * account an administrator suspended stays suspended after its owner confirms
   * their address — login evaluates the two conditions independently.
   */
  public async verify(rawToken: string): Promise<VerifyEmailResult> {
    const claimed = await this.authTokenService.claim(rawToken, AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    if (!claimed) throw new VerificationTokenInvalidException();

    let transitioned: boolean;
    try {
      // The token carries the address it was issued for, and `markEmailVerified`
      // matches on it. A link mailed to an address the account no longer uses
      // therefore confirms nothing — an administrator changing somebody's email
      // already resets the flag, and a stale link must not undo that.
      transitioned = await this.baseUserService.markEmailVerified(claimed.userId, claimed.email);
    } catch (error: any) {
      await this.authTokenService.release(claimed.tokenId);
      this.logger.error(`Verification write failed for user ${claimed.userId}: ${error?.message}`);
      throw error;
    }

    if (!transitioned) {
      // Either the account was confirmed already, or the token's address no
      // longer matches. The first is a success; the second is not, and the two
      // are told apart by reading the account back.
      const user = await this.baseUserService.findById(claimed.userId);
      if (!user || requiresEmailVerification(user)) {
        // Stale address. The token is spent — deliberately, since replaying it
        // must not become possible — and the user needs a fresh link.
        throw new VerificationTokenInvalidException();
      }
    }

    // Past this line the address is confirmed, and that is the final state.
    // Nothing below may fail the call — so the guarantee is enforced *here*,
    // rather than assumed of the collaborators. `supersedeSiblings` happens to
    // swallow its own errors today; depending on that is depending on an
    // implicit contract that a later refactor is free to break.
    await this.finishVerification(claimed.userId, claimed.tokenId);

    return { verified: true, alreadyVerified: !transitioned };
  }

  /**
   * Send the confirmation link again, if there is any reason to.
   *
   * **Always resolves.** The caller returns the same response whatever happened
   * here, so this never signals through an exception: whether the account
   * exists, whether it is already confirmed, whether it has a usable address and
   * whether the cooldown allowed a send are all facts about somebody else's
   * account, and leaking any of them turns the endpoint into an oracle for
   * "which addresses are registered".
   *
   * The rate limiter is consulted *before* the account lookup and the send, and
   * a refusal is silent for the same reason — a per-address cooldown that is
   * observable is itself an enumeration channel.
   *
   * @returns whether a mail was actually queued. For logging and tests only:
   *   controllers must not vary their response on it.
   */
  public async resend(identifier: string): Promise<boolean> {
    const normalised = (identifier || '').trim().toLowerCase();
    if (!normalised) return false;

    // `consumeForMailDispatch`, not `consume`: this path's side effect is
    // sending mail, so an unknown rate-limit state means **do not send**. See
    // the note on that method for why failing open here would put the demo
    // sender account at risk of being locked.
    const allowed = await this.authRateLimitService.consumeForMailDispatch({
      ...RESEND_LIMIT,
      identifier: normalised
    });
    if (!allowed) return false;

    const user = await this.baseUserService.findByUsernameOrEmail(normalised);
    if (!user) return false;
    // Nothing to confirm.
    if (!requiresEmailVerification(user)) return false;
    // An account with no address cannot be mailed. `createNewUserAccount`
    // refuses to create one in this state, so this only guards legacy rows.
    if (!user.email) return false;

    try {
      await this.authMailService.sendVerificationEmail({
        userId: user._id,
        email: user.email,
        name: user.name || user.username
      });
      return true;
    } catch (error: any) {
      this.logger.error(`Could not queue verification resend for user ${user._id}: ${error?.message}`);
      return false;
    }
  }

  /**
   * The work that happens after an address is confirmed, none of which may fail
   * the request.
   *
   * Superseding the account's other links keeps "one successful use invalidates
   * the rest" true; dropping the cached auth user stops an open session on
   * another device from continuing to see the account as unconfirmed. Both are
   * corrections that the next request, or the token's own expiry, would sort out
   * anyway.
   */
  private async finishVerification(userId: any, tokenId: any): Promise<void> {
    try {
      await this.authTokenService.supersedeSiblings({
        userId,
        type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
        exceptTokenId: tokenId
      });
    } catch (error: any) {
      this.logger.warn(`Could not supersede sibling verification tokens for ${userId}: ${error?.message}`);
    }

    await this.refreshCachedUser(userId);
  }

  /**
   * Drop the cached auth user so the next authenticated request re-reads it.
   *
   * The cache is keyed by user id and holds `verifiedEmail`. Without this a
   * user who confirms while holding a session elsewhere would keep being seen as
   * unconfirmed until the entry expired. Best-effort: a stale cache entry is a
   * short-lived inconvenience, not a reason to fail a confirmed verification.
   */
  private async refreshCachedUser(userId: any): Promise<void> {
    try {
      await this.authUserCacheService.del(userId);
    } catch (error: any) {
      this.logger.warn(`Could not refresh cached auth user ${userId}: ${error?.message}`);
    }
  }
}
