// `src/payloads` reaches `isomorphic-dompurify` — an ESM package Jest cannot parse under this
// project's CommonJS transform. Stubbed exactly as `admin-category.controller.spec.ts` stubs it;
// nothing here exercises sanitisation.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

import { ObjectId } from 'mongodb';

import { EmailHasBeenTakenException, UsernameTakenException } from 'src/common/exceptions/user';
import { RegisterPayload } from 'src/payloads/identity';
import { UserAccountManagementService } from './user.service';

/**
 * Public self-registration.
 *
 * Everything here is about the two guarantees that separate an open endpoint
 * from the admin one it shares an implementation with:
 *
 *  1. A visitor decides nothing about *what kind* of account they get. Role,
 *     status and the verified-email flag are assigned by the server, whatever
 *     the request said.
 *  2. Two registrations for the same email or username can produce at most one
 *     account, including when they race past the uniqueness pre-check together.
 *
 * The fake model below models the second one honestly: `countDocuments` is a
 * read that can be stale, and the unique index is what actually decides. A fake
 * that rejected duplicates in `create` by re-reading would prove nothing about
 * concurrency.
 */

interface StoredUser {
  _id: ObjectId;
  email?: string;
  username?: string;
  status?: string;
  isAdmin?: boolean;
  isCreator?: boolean;
  verifiedEmail?: boolean;
  name?: string;
  password?: string;
}

/** Mirrors `idx_email_unique_auth` / `idx_username_unique_profile`. */
class DuplicateKeyError extends Error {
  code = 11000;

  constructor(public keyPattern: Record<string, number>) {
    super('E11000 duplicate key error collection: users');
  }
}

class FakeUserModel {
  documents: StoredUser[] = [];

  /** Set true to let both racers past the pre-check, as a real race does. */
  preCheckAlwaysMisses = false;

  db = {
    collection: () => ({
      countDocuments: async (query: any) => {
        if (this.preCheckAlwaysMisses) return 0;
        const clauses = query.$or || [];
        return this.documents.filter((doc) => clauses.some((clause: any) => (
          (clause.email && doc.email === clause.email)
          || (clause.username && doc.username === clause.username)
        ))).length;
      }
    })
  };

  create = async (payload: any) => {
    if (payload.email && this.documents.some((doc) => doc.email === payload.email)) {
      throw new DuplicateKeyError({ email: 1 });
    }
    if (payload.username && this.documents.some((doc) => doc.username === payload.username)) {
      throw new DuplicateKeyError({ username: 1 });
    }

    // `password` is not on the User schema, so mongoose strips it. Modelled
    // here because "the hash never lands on the user document" is asserted.
    const { password, ...persisted } = payload;
    const stored: StoredUser = { _id: new ObjectId(), ...persisted };
    this.documents.push(stored);
    return stored;
  };

  findById = async (id: any) => this.documents.find((doc) => `${doc._id}` === `${id}`) || null;

  findOne = async (filter: any) => this.documents.find((doc) => `${doc._id}` === `${filter._id}`) || null;

  updateOne = async (filter: any, update: any) => {
    const target = this.documents.find((doc) => `${doc._id}` === `${filter._id}`);
    if (!target) return { modifiedCount: 0 };
    Object.assign(target, update.$set || update);
    return { modifiedCount: 1 };
  };

  countDocuments = async (query: any) => this.documents.filter((doc) => {
    if (query.email && doc.email !== query.email) return false;
    if (query.username && doc.username !== query.username) return false;
    if (query._id?.$ne && `${doc._id}` === `${query._id.$ne}`) return false;
    return true;
  }).length;

  /** Used by the compensation path when a credential write fails. */
  deleteOne = async (filter: any) => {
    const before = this.documents.length;
    this.documents = this.documents.filter((doc) => `${doc._id}` !== `${filter._id}`);
    return { deletedCount: before - this.documents.length };
  };
}

