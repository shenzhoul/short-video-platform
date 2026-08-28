import { PasswordRecoveryController } from './password-recovery.controller';
import { VerificationController } from './verification.controller';

/**
 * The public response of the two mail-dispatch endpoints.
 *
 * One property, stated twice: **nothing a caller can observe varies with what
 * the server found.** Whether the account exists, whether it is already
 * confirmed, whether the per-address cooldown declined, and whether Redis could
 * not report the rate-limit state at all — every one of those produces the same
 * status and the same body. Any difference is an oracle for "which addresses are
 * registered here".
 *
 * The field is `accepted`, not `sent`. In most of the cases below no message was
 * produced, so `sent: true` asserted something the server had not done and could
 * not know.
 */

/** Every way the service layer can resolve, including the two that send nothing. */
const OUTCOMES: Array<[string, boolean]> = [
  ['a registered, unconfirmed account (mail queued)', true],
  ['an account that does not exist', false],
  ['an account that is already confirmed', false],
  ['an address inside its per-identifier cooldown', false],
  ['a Redis outage that suppressed the send', false]
];

describe('POST /auth/verification/resend', () => {
  function build(resendResolves: boolean) {
    const resend = jest.fn().mockResolvedValue(resendResolves);
    return { controller: new VerificationController({ resend } as any), resend };
  }

  it.each(OUTCOMES)('answers identically for %s', async (_name, resolves) => {
    const { controller } = build(resolves);

    const response = await controller.resendVerification({ identifier: 'someone@example.com' } as any);

    expect(response).toEqual({ status: 0, data: { accepted: true } });
  });

  it('produces one response shape across every outcome', async () => {
    const responses = await Promise.all(
      OUTCOMES.map(async ([, resolves]) => {
        const { controller } = build(resolves);
        return JSON.stringify(await controller.resendVerification({ identifier: 'x@example.com' } as any));
      })
    );

    expect(new Set(responses).size).toBe(1);
  });

  it('never claims a message was sent', async () => {
    const { controller } = build(false);

    const response: any = await controller.resendVerification({ identifier: 'x@example.com' } as any);

    expect(response.data).not.toHaveProperty('sent');
    expect(Object.keys(response.data)).toEqual(['accepted']);
  });

  it('discards the service result rather than branching on it', async () => {
    const { controller, resend } = build(true);

    await controller.resendVerification({ identifier: 'x@example.com' } as any);

    // Branching here — even only to change a message — is how the endpoint
    // becomes an oracle.
    expect(resend).toHaveBeenCalledWith('x@example.com');
  });
});

describe('POST /auth/forgot-password', () => {
  function build(requestResolves: boolean) {
    const requestReset = jest.fn().mockResolvedValue(requestResolves);
    return {
      controller: new PasswordRecoveryController({ requestReset } as any),
      requestReset
    };
  }

  it.each(OUTCOMES)('answers identically for %s', async (_name, resolves) => {
    const { controller } = build(resolves);

    const response = await controller.forgotPassword({ email: 'someone@example.com' } as any);

    expect(response).toEqual({ status: 0, data: { accepted: true } });
  });

  it('produces one response shape across every outcome', async () => {
    const responses = await Promise.all(
      OUTCOMES.map(async ([, resolves]) => {
        const { controller } = build(resolves);
        return JSON.stringify(await controller.forgotPassword({ email: 'x@example.com' } as any));
      })
    );

    expect(new Set(responses).size).toBe(1);
  });

  it('never claims a message was sent', async () => {
    const { controller } = build(false);

    const response: any = await controller.forgotPassword({ email: 'x@example.com' } as any);

    expect(response.data).not.toHaveProperty('sent');
    expect(Object.keys(response.data)).toEqual(['accepted']);
  });
});
