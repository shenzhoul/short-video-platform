// `src/payloads` reaches `isomorphic-dompurify`, an ESM package Jest cannot parse
// under this project's CommonJS transform. Stubbed as elsewhere in the suite.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

import * as crypto from 'crypto';
import { ObjectId } from 'mongodb';

import { AccountInactiveException, PasswordIncorrectException } from 'src/common/exceptions/auth';
import { EntityNotFoundException } from 'src/kernel';
import { AuthService } from './auth.service';
import { PasswordHasherService } from './password-hasher.service';

/**
 * Migrating passwords off salted SHA256 without asking anybody to reset one.
 *
 * There is no bulk conversion available: the plaintext exists for exactly one
 * moment, inside a successful login. So the upgrade happens there, and every
 * risk that creates is a test below —
 *
 *  - a wrong password must not rewrite anything;
 *  - a concurrent login or password change must not be overwritten by a slower
 *    upgrade finishing afterwards;
 *  - a failed upgrade must not fail the login it rode in on;
 *  - and once upgraded, the account must stop taking the legacy path.
 */

jest.setTimeout(30000);

const hasher = new PasswordHasherService();

/** A credential in the pre-migration format. */
function legacyCredential(password: string) {
  const salt = crypto.randomBytes(16).toString('base64');
  return {
    _id: new ObjectId(),
    type: 'password',
    userId: new ObjectId(),
    key: 'someone@example.com',
    salt,
    value: crypto.createHash('sha256').update(password + salt).digest('hex')
  };
}

interface Harness {
  service: AuthService;
  updateOne: jest.Mock;
  findOneAndUpdate: jest.Mock;
  credential: any;
}

function buildAuthService(credential: any, userOverrides: Record<string, any> = {}): Harness {
  const updateOne = jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
  const findOneAndUpdate = jest.fn().mockImplementation(async (_filter, update) => ({
    _id: new ObjectId(),
    type: 'password',
    userId: credential?.userId,
    value: update.$set.value,
    key: update.$set.key
  }));

  const AuthModel: any = {
    findOne: jest.fn().mockResolvedValue(credential),
    updateOne,
    findOneAndUpdate
  };

  const user = {
    _id: credential?.userId || new ObjectId(),
    email: 'someone@example.com',
    status: 'active',
    // Login refuses an unconfirmed address before it reaches the credential
    // upgrade. Nothing here is about email verification, so the fixture states
    // the confirmed case; the ordering itself is covered by
    // `auth-login-verification.spec.ts`.
    verifiedEmail: true,
    toResponse: () => ({ _id: 'u1' }),
    ...userOverrides
  };

  const baseUserService: any = { findByUsernameOrEmail: jest.fn().mockResolvedValue(user) };
  const tokenService: any = { generateToken: jest.fn().mockResolvedValue('token-abc') };
  const authUserCacheService: any = {};

  const service = new AuthService(
    AuthModel,
    baseUserService,
    tokenService,
    authUserCacheService,
    hasher
  );

  return {
    service, updateOne, findOneAndUpdate, credential
  };
}

const request: any = { headers: { 'user-agent': 'jest' } };

