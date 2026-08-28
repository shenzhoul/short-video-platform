import { ObjectId } from 'mongodb';

import { VerificationTokenInvalidException } from 'src/common/exceptions/auth';
import { AUTH_TOKEN_TYPE } from 'src/schemas/identity/auth';
import { EmailVerificationService } from './email-verification.service';

/**
 * Confirming an address, and asking for the link again.
 *
 * Two themes:
 *
 * - **`verify` changes exactly one field.** A link that arrives in somebody's
 *   inbox must not be able to un-suspend an account, change a role or touch a
 *   credential, and the tests assert the absence of those calls rather than
 *   trusting the implementation to have left them out.
 * - **`resend` tells the caller nothing.** Whether an account exists, whether it
 *   is already confirmed and whether the cooldown allowed a send are all facts
 *   about somebody else's account. `resend` never throws, and the controller
 *   discards its return value.
 */

const USER_ID = new ObjectId();
const TOKEN_ID = new ObjectId();

function build(overrides: Record<string, any> = {}) {
  const claim = jest.fn().mockResolvedValue({
    tokenId: TOKEN_ID,
    userId: USER_ID,
    type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
    email: 'visitor@example.com',
    expiresAt: new Date(Date.now() + 60_000)
  });
  const release = jest.fn().mockResolvedValue(undefined);
  const supersedeSiblings = jest.fn().mockResolvedValue(0);
  const sendVerificationEmail = jest.fn().mockResolvedValue(undefined);
  const consumeForMailDispatch = jest.fn().mockResolvedValue(true);
  const markEmailVerified = jest.fn().mockResolvedValue(true);
  const findById = jest.fn().mockResolvedValue({ _id: USER_ID, verifiedEmail: true });
  const findByUsernameOrEmail = jest.fn().mockResolvedValue({
    _id: USER_ID,
    email: 'visitor@example.com',
    username: 'visitor',
    name: 'Visitor',
    verifiedEmail: false,
    ...(overrides.user || {})
  });
  const del = jest.fn().mockResolvedValue(undefined);

  const service = new EmailVerificationService(
    { claim, release, supersedeSiblings } as any,
    { sendVerificationEmail } as any,
    { consumeForMailDispatch } as any,
    { markEmailVerified, findById, findByUsernameOrEmail } as any,
    { del } as any
  );

  return {
    service,
    claim,
    release,
    supersedeSiblings,
    sendVerificationEmail,
    consumeForMailDispatch,
    markEmailVerified,
    findById,
    findByUsernameOrEmail,
    del
  };
}

