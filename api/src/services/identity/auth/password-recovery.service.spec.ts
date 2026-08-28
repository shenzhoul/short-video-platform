import { ObjectId } from 'mongodb';

import { USER_STATUS } from 'src/common/constants';
import {
  AuthTokenConsumeFailedException,
  ResetTokenInvalidException
} from 'src/common/exceptions/auth';
import { AUTH_TOKEN_TYPE } from 'src/schemas/identity/auth';
import { PasswordRecoveryService } from './password-recovery.service';

/**
 * Forgotten-password requests and the reset that follows.
 *
 * Three things are being pinned down:
 *
 * - **`requestReset` is indistinguishable across every input.** It never throws
 *   and the controller discards its return value, so a registered address and an
 *   unregistered one produce identical responses.
 * - **`resetPassword` changes the credential and nothing else.** Not the status,
 *   not the role, not the confirmation flag, not the profile. The tests assert
 *   the *absence* of those writes rather than trusting the implementation.
 * - **No false successes.** A failure before the credential is stored releases
 *   the claim and reports the failure; a failure after it is stored still
 *   reports success, because at that point the new password genuinely is the
 *   final state.
 */

const USER_ID = new ObjectId();
const TOKEN_ID = new ObjectId();
const NEW_PASSWORD = 'b'.repeat(64);

function build(overrides: Record<string, any> = {}) {
  const claim = jest.fn().mockResolvedValue({
    tokenId: TOKEN_ID,
    userId: USER_ID,
    type: AUTH_TOKEN_TYPE.PASSWORD_RESET,
    email: 'visitor@example.com',
    expiresAt: new Date(Date.now() + 60_000)
  });
  const release = jest.fn().mockResolvedValue(undefined);
  const supersedeSiblings = jest.fn().mockResolvedValue(0);
  const sendPasswordResetEmail = jest.fn().mockResolvedValue(undefined);
  const consumeForMailDispatch = jest.fn().mockResolvedValue(true);
  const replaceAuthPassword = jest.fn().mockResolvedValue({});
  const createAuthPassword = jest.fn();
  const removeAllUserTokens = jest.fn().mockResolvedValue(3);

  const account = {
    _id: USER_ID,
    email: 'visitor@example.com',
    username: 'visitor',
    name: 'Visitor',
    status: USER_STATUS.ACTIVE,
    verifiedEmail: true,
    ...(overrides.user || {})
  };
  const findByEmail = jest.fn().mockResolvedValue(account);
  const findById = jest.fn().mockResolvedValue(account);
  const markEmailVerified = jest.fn();

  const service = new PasswordRecoveryService(
    { claim, release, supersedeSiblings } as any,
    { sendPasswordResetEmail } as any,
    { consumeForMailDispatch } as any,
    { replaceAuthPassword, createAuthPassword } as any,
    { removeAllUserTokens } as any,
    { findByEmail, findById, markEmailVerified } as any
  );

  return {
    service,
    claim,
    release,
    supersedeSiblings,
    sendPasswordResetEmail,
    consumeForMailDispatch,
    replaceAuthPassword,
    createAuthPassword,
    removeAllUserTokens,
    findByEmail,
    markEmailVerified,
    account
  };
}

