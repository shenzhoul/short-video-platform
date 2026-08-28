import { ObjectId } from 'mongodb';

import { USER_STATUS } from 'src/common/constants';
import {
  AccountInactiveException,
  EmailNotVerifiedException,
  PasswordIncorrectException
} from 'src/common/exceptions/auth';
import { EntityNotFoundException } from 'src/kernel';
import { AuthService } from './auth.service';

/**
 * What login refuses, in what order, and what it never leaks along the way.
 *
 * Two properties are under test and they pull in opposite directions:
 *
 * - a caller who has **not** proved they hold the password learns nothing about
 *   whether an account exists, is suspended, or is unconfirmed;
 * - a caller who **has** proved it gets a specific, actionable reason, because
 *   "your credentials are wrong" is useless advice for somebody whose password
 *   is right.
 *
 * The ordering of the checks is what reconciles them, so the ordering is the
 * thing asserted — not just the individual outcomes.
 */

const USER_ID = new ObjectId();
const CORRECT_PASSWORD = 'a'.repeat(64);

function buildService(userOverrides: Record<string, any> = {}) {
  const user = {
    _id: USER_ID,
    email: 'visitor@example.com',
    username: 'visitor',
    status: USER_STATUS.ACTIVE,
    verifiedEmail: true,
    toResponse: () => ({ _id: USER_ID, username: 'visitor' }),
    ...userOverrides
  };

  const findByUsernameOrEmail = jest.fn().mockResolvedValue(user);
  const generateToken = jest.fn().mockResolvedValue('session-token');
  const authModel = {
    findOne: jest.fn().mockResolvedValue({ _id: new ObjectId(), value: 'scrypt$stored' })
  };
  const verify = jest.fn().mockResolvedValue({ valid: true, needsUpgrade: false });

  const service = new AuthService(
    authModel as any,
    { findByUsernameOrEmail } as any,
    { generateToken } as any,
    { get: jest.fn(), set: jest.fn() } as any,
    { verify, hash: jest.fn() } as any
  );

  return {
    service, user, generateToken, verify, findByUsernameOrEmail, authModel
  };
}

const request = { headers: { 'user-agent': 'jest' } } as any;

function login(service: AuthService, password = CORRECT_PASSWORD) {
  return service.login({ username: 'visitor', password } as any, request);
}

describe('a caller who has not proved the password learns nothing', () => {
  it('reports an unknown account as invalid credentials', async () => {
    const { service, findByUsernameOrEmail } = buildService();
    findByUsernameOrEmail.mockResolvedValue(null);

    await expect(login(service)).rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('reports a wrong password on a suspended account as invalid credentials', async () => {
    const { service, verify } = buildService({ status: USER_STATUS.INACTIVE });
    verify.mockResolvedValue({ valid: false });

    // Before the check order was fixed, the status check ran first and this
    // threw AccountInactiveException — telling an unauthenticated caller that
    // the account exists and is suspended, from a wrong password.
    const error = await login(service).catch((e) => e);

    expect(error).toBeInstanceOf(PasswordIncorrectException);
    expect(error).not.toBeInstanceOf(AccountInactiveException);
  });

  it('reports a wrong password on an unconfirmed account as invalid credentials', async () => {
    const { service, verify } = buildService({ verifiedEmail: false });
    verify.mockResolvedValue({ valid: false });

    const error = await login(service).catch((e) => e);

    expect(error).toBeInstanceOf(PasswordIncorrectException);
    expect(error).not.toBeInstanceOf(EmailNotVerifiedException);
  });

  it('gives the same error whether the account is suspended, unconfirmed or fine', async () => {
    const cases = [
      {},
      { status: USER_STATUS.INACTIVE },
      { verifiedEmail: false },
      { status: USER_STATUS.INACTIVE, verifiedEmail: false }
    ];

    const responses = await Promise.all(cases.map(async (overrides) => {
      const { service, verify } = buildService(overrides);
      verify.mockResolvedValue({ valid: false });
      const error = await login(service, 'wrong').catch((e) => e);
      return { name: error.constructor.name, status: error.getStatus?.() };
    }));

    // One shape for every wrong-password case, so nothing is distinguishable.
    expect(new Set(responses.map((r) => JSON.stringify(r))).size).toBe(1);
  });
});

describe('an unconfirmed email blocks the session', () => {
  it('refuses a correct password with a typed error', async () => {
    const { service } = buildService({ verifiedEmail: false });

    const error = await login(service).catch((e) => e);

    expect(error).toBeInstanceOf(EmailNotVerifiedException);
    expect(error.getStatus()).toBe(403);
    // The client branches on the code, never on the message: matching text
    // breaks the first time the copy is reworded or translated.
    expect(error.getResponse()).toMatchObject({ error: 'EMAIL_VERIFICATION_REQUIRED' });
  });

  it('issues no session at all', async () => {
    const { service, generateToken } = buildService({ verifiedEmail: false });

    await login(service).catch(() => undefined);

    // Not a token, not a cookie, nothing. The alternative — issue one and have
    // a guard reject every later request — is a half-authenticated client and a
    // bypass allow-list that rots.
    expect(generateToken).not.toHaveBeenCalled();
  });

  it('treats a missing flag as unconfirmed', async () => {
    const { service } = buildService({ verifiedEmail: undefined });

    // `!== true`, never `=== false`: a document written outside Mongoose can
    // omit the field, and `undefined === false` is false.
    await expect(login(service)).rejects.toBeInstanceOf(EmailNotVerifiedException);
  });

  it('lets a confirmed account through', async () => {
    const { service, generateToken } = buildService();

    const result = await login(service);

    expect(result.token).toBe('session-token');
    expect(generateToken).toHaveBeenCalledTimes(1);
  });
});

describe('confirmation and status are independent', () => {
  it('still refuses a suspended account whose address is confirmed', async () => {
    const { service, generateToken } = buildService({
      status: USER_STATUS.INACTIVE,
      verifiedEmail: true
    });

    await expect(login(service)).rejects.toBeInstanceOf(AccountInactiveException);
    expect(generateToken).not.toHaveBeenCalled();
  });

  it('refuses an active account whose address is not confirmed', async () => {
    const { service } = buildService({ status: USER_STATUS.ACTIVE, verifiedEmail: false });

    await expect(login(service)).rejects.toBeInstanceOf(EmailNotVerifiedException);
  });

  it('reports the status first when an account fails both checks', async () => {
    const { service } = buildService({ status: USER_STATUS.INACTIVE, verifiedEmail: false });

    // Suspension is the more fundamental refusal: confirming an address would
    // not let this account in, so sending its owner to their inbox would be
    // sending them somewhere pointless.
    await expect(login(service)).rejects.toBeInstanceOf(AccountInactiveException);
  });
});