describe('a legacy account logging in', () => {
  it('still signs in', async () => {
    const { service } = buildAuthService(legacyCredential('old-password'));

    const result = await service.login({ username: 'someone', password: 'old-password' } as any, request);

    // The whole point: nobody is locked out and nobody is asked to reset.
    expect(result.token).toBe('token-abc');
  });

  it('rewrites the credential to scrypt', async () => {
    const { service, updateOne } = buildAuthService(legacyCredential('old-password'));

    await service.login({ username: 'someone', password: 'old-password' } as any, request);

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [, update] = updateOne.mock.calls[0];
    expect(update.$set.value.startsWith('scrypt$v=1$')).toBe(true);
  });

  it('drops the legacy salt column, so the row cannot read as legacy again', async () => {
    const { service, updateOne } = buildAuthService(legacyCredential('old-password'));

    await service.login({ username: 'someone', password: 'old-password' } as any, request);

    const [, update] = updateOne.mock.calls[0];
    expect(update.$unset).toEqual({ salt: '' });
  });

  it('upgrades exactly once — a second login finds nothing to do', async () => {
    const password = 'old-password';
    const credential = legacyCredential(password);
    const { service, updateOne } = buildAuthService(credential);

    await service.login({ username: 'someone', password } as any, request);
    expect(updateOne).toHaveBeenCalledTimes(1);

    // What the row looks like afterwards.
    const upgraded = {
      _id: credential._id,
      type: 'password',
      userId: credential.userId,
      value: updateOne.mock.calls[0][1].$set.value
    };
    const second = buildAuthService(upgraded);

    const result = await second.service.login({ username: 'someone', password } as any, request);

    expect(result.token).toBe('token-abc');
    // Already current: no further write on every subsequent sign-in.
    expect(second.updateOne).not.toHaveBeenCalled();
  });

  it('does not rewrite anything when the password is wrong', async () => {
    const { service, updateOne } = buildAuthService(legacyCredential('old-password'));

    await expect(service.login({ username: 'someone', password: 'wrong' } as any, request))
      .rejects.toBeInstanceOf(PasswordIncorrectException);

    // A credential must never be rewritable by someone guessing at it.
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('the upgrade cannot clobber a newer credential', () => {
  it('matches on the exact legacy value and salt it just verified', async () => {
    const credential = legacyCredential('old-password');
    const { service, updateOne } = buildAuthService(credential);

    await service.login({ username: 'someone', password: 'old-password' } as any, request);

    const [filter] = updateOne.mock.calls[0];
    // Compare-and-set. If anything rewrote this row in between, the filter no
    // longer matches and the update is a no-op rather than a lost password.
    expect(filter).toEqual({
      _id: credential._id,
      value: credential.value,
      salt: credential.salt
    });
  });

  it('leaves a concurrently changed credential alone', async () => {
    const credential = legacyCredential('old-password');
    const { service, updateOne } = buildAuthService(credential);
    // The row was rewritten between the read and the write, so nothing matches.
    updateOne.mockResolvedValue({ matchedCount: 0, modifiedCount: 0 });

    const result = await service.login({ username: 'someone', password: 'old-password' } as any, request);

    // The login still succeeds — the password *was* correct — and the newer
    // credential stands.
    expect(result.token).toBe('token-abc');
    expect(updateOne).toHaveBeenCalledTimes(1);
    expect(updateOne.mock.calls[0][1].$set.value).toBeDefined();
  });

  it('runs one upgrade per login and never creates a second auth row', async () => {
    const credential = legacyCredential('old-password');
    const { service, updateOne, findOneAndUpdate } = buildAuthService(credential);

    await Promise.all([
      service.login({ username: 'someone', password: 'old-password' } as any, request),
      service.login({ username: 'someone', password: 'old-password' } as any, request)
    ]);

    // Both logins upgrade, and both target the same `_id` with the same filter.
    // Whichever lands second matches nothing and changes nothing.
    expect(updateOne).toHaveBeenCalledTimes(2);
    updateOne.mock.calls.forEach(([filter]) => expect(filter._id).toBe(credential._id));
    // Crucially: the upgrade path never inserts. Only `createAuthPassword` does.
    expect(findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not fail the login when the upgrade write fails', async () => {
    const { service, updateOne } = buildAuthService(legacyCredential('old-password'));
    updateOne.mockRejectedValue(new Error('replica set stepped down'));

    const result = await service.login({ username: 'someone', password: 'old-password' } as any, request);

    // The password was correct and the session is earned. A storage problem in
    // the migration is retried on the next login, not paid for by the user.
    expect(result.token).toBe('token-abc');
  });
});

describe('credentials that cannot be read', () => {
  it('are refused as invalid credentials, not as a server error', async () => {
    const { service, updateOne } = buildAuthService({
      _id: new ObjectId(),
      userId: new ObjectId(),
      value: 'scrypt$v=99$N=1,r=1,p=1$zzz$zzz'
    });

    await expect(service.login({ username: 'someone', password: 'anything' } as any, request))
      .rejects.toBeInstanceOf(PasswordIncorrectException);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('never fall back to the legacy verifier on a guess', async () => {
    // A value that is neither format. Treating it as legacy would mean hashing
    // the candidate with an absent salt and comparing to garbage.
    const { service } = buildAuthService({
      _id: new ObjectId(),
      userId: new ObjectId(),
      value: 'not-a-credential'
    });

    await expect(service.login({ username: 'someone', password: 'anything' } as any, request))
      .rejects.toBeInstanceOf(PasswordIncorrectException);
  });
});

describe('the rest of the login contract is unchanged', () => {
  it('still refuses an unknown account', async () => {
    const { service } = buildAuthService(legacyCredential('p'));
    (service as any).baseUserService.findByUsernameOrEmail = jest.fn().mockResolvedValue(null);

    await expect(service.login({ username: 'ghost', password: 'p' } as any, request))
      .rejects.toBeInstanceOf(EntityNotFoundException);
  });

  it('still refuses an inactive account before checking the password', async () => {
    const { service, updateOne } = buildAuthService(legacyCredential('old-password'), { status: 'inactive' });

    await expect(service.login({ username: 'someone', password: 'old-password' } as any, request))
      .rejects.toBeInstanceOf(AccountInactiveException);
    expect(updateOne).not.toHaveBeenCalled();
  });
});

describe('every new credential write uses scrypt', () => {
  it('createAuthPassword inserts a scrypt value via $setOnInsert only', async () => {
    const { service, findOneAndUpdate } = buildAuthService(null);
    // `new: false` + upsert: null means this call performed the insert.
    findOneAndUpdate.mockResolvedValue(null);

    await service.createAuthPassword({
      userId: new ObjectId(), type: 'password', key: 'a@b.com', value: 'plaintext'
    } as any);

    const [filter, update, options] = findOneAndUpdate.mock.calls[0];
    // Create must not carry `$set`: that is what made create and change the same
    // operation and produced false successes under concurrency.
    expect(update.$set).toBeUndefined();
    expect(update.$setOnInsert.value.startsWith('scrypt$v=1$')).toBe(true);
    expect(filter).toEqual(expect.objectContaining({ type: 'password' }));
    expect(options).toEqual(expect.objectContaining({ upsert: true, new: false }));
  });

  it('replaceAuthPassword updates in place and never upserts', async () => {
    const { service, findOneAndUpdate } = buildAuthService(null);
    findOneAndUpdate.mockResolvedValue({ _id: new ObjectId(), value: 'scrypt$v=1$x' });

    await service.replaceAuthPassword({
      userId: new ObjectId(), type: 'password', key: 'a@b.com', value: 'plaintext'
    } as any);

    const [, update, options] = findOneAndUpdate.mock.calls[0];
    expect(update.$set.value.startsWith('scrypt$v=1$')).toBe(true);
    expect(update.$unset).toEqual({ salt: '' });
    // No upsert: a change cannot silently become a creation.
    expect(options?.upsert).toBeUndefined();
  });

  it('never stores the plaintext it was given', async () => {
    const { service, findOneAndUpdate } = buildAuthService(null);
    findOneAndUpdate.mockResolvedValue(null);

    await service.createAuthPassword({
      userId: new ObjectId(), type: 'password', key: 'a@b.com', value: 'super-secret'
    } as any);

    const written = JSON.stringify(findOneAndUpdate.mock.calls[0][1]);
    expect(written).not.toContain('super-secret');
  });
});