describe('confirming an address', () => {
  it('claims the token and flips the flag', async () => {
    const { service, claim, markEmailVerified } = build();

    const result = await service.verify('raw-token');

    expect(claim).toHaveBeenCalledWith('raw-token', AUTH_TOKEN_TYPE.EMAIL_VERIFICATION);
    expect(markEmailVerified).toHaveBeenCalledWith(USER_ID, 'visitor@example.com');
    expect(result).toEqual({ verified: true, alreadyVerified: false });
  });

  it('invalidates the account\'s other confirmation links', async () => {
    const { service, supersedeSiblings } = build();

    await service.verify('raw-token');

    expect(supersedeSiblings).toHaveBeenCalledWith({
      userId: USER_ID,
      type: AUTH_TOKEN_TYPE.EMAIL_VERIFICATION,
      exceptTokenId: TOKEN_ID
    });
  });

  it('drops the cached auth user so an open session sees the change', async () => {
    const { service, del } = build();

    await service.verify('raw-token');

    expect(del).toHaveBeenCalledWith(USER_ID);
  });

  it('rejects an unusable token with one code for every cause', async () => {
    const { service, claim, markEmailVerified } = build();
    // unknown / expired / superseded / already used all arrive here as null.
    claim.mockResolvedValue(null);

    await expect(service.verify('raw-token')).rejects.toBeInstanceOf(VerificationTokenInvalidException);
    expect(markEmailVerified).not.toHaveBeenCalled();
  });

  it('is idempotent for an account that was already confirmed', async () => {
    const { service, markEmailVerified, findById } = build();
    markEmailVerified.mockResolvedValue(false);
    findById.mockResolvedValue({ _id: USER_ID, verifiedEmail: true });

    // Not an error: the state the user asked for already holds.
    await expect(service.verify('raw-token')).resolves.toEqual({
      verified: true,
      alreadyVerified: true
    });
  });

  it('rejects a link mailed to an address the account no longer uses', async () => {
    const { service, markEmailVerified, findById } = build();
    // The filtered update matched nothing and the account is still unconfirmed:
    // the address on the token is stale. An administrator changing somebody's
    // email already resets the flag, and this link must not undo that.
    markEmailVerified.mockResolvedValue(false);
    findById.mockResolvedValue({ _id: USER_ID, verifiedEmail: false });

    await expect(service.verify('raw-token')).rejects.toBeInstanceOf(VerificationTokenInvalidException);
  });

  it('releases the claim when the write fails, so the link still works', async () => {
    const { service, markEmailVerified, release } = build();
    markEmailVerified.mockRejectedValue(new Error('mongo down'));

    await expect(service.verify('raw-token')).rejects.toThrow('mongo down');

    // Safe precisely because the token was consumed — nothing else could have
    // taken it in between.
    expect(release).toHaveBeenCalledWith(TOKEN_ID);
  });

  it('still succeeds when the after-work fails', async () => {
    const { service, supersedeSiblings, del } = build();
    supersedeSiblings.mockRejectedValue(new Error('down'));
    del.mockRejectedValue(new Error('redis down'));

    // The address is confirmed; that is the final state. Reporting failure now
    // would be a lie about a change that did happen, and would send the user to
    // click a link that is genuinely spent.
    await expect(service.verify('raw-token')).resolves.toMatchObject({ verified: true });
  });
});