function buildService() {
  const model = new FakeUserModel();
  const createAuthPassword = jest.fn().mockResolvedValue({});
  const removeAuthPassword = jest.fn().mockResolvedValue(undefined);
  const publish = jest.fn().mockResolvedValue(undefined);
  // A fake, never the real provider. No test in this repo opens a socket to a
  // mail server; see `mail-provider.spec.ts`, which asserts that as a property.
  const sendVerificationEmail = jest.fn().mockResolvedValue(undefined);

  const removeAllUserTokens = jest.fn().mockResolvedValue(0);
  const supersedeSiblings = jest.fn().mockResolvedValue(0);
  const setAuthUserCache = jest.fn().mockResolvedValue(undefined);

  const service = new UserAccountManagementService(
    model as any,
    { publish } as any,
    { createAuthPassword, removeAuthPassword, removeAllUserTokens } as any,
    { set: setAuthUserCache } as any,
    {} as any,
    {} as any,
    {} as any,
    { sendVerificationEmail } as any,
    { supersedeSiblings } as any
  );

  return {
    service,
    model,
    createAuthPassword,
    removeAuthPassword,
    removeAllUserTokens,
    supersedeSiblings,
    publish,
    sendVerificationEmail
  };
}

function registerPayload(overrides: Record<string, any> = {}): RegisterPayload {
  return {
    email: 'Visitor@Example.com',
    username: 'Visitor',
    name: 'Visitor',
    firstName: 'Vis',
    lastName: 'Itor',
    gender: 'female',
    // Already SHA256-hashed by the client, exactly as login sends it.
    password: 'a'.repeat(64),
    ...overrides
  } as RegisterPayload;
}