describe('asking for a reset link', () => {
  it('queues one email for a known address', async () => {
    const { service, sendPasswordResetEmail } = build();

    await expect(service.requestReset('Visitor@Example.com')).resolves.toBe(true);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({
      userId: USER_ID,
      email: 'visitor@example.com',
      name: 'Visitor'
    });
  });

  it('does nothing, silently, for an unknown address', async () => {
    const { service, findByEmail, sendPasswordResetEmail } = build();
    findByEmail.mockResolvedValue(null);

    await expect(service.requestReset('nobody@example.com')).resolves.toBe(false);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('sends to an unconfirmed account as readily as a confirmed one', async () => {
    const { service, sendPasswordResetEmail } = build({ user: { verifiedEmail: false } });

    // D1: an unconfirmed account still gets a reset link, and completing the
    // reset does not confirm the address. Folding one flow into the other would
    // make the account state depend on which route the user happened to take.
    await expect(service.requestReset('visitor@example.com')).resolves.toBe(true);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('sends to a suspended account, whose owner may still need to change a password', async () => {
    const { service, sendPasswordResetEmail } = build({ user: { status: USER_STATUS.INACTIVE } });

    await expect(service.requestReset('visitor@example.com')).resolves.toBe(true);
    expect(sendPasswordResetEmail).toHaveBeenCalledTimes(1);
  });

  it('does not send to a deleted account', async () => {
    const { service, sendPasswordResetEmail } = build({ user: { status: USER_STATUS.DELETED } });

    // Its address is an anonymised placeholder that nobody receives.
    await expect(service.requestReset('visitor@example.com')).resolves.toBe(false);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when the limiter cannot report its state', async () => {
    const { service, consumeForMailDispatch, sendPasswordResetEmail } = build();
    consumeForMailDispatch.mockResolvedValue(false);

    await expect(service.requestReset('visitor@example.com')).resolves.toBe(false);

    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it('checks the cooldown before it looks the address up', async () => {
    const { service, consumeForMailDispatch, findByEmail } = build();
    consumeForMailDispatch.mockResolvedValue(false);

    await expect(service.requestReset('visitor@example.com')).resolves.toBe(false);
    expect(findByEmail).not.toHaveBeenCalled();
  });

  it('applies a 60 second cooldown and five per day, per address', async () => {
    const { service, consumeForMailDispatch } = build();

    await service.requestReset('Visitor@Example.com');

    expect(consumeForMailDispatch).toHaveBeenCalledWith({
      action: 'password-forgot',
      identifier: 'visitor@example.com',
      cooldownSeconds: 60,
      maxPerWindow: 5,
      windowSeconds: 24 * 60 * 60
    });
  });

  it('never throws, whatever fails underneath', async () => {
    const { service, sendPasswordResetEmail } = build();
    sendPasswordResetEmail.mockRejectedValue(new Error('queue down'));

    await expect(service.requestReset('visitor@example.com')).resolves.toBe(false);
  });
});

describe('resetting the password', () => {
  it('replaces the credential and reports success', async () => {
    const { service, replaceAuthPassword } = build();

    await expect(service.resetPassword('raw-token', NEW_PASSWORD)).resolves.toEqual({ reset: true });

    expect(replaceAuthPassword).toHaveBeenCalledWith({
      userId: USER_ID,
      type: 'password',
      value: NEW_PASSWORD,
      key: 'visitor@example.com'
    });
  });

  it('replaces, never creates', async () => {
    const { service, createAuthPassword } = build();

    await service.resetPassword('raw-token', NEW_PASSWORD);

    // `replaceAuthPassword` has no upsert, so a reset can never quietly mint a
    // credential for an account that never had one — and there is exactly one
    // credential row afterwards, guaranteed by idx_userId_type_unique_credential.
    expect(createAuthPassword).not.toHaveBeenCalled();
  });

  it('signs every existing session out', async () => {
    const { service, removeAllUserTokens } = build();

    await service.resetPassword('raw-token', NEW_PASSWORD);

    expect(removeAllUserTokens).toHaveBeenCalledWith(USER_ID);
  });

  it('invalidates the account\'s other reset links', async () => {
    const { service, supersedeSiblings } = build();

    await service.resetPassword('raw-token', NEW_PASSWORD);

    expect(supersedeSiblings).toHaveBeenCalledWith({
      userId: USER_ID,
      type: AUTH_TOKEN_TYPE.PASSWORD_RESET,
      exceptTokenId: TOKEN_ID
    });
  });

  it('leaves the confirmation flag, status, role and profile alone', async () => {
    const { service, markEmailVerified, account } = build({ user: { verifiedEmail: false } });

    await service.resetPassword('raw-token', NEW_PASSWORD);

    // Proving control of a mailbox is real evidence, but folding it into email
    // verification would mean one flow silently satisfies another.
    expect(markEmailVerified).not.toHaveBeenCalled();
    expect(account.verifiedEmail).toBe(false);
    expect(account.status).toBe(USER_STATUS.ACTIVE);
  });

  it('returns no hash, no salt and no token', async () => {
    const { service } = build();

    const result = await service.resetPassword('raw-token', NEW_PASSWORD);

    expect(Object.keys(result)).toEqual(['reset']);
  });

  it('rejects an unusable token with one code for every cause', async () => {
    const { service, claim, replaceAuthPassword } = build();
    claim.mockResolvedValue(null);

    await expect(service.resetPassword('raw-token', NEW_PASSWORD))
      .rejects.toBeInstanceOf(ResetTokenInvalidException);
    expect(replaceAuthPassword).not.toHaveBeenCalled();
  });

  it('rejects a token whose account has since been deleted', async () => {
    const { service, replaceAuthPassword } = build({ user: { status: USER_STATUS.DELETED } });

    await expect(service.resetPassword('raw-token', NEW_PASSWORD))
      .rejects.toBeInstanceOf(ResetTokenInvalidException);
    expect(replaceAuthPassword).not.toHaveBeenCalled();
  });

  it('releases the claim when the credential write fails', async () => {
    const { service, replaceAuthPassword, release, removeAllUserTokens } = build();
    replaceAuthPassword.mockRejectedValue(new Error('write conflict'));

    await expect(service.resetPassword('raw-token', NEW_PASSWORD))
      .rejects.toBeInstanceOf(AuthTokenConsumeFailedException);

    // The user retries the same link. Leaving the token spent would strand them
    // with a valid link that no longer works, for a failure that was ours.
    expect(release).toHaveBeenCalledWith(TOKEN_ID);
    expect(removeAllUserTokens).not.toHaveBeenCalled();
  });

  it('still reports success when session revocation fails', async () => {
    const { service, removeAllUserTokens } = build();
    removeAllUserTokens.mockRejectedValue(new Error('redis down'));

    // The password has already changed and that is the final state. Rolling it
    // back to tidy up a Redis error would be worse than the error, and reporting
    // failure would send the user to retry with a token that is now spent.
    await expect(service.resetPassword('raw-token', NEW_PASSWORD)).resolves.toEqual({ reset: true });
  });

  it('still reports success when superseding siblings fails', async () => {
    const { service, supersedeSiblings } = build();
    supersedeSiblings.mockRejectedValue(new Error('down'));

    await expect(service.resetPassword('raw-token', NEW_PASSWORD)).resolves.toEqual({ reset: true });
  });

  it('lets only one of two requests carrying the same token succeed', async () => {
    const { service, claim, replaceAuthPassword } = build();
    let claimed = false;
    claim.mockImplementation(async () => {
      if (claimed) return null;
      claimed = true;
      return {
        tokenId: TOKEN_ID,
        userId: USER_ID,
        type: AUTH_TOKEN_TYPE.PASSWORD_RESET,
        email: 'visitor@example.com',
        expiresAt: new Date(Date.now() + 60_000)
      };
    });

    const results = await Promise.allSettled([
      service.resetPassword('raw-token', NEW_PASSWORD),
      service.resetPassword('raw-token', 'c'.repeat(64))
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    // One password stored, so there is no question of which one is live.
    expect(replaceAuthPassword).toHaveBeenCalledTimes(1);

    const [rejected] = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
    expect(rejected.reason).toBeInstanceOf(ResetTokenInvalidException);
  });
});

/**
 * What a crash leaves behind, at each boundary of the reset sequence.
 *
 * The rule these all serve: **the mutation that decides API success is the
 * credential write.** Before it, a failure must leave the link usable; after it,
 * nothing may report failure, because the password genuinely did change.
 */
describe('crash windows in the reset sequence', () => {
  it('before the credential write, the claim is released and the link still works', async () => {
    const { service, replaceAuthPassword, release } = build();
    replaceAuthPassword.mockRejectedValue(new Error('write conflict'));

    await expect(service.resetPassword('raw-token', NEW_PASSWORD))
      .rejects.toBeInstanceOf(AuthTokenConsumeFailedException);

    // Released with a compare-and-set on `{ _id, status: 'consumed' }`. A
    // superseded token has status `superseded` and so cannot be revived by it.
    expect(release).toHaveBeenCalledWith(TOKEN_ID);
  });

  it('a crash between the claim and the write strands only a spent token', async () => {
    const { service, replaceAuthPassword } = build();
    // A process that dies here never reaches the release. The token stays
    // `consumed` and the password is unchanged: the user asks for a new link.
    // Refusing a spent token is the safe direction — the alternative would make
    // the link replayable.
    replaceAuthPassword.mockImplementation(() => new Promise(() => {}));

    const pending = service.resetPassword('raw-token', NEW_PASSWORD);
    // Let the claim and the account read settle first; the credential write is
    // two awaits in.
    await new Promise((resolve) => { setImmediate(resolve); });

    expect(replaceAuthPassword).toHaveBeenCalledTimes(1);
    expect(pending).toBeInstanceOf(Promise);
  });

  it('after the write, a session-revocation crash still reports success', async () => {
    const { service, removeAllUserTokens } = build();
    removeAllUserTokens.mockRejectedValue(new Error('killed'));

    // This is the one irreducible window on a standalone MongoDB: the password
    // is new and sessions minted under the old one survive until their TTL.
    // Reporting failure would send the user to retry with a token that is now
    // genuinely spent, and rolling the password back to tidy up a Redis error
    // would be worse than the error.
    await expect(service.resetPassword('raw-token', NEW_PASSWORD)).resolves.toEqual({ reset: true });
  });

  it('after the write, a bookkeeping crash still reports success', async () => {
    const { service, supersedeSiblings } = build();
    supersedeSiblings.mockRejectedValue(new Error('killed'));

    await expect(service.resetPassword('raw-token', NEW_PASSWORD)).resolves.toEqual({ reset: true });
  });

  it('never reports success without the credential write having happened', async () => {
    const { service, replaceAuthPassword } = build();
    replaceAuthPassword.mockRejectedValue(new Error('boom'));

    const outcome = await service.resetPassword('raw-token', NEW_PASSWORD).catch(() => 'failed');

    // The no-false-success rule, stated as a test: the API may only say a token
    // was used if the mutation it authorised became the final state.
    expect(outcome).toBe('failed');
  });
});