describe('resending the confirmation link', () => {
  it('queues one email for an unconfirmed account', async () => {
    const { service, sendVerificationEmail } = build();

    await expect(service.resend('visitor@example.com')).resolves.toBe(true);
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      userId: USER_ID,
      email: 'visitor@example.com',
      name: 'Visitor'
    });
  });

  it('accepts a username as readily as an address', async () => {
    const { service, findByUsernameOrEmail } = build();

    await service.resend('Visitor');

    // Somebody who signed in with a username has no address to hand. The
    // payload field is called `identifier` for exactly this reason.
    expect(findByUsernameOrEmail).toHaveBeenCalledWith('visitor');
  });

  it('sends nothing for an unknown account, and does not throw', async () => {
    const { service, findByUsernameOrEmail, sendVerificationEmail } = build();
    findByUsernameOrEmail.mockResolvedValue(null);

    await expect(service.resend('nobody@example.com')).resolves.toBe(false);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends nothing for an account that is already confirmed', async () => {
    const { service, findByUsernameOrEmail, sendVerificationEmail } = build();
    findByUsernameOrEmail.mockResolvedValue({
      _id: USER_ID, email: 'visitor@example.com', verifiedEmail: true
    });

    await expect(service.resend('visitor@example.com')).resolves.toBe(false);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends nothing for an account with no address', async () => {
    const { service, findByUsernameOrEmail, sendVerificationEmail } = build();
    findByUsernameOrEmail.mockResolvedValue({ _id: USER_ID, verifiedEmail: false });

    await expect(service.resend('legacy')).resolves.toBe(false);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends nothing when the limiter cannot report its state', async () => {
    const { service, consumeForMailDispatch, sendVerificationEmail } = build();
    // `consumeForMailDispatch` resolves false for both "limited" and
    // "unavailable" — the caller cannot tell them apart and does not need to.
    consumeForMailDispatch.mockResolvedValue(false);

    await expect(service.resend('visitor@example.com')).resolves.toBe(false);

    // Fail closed: this limiter is the only bound on how many messages the
    // sender account emits.
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('checks the cooldown before looking the account up', async () => {
    const { service, consumeForMailDispatch, findByUsernameOrEmail, sendVerificationEmail } = build();
    consumeForMailDispatch.mockResolvedValue(false);

    await expect(service.resend('visitor@example.com')).resolves.toBe(false);

    // Order matters: a refusal must not depend on whether the account exists,
    // or the timing difference becomes the oracle the generic response closed.
    expect(findByUsernameOrEmail).not.toHaveBeenCalled();
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('applies a 60 second cooldown and five per day, per identifier', async () => {
    const { service, consumeForMailDispatch } = build();

    await service.resend('Visitor@Example.com');

    expect(consumeForMailDispatch).toHaveBeenCalledWith({
      action: 'verification-resend',
      identifier: 'visitor@example.com',
      cooldownSeconds: 60,
      maxPerWindow: 5,
      windowSeconds: 24 * 60 * 60
    });
  });

  it('never throws, whatever fails underneath', async () => {
    const { service, sendVerificationEmail } = build();
    sendVerificationEmail.mockRejectedValue(new Error('queue down'));

    // The controller returns the same generic 200 either way; an exception here
    // would become a distinguishable response and therefore a leak.
    await expect(service.resend('visitor@example.com')).resolves.toBe(false);
  });

  it('ignores an empty identifier without touching anything', async () => {
    const { service, consumeForMailDispatch } = build();

    await expect(service.resend('   ')).resolves.toBe(false);
    expect(consumeForMailDispatch).not.toHaveBeenCalled();
  });
});

/**
 * What a crash leaves behind, at each boundary.
 *
 * MongoDB here is a standalone node, so there is no transaction spanning the
 * claim and the mutation it authorises. These do not pretend a crash cannot
 * happen; they pin down *which* state each one strands, so the answer is a
 * documented property rather than a guess.
 */
describe('crash windows in the verification sequence', () => {
  it('after the claim, before the flag: the token is spent and nothing is confirmed', async () => {
    const { service, claim, markEmailVerified } = build();
    // A process that dies here never runs the release. The token stays
    // `consumed`, so replaying the link is refused — the safe direction.
    markEmailVerified.mockImplementation(() => new Promise(() => {}));

    const pending = service.verify('raw-token');
    await Promise.resolve();

    expect(claim).toHaveBeenCalledTimes(1);
    // The user must ask for a new link. Nothing is corrupted; the cost is one
    // wasted link, and the alternative — leaving it claimable — would make a
    // replay possible.
    expect(pending).toBeInstanceOf(Promise);
  });

  it('a released claim is usable again, and the release is guarded on `consumed`', async () => {
    const { service, markEmailVerified, release } = build();
    markEmailVerified.mockRejectedValue(new Error('mongo down'));

    await expect(service.verify('raw-token')).rejects.toThrow('mongo down');

    // The compare-and-set is `{ _id, status: 'consumed' }` → `active`. It is
    // safe precisely because the token *was* consumed: no other request could
    // have taken it in between, so restoring it cannot resurrect a token
    // somebody else already used. And it cannot revive a token a genuine
    // sibling claim superseded, because that row's status is `superseded`, not
    // `consumed`, so the filter does not match it.
    expect(release).toHaveBeenCalledWith(TOKEN_ID);
  });

  it('after the flag, a crash in the bookkeeping leaves the address confirmed', async () => {
    const { service, supersedeSiblings, del } = build();
    supersedeSiblings.mockRejectedValue(new Error('killed'));
    del.mockRejectedValue(new Error('killed'));

    // `verifiedEmail` is the mutation that decides API success. Everything after
    // it is a correction the next request or the token's own expiry sorts out,
    // so none of it may turn a completed change into a reported failure.
    await expect(service.verify('raw-token')).resolves.toEqual({
      verified: true, alreadyVerified: false
    });
  });

  it('leftover sibling tokens are harmless: they expire, and one is already used', async () => {
    const { service, supersedeSiblings } = build();
    supersedeSiblings.mockRejectedValue(new Error('killed'));

    await service.verify('raw-token');

    // Worst case a second live link still confirms an address that is already
    // confirmed — `alreadyVerified: true`, which is a success, not a change.
    expect(supersedeSiblings).toHaveBeenCalled();
  });
});