describe('public self-registration', () => {
  it('creates an ordinary, active, non-admin account', async () => {
    const { service, model } = buildService();

    const dto = await service.registerNewUser(registerPayload());

    expect(model.documents).toHaveLength(1);
    const [created] = model.documents;
    expect(created.status).toBe('active');
    expect(created.isAdmin).toBe(false);
    expect(created.verifiedEmail).toBe(false);
    // Normalised the same way the admin path normalises them, so a login by
    // email or username finds the account regardless of how it was typed.
    expect(created.email).toBe('visitor@example.com');
    expect(created.username).toBe('visitor');
    expect(dto.username).toBe('visitor');
  });

  it('hashes the password through the existing auth flow rather than storing it', async () => {
    const { service, model, createAuthPassword } = buildService();

    await service.registerNewUser(registerPayload());

    expect(createAuthPassword).toHaveBeenCalledTimes(1);
    expect(createAuthPassword).toHaveBeenCalledWith({
      userId: model.documents[0]._id,
      type: 'password',
      value: 'a'.repeat(64),
      key: 'visitor@example.com'
    });
    // The user document must never carry the credential — salting and storage
    // belong to AuthService and the `auths` collection.
    expect(model.documents[0].password).toBeUndefined();
  });

  it('ignores role, status and internal flags sent by the client', async () => {
    const { service, model } = buildService();

    await service.registerNewUser(registerPayload({
      isAdmin: true,
      isCreator: true,
      status: 'inactive',
      verifiedEmail: true,
      balance: 999
    }));

    const [created] = model.documents;
    expect(created.isAdmin).toBe(false);
    expect(created.status).toBe('active');
    expect(created.verifiedEmail).toBe(false);
    expect((created as any).balance).toBeUndefined();
    expect(created.isCreator).toBeUndefined();
  });

  it('falls back to a display name built from the given names', async () => {
    const { service, model } = buildService();

    await service.registerNewUser(registerPayload({ name: undefined }));

    expect(model.documents[0].name).toBe('Vis Itor');
  });

  it('publishes the account-created event the admin path publishes', async () => {
    const { service, publish } = buildService();

    await service.registerNewUser(registerPayload());

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('rejects a duplicate email with a normalised error', async () => {
    const { service } = buildService();
    await service.registerNewUser(registerPayload());

    await expect(service.registerNewUser(registerPayload({ username: 'someoneelse' })))
      .rejects.toBeInstanceOf(EmailHasBeenTakenException);
  });

  it('rejects a duplicate username with a normalised error', async () => {
    const { service } = buildService();
    await service.registerNewUser(registerPayload());

    await expect(service.registerNewUser(registerPayload({ email: 'other@example.com' })))
      .rejects.toBeInstanceOf(UsernameTakenException);
  });

  it('is case-insensitive about which email is a duplicate', async () => {
    const { service } = buildService();
    await service.registerNewUser(registerPayload());

    await expect(service.registerNewUser(registerPayload({
      email: 'VISITOR@EXAMPLE.COM',
      username: 'another'
    }))).rejects.toBeInstanceOf(EmailHasBeenTakenException);
  });

  describe('concurrent registrations for the same identity', () => {
    it('creates at most one account when both requests pass the pre-check', async () => {
      const { service, model } = buildService();
      // Both reads happen before either write — the situation the unique index
      // exists for.
      model.preCheckAlwaysMisses = true;

      const results = await Promise.allSettled([
        service.registerNewUser(registerPayload()),
        service.registerNewUser(registerPayload())
      ]);

      expect(model.documents).toHaveLength(1);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

      const [rejected] = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      // The loser must be told the email is taken — not handed a raw driver
      // error as an HTTP 500.
      expect(rejected.reason).toBeInstanceOf(EmailHasBeenTakenException);
      expect(rejected.reason.getStatus()).toBe(400);
    });

    it('reports the username when that is the colliding index', async () => {
      const { service, model } = buildService();
      model.preCheckAlwaysMisses = true;

      const results = await Promise.allSettled([
        service.registerNewUser(registerPayload()),
        service.registerNewUser(registerPayload({ email: 'other@example.com' }))
      ]);

      expect(model.documents).toHaveLength(1);
      const [rejected] = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
      expect(rejected.reason).toBeInstanceOf(UsernameTakenException);
    });

    it('does not disguise an unrelated write failure as a taken email', async () => {
      const { service, model } = buildService();
      const failure = Object.assign(new Error('write conflict'), {
        code: 11000,
        keyPattern: { someOtherField: 1 }
      });
      model.create = jest.fn().mockRejectedValue(failure);

      // `code === 11000` alone says nothing about *which* index collided.
      await expect(service.registerNewUser(registerPayload())).rejects.toBe(failure);
    });
  });
});

describe('admin account creation shares the same implementation', () => {
  it('still creates accounts through the path registration uses', async () => {
    const { service, model, createAuthPassword } = buildService();

    await service.createNewUserAccount({
      email: 'Managed@Example.com',
      username: 'Managed',
      name: 'Managed User',
      password: 'b'.repeat(64)
    } as any);

    expect(model.documents).toHaveLength(1);
    expect(model.documents[0].email).toBe('managed@example.com');
    expect(createAuthPassword).toHaveBeenCalledTimes(1);
  });

  it('keeps admin-created accounts subject to the same uniqueness rules', async () => {
    const { service } = buildService();
    await service.registerNewUser(registerPayload());

    await expect(service.createNewUserAccount({
      email: 'visitor@example.com',
      username: 'staffpick'
    } as any)).rejects.toBeInstanceOf(EmailHasBeenTakenException);
  });
});

/**
 * The confirmation email, and what happens when any part of creating an account
 * goes wrong.
 *
 * The theme of every test below is the same distinction: **"the account was not
 * created" and "the account exists but its email has not gone out" are different
 * outcomes and must never be reported as each other.** Getting that wrong in
 * either direction is expensive — one leaves a visitor believing they have no
 * account when they do, the other destroys a real account over a queue hiccup.
 */
describe('registration and the confirmation email', () => {
  it('asks for exactly one verification email, addressed to the registered account', async () => {
    const { service, model, sendVerificationEmail } = buildService();

    await service.registerNewUser(registerPayload());

    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      userId: model.documents[0]._id,
      // Normalised, matching what was stored — not the mixed case that was typed.
      email: 'visitor@example.com',
      name: 'Visitor'
    });
  });

  it('reports that the email was queued', async () => {
    const { service } = buildService();

    const dto = await service.registerNewUser(registerPayload());

    expect((dto as any).verificationEmailQueued).toBe(true);
  });

  it('keeps the account when the verification email cannot be queued', async () => {
    const { service, model, sendVerificationEmail } = buildService();
    sendVerificationEmail.mockRejectedValue(new Error('redis unreachable'));

    const dto = await service.registerNewUser(registerPayload());

    // The account is the thing the visitor asked for and it exists. Rolling it
    // back over a mail failure would destroy something recoverable — they can
    // press Resend — to avoid something merely inconvenient.
    expect(model.documents).toHaveLength(1);
    expect(model.documents[0].verifiedEmail).toBe(false);
    // ...and the caller can tell the difference, which is what lets the UI say
    // "we could not send it" instead of "check your inbox".
    expect((dto as any).verificationEmailQueued).toBe(false);
  });

  it('does not send a verification email when an administrator vouches for the address', async () => {
    const { service, model, sendVerificationEmail } = buildService();

    await service.createNewUserAccount(
      { email: 'managed@example.com', username: 'managed', password: 'b'.repeat(64) } as any,
      { verifiedEmail: true }
    );

    expect(model.documents[0].verifiedEmail).toBe(true);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('sends one when an administrator leaves the switch off', async () => {
    const { service, model, sendVerificationEmail } = buildService();

    await service.createNewUserAccount(
      { email: 'managed@example.com', username: 'managed', password: 'b'.repeat(64) } as any,
      { verifiedEmail: false }
    );

    expect(model.documents[0].verifiedEmail).toBe(false);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('refuses to create an unconfirmed account with no address to confirm', async () => {
    const { service, model } = buildService();

    // An account that must confirm an address it does not have can never log in
    // and can never be mailed: a permanent lockout with no signal. Refusing is
    // the only honest answer.
    await expect(service.createNewUserAccount(
      { username: 'addressless', password: 'b'.repeat(64) } as any,
      { verifiedEmail: false }
    )).rejects.toBeTruthy();

    expect(model.documents).toHaveLength(0);
  });
});

describe('a failed credential write does not orphan a profile', () => {
  it('removes the user document it just created', async () => {
    const { service, model, createAuthPassword } = buildService();
    createAuthPassword.mockRejectedValue(new Error('credential write conflict'));

    await expect(service.registerNewUser(registerPayload())).rejects.toThrow('credential write conflict');

    // Without compensation this row survives with no password: login answers
    // "invalid credentials" for ever and registering again answers "that email
    // is taken", so the address becomes permanently unusable.
    expect(model.documents).toHaveLength(0);
  });

  it('sweeps a partially written credential too', async () => {
    const { service, removeAuthPassword, createAuthPassword } = buildService();
    createAuthPassword.mockRejectedValue(new Error('boom'));

    await expect(service.registerNewUser(registerPayload())).rejects.toThrow('boom');

    expect(removeAuthPassword).toHaveBeenCalledTimes(1);
  });

  it('surfaces the original failure, not a compensation failure', async () => {
    const { service, model, createAuthPassword } = buildService();
    createAuthPassword.mockRejectedValue(new Error('the real cause'));
    model.deleteOne = jest.fn().mockRejectedValue(new Error('rollback also failed')) as any;

    // The caller needs to know why the account could not be made. Replacing that
    // with the cleanup's own error would hide it.
    await expect(service.registerNewUser(registerPayload())).rejects.toThrow('the real cause');
  });

  it('never publishes the account-created event for an account it rolled back', async () => {
    const { service, publish, createAuthPassword } = buildService();
    createAuthPassword.mockRejectedValue(new Error('boom'));

    await expect(service.registerNewUser(registerPayload())).rejects.toBeTruthy();

    // Listeners would otherwise act on an account that no longer exists.
    expect(publish).not.toHaveBeenCalled();
  });

  it('deletes by id, so the loser of a race cannot delete the winner', async () => {
    const { service, model } = buildService();
    model.preCheckAlwaysMisses = true;

    // The winner registers normally and keeps its credential.
    const winner = await service.registerNewUser(registerPayload());
    expect(model.documents).toHaveLength(1);

    // A second attempt for the same identity now fails at the unique index —
    // *before* any credential write, so compensation never runs. Even if it did,
    // it is keyed on the `_id` this attempt inserted, never on the email, which
    // is the property that makes it safe.
    await expect(service.registerNewUser(registerPayload())).rejects.toBeInstanceOf(EmailHasBeenTakenException);

    expect(model.documents).toHaveLength(1);
    expect(`${model.documents[0]._id}`).toBe(`${winner._id}`);
  });

  it('removes only the account of the attempt that failed', async () => {
    const { service, model, createAuthPassword } = buildService();

    // One good account already exists.
    const survivor = await service.registerNewUser(registerPayload());

    // A different registration then fails at its credential write.
    createAuthPassword.mockRejectedValue(new Error('boom'));
    await expect(service.registerNewUser(registerPayload({
      email: 'second@example.com',
      username: 'second'
    }))).rejects.toBeTruthy();

    expect(model.documents).toHaveLength(1);
    expect(`${model.documents[0]._id}`).toBe(`${survivor._id}`);
  });
});

/**
 * Changing an account's email address.
 *
 * Login refuses an unconfirmed account, so this transition is the one that can
 * silently lock somebody out of an account they own. Every assertion below is
 * about not doing that by accident — and about not *skipping* it when an
 * administrator genuinely did change the address.
 */
describe('an administrator changing an email address', () => {
  const CURRENT = 'visitor@example.com';

  async function existingAccount(overrides: Record<string, any> = {}) {
    const harness = buildService();
    await harness.service.createNewUserAccount(
      {
        email: CURRENT, username: 'visitor', name: 'Visitor', password: 'a'.repeat(64)
      } as any,
      { verifiedEmail: true }
    );
    harness.sendVerificationEmail.mockClear();
    harness.supersedeSiblings.mockClear();
    harness.removeAllUserTokens.mockClear();
    Object.assign(harness.model.documents[0], overrides);
    return { ...harness, userId: harness.model.documents[0]._id };
  }

  it('unsets the confirmation and mails the new address', async () => {
    const {
      service, model, userId, sendVerificationEmail
    } = await existingAccount();

    await service.adminUpdate(userId, { email: 'moved@example.com' } as any);

    expect(model.documents[0].email).toBe('moved@example.com');
    expect(model.documents[0].verifiedEmail).toBe(false);
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1);
    // The *new* address, never the old one.
    expect(sendVerificationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'moved@example.com' })
    );
  });

  it('treats a case-only edit as no change at all', async () => {
    const {
      service, model, userId, sendVerificationEmail
    } = await existingAccount();

    await service.adminUpdate(userId, { email: 'Visitor@Example.COM' } as any);

    // The stored address is already normalised, so comparing the raw payload
    // against it read a capitalisation edit as a new address — unsetting
    // `verifiedEmail` and locking the account out of a login it was entitled to.
    expect(model.documents[0].verifiedEmail).toBe(true);
    expect(model.documents[0].email).toBe(CURRENT);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('treats surrounding whitespace as no change either', async () => {
    const { service, model, userId, sendVerificationEmail } = await existingAccount();

    await service.adminUpdate(userId, { email: '  visitor@example.com  ' } as any);

    expect(model.documents[0].verifiedEmail).toBe(true);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('respects an administrator who vouches for the new address', async () => {
    const {
      service, model, userId, sendVerificationEmail, removeAllUserTokens
    } = await existingAccount();

    await service.adminUpdate(
      userId,
      { email: 'moved@example.com', verifiedEmail: true } as any
    );

    // Explicit intent in a trusted request. Field-assignment order must not
    // quietly turn this back into `false`.
    expect(model.documents[0].verifiedEmail).toBe(true);
    expect(model.documents[0].email).toBe('moved@example.com');
    expect(sendVerificationEmail).not.toHaveBeenCalled();
    expect(removeAllUserTokens).not.toHaveBeenCalled();
  });

  it('invalidates the links issued for the previous address', async () => {
    const { service, userId, supersedeSiblings } = await existingAccount();

    await service.adminUpdate(userId, { email: 'moved@example.com' } as any);

    expect(supersedeSiblings).toHaveBeenCalledWith({
      userId,
      type: 'email-verification'
    });
  });

  it('revokes live sessions, so an old claim cannot outlive the check that granted it', async () => {
    const { service, userId, removeAllUserTokens } = await existingAccount();

    await service.adminUpdate(userId, { email: 'moved@example.com' } as any);

    // Login now refuses this account. A session minted before the change would
    // otherwise keep working — the enforcement bypass this flow exists to close.
    expect(removeAllUserTokens).toHaveBeenCalledWith(userId);
  });

  it('leaves status, role and password alone', async () => {
    const {
      service, model, userId, createAuthPassword
    } = await existingAccount({ status: 'active', isAdmin: false });
    createAuthPassword.mockClear();

    await service.adminUpdate(userId, { email: 'moved@example.com' } as any);

    expect(model.documents[0].status).toBe('active');
    expect(model.documents[0].isAdmin).toBe(false);
    expect(createAuthPassword).not.toHaveBeenCalled();
  });

  it('keeps the account when the verification email cannot be queued', async () => {
    const {
      service, model, userId, sendVerificationEmail
    } = await existingAccount();
    sendVerificationEmail.mockRejectedValue(new Error('queue down'));

    await expect(service.adminUpdate(userId, { email: 'moved@example.com' } as any))
      .resolves.toBe(true);

    // The address change is the final state; a mail failure must not undo it.
    // The account stays unconfirmed with resend available.
    expect(model.documents[0].email).toBe('moved@example.com');
    expect(model.documents[0].verifiedEmail).toBe(false);
  });

  it('still reports success when session revocation fails', async () => {
    const { service, userId, removeAllUserTokens } = await existingAccount();
    removeAllUserTokens.mockRejectedValue(new Error('redis down'));

    await expect(service.adminUpdate(userId, { email: 'moved@example.com' } as any))
      .resolves.toBe(true);
  });

  it('does nothing to the confirmation when the update carries no email', async () => {
    const { service, model, userId, sendVerificationEmail } = await existingAccount();

    await service.adminUpdate(userId, { name: 'Renamed' } as any);

    expect(model.documents[0].verifiedEmail).toBe(true);
    expect(sendVerificationEmail).not.toHaveBeenCalled();
  });
});

/**
 * The self-service profile update must not be a way to change an address.
 *
 * `CreatorSelfUpdatePayload` declares no `email`, and the controller validates
 * with `whitelist: true`, so one arrives at the service only if somebody calls
 * it directly. This pins the payload's shape rather than trusting that nobody
 * will add the field later.
 */
describe('the self-service profile update', () => {
  it('has no email field to change', async () => {
    // eslint-disable-next-line global-require, @typescript-eslint/no-var-requires
    const { CreatorSelfUpdatePayload } = require('src/payloads/identity/user/user-self-update.payload');
    const instance = new CreatorSelfUpdatePayload();

    expect(Object.prototype.hasOwnProperty.call(instance, 'email')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(instance, 'verifiedEmail')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(instance, 'status')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(instance, 'isAdmin')).toBe(false);
  });
});
