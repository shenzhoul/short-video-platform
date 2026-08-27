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
}

function buildService() {
  const model = new FakeUserModel();
  const createAuthPassword = jest.fn().mockResolvedValue({});
  const publish = jest.fn().mockResolvedValue(undefined);

  const service = new UserAccountManagementService(
    model as any,
    { publish } as any,
    { createAuthPassword } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  return {
    service, model, createAuthPassword, publish
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
