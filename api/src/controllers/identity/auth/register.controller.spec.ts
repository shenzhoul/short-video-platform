// `src/payloads` reaches `isomorphic-dompurify` — an ESM package Jest cannot parse under this
// project's CommonJS transform. Stubbed exactly as `admin-category.controller.spec.ts` stubs it.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

import { ValidationPipe } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import { RoleGuard } from 'src/common/guards';
import { AdminUserController } from 'src/controllers/identity/user/admin-user.controller';
import { RegisterPayload } from 'src/payloads/identity';
import { RegisterController } from './register.controller';

/**
 * Every field the public payload is allowed to carry, in full.
 *
 * Pinned as a literal rather than derived, so growing `UserCreatePayload` — or
 * changing the pick list — fails here and has to be a decision rather than an
 * accident on an unauthenticated endpoint.
 */
const PUBLIC_FIELDS = ['email', 'firstName', 'gender', 'lastName', 'name', 'password', 'username'];

/** Fields a request must never be able to set, whatever it sends. */
const INTERNAL_FIELDS = {
  isAdmin: true,
  isCreator: true,
  status: 'inactive',
  verifiedEmail: true,
  role: 'admin',
  roles: ['admin'],
  permissions: ['*'],
  balance: 999999,
  // Declared on the shared base class but not on the signup form, so the public
  // payload does not accept it either.
  dateOfBirth: '1990-01-01'
};

/**
 * The public registration endpoint's boundary.
 *
 * Two separate things are proved here, and they are separate on purpose:
 *
 *  - What the *pipe* lets through. The service allow-lists again, but if a field
 *    reaches it at all then a single future refactor of the service is enough to
 *    make it live. `whitelist: true` against a payload with no role and no
 *    status is the outer wall.
 *  - That opening this route did not soften the admin one. Registration exists
 *    precisely so `POST /admin/users` never has to be opened up, so the guard
 *    metadata on that handler is asserted here rather than assumed.
 */

// The same options the controller declares. Constructed independently so the
// test fails if the controller ever drops `whitelist`.
const pipe = new ValidationPipe({ transform: true, whitelist: true });
const metadata = { type: 'body' as const, metatype: RegisterPayload };

/** A registration body a real client would send. */
function validBody(overrides: Record<string, any> = {}) {
  return {
    email: 'visitor@example.com',
    username: 'visitor99',
    name: 'Visitor',
    firstName: 'Vis',
    lastName: 'Itor',
    gender: 'female',
    password: 'a'.repeat(64),
    ...overrides
  };
}

describe('registration payload boundary', () => {
  it('declares exactly the fields the signup form renders, and nothing else', async () => {
    const result: any = await pipe.transform(validBody(), metadata);

    // `PickType` is an allow-list: the shape *has* no other property, so a field
    // added to `UserCreatePayload` later cannot become part of this endpoint.
    expect(Object.keys(result).sort()).toEqual(PUBLIC_FIELDS);
  });

  it('leaves the optional profile fields optional', async () => {
    // Only email, username and password are required; the rest of the
    // allow-list keeps whatever optionality `UserCreatePayload` gave it, so a
    // narrower future form does not need a payload change.
    const result: any = await pipe.transform({
      email: 'visitor@example.com',
      username: 'visitor99',
      password: 'a'.repeat(64)
    }, metadata);

    expect(Object.keys(result).sort()).toEqual(['email', 'password', 'username']);
  });

  it('accepts an ordinary registration', async () => {
    const result: any = await pipe.transform(validBody(), metadata);

    expect(result).toBeInstanceOf(RegisterPayload);
    expect(result.username).toBe('visitor99');
    expect(result.email).toBe('visitor@example.com');
  });

  it('strips role, status and internal flags before the controller sees them', async () => {
    const result: any = await pipe.transform(validBody(INTERNAL_FIELDS), metadata);

    // This project's convention is `whitelist: true` without
    // `forbidNonWhitelisted` — the global pipe in `main.ts` sets neither, and
    // every controller that opts in uses whitelist alone. So the contract to
    // prove is *stripping*, not rejection: the request succeeds and the extra
    // fields are simply not there.
    expect(Object.keys(result).sort()).toEqual(PUBLIC_FIELDS);
    Object.keys(INTERNAL_FIELDS).forEach((field) => {
      expect(result[field]).toBeUndefined();
    });
  });

  it('does not reject the request for sending them, matching the repo pipe convention', async () => {
    // Recorded deliberately. If `forbidNonWhitelisted` is ever adopted
    // repo-wide, this expectation is the one that should flip — and a failure
    // here is the reminder to update the client, which currently sends only the
    // allow-listed fields but is not obliged to.
    await expect(pipe.transform(validBody(INTERNAL_FIELDS), metadata)).resolves.toBeDefined();
  });

  it('applies the same username rules the admin create form validates against', async () => {
    // Reserved route names are refused by `AdvancedUsername`, which is inherited
    // from `UserCreatePayload` rather than restated here.
    await expect(pipe.transform(validBody({ username: 'admin' }), metadata)).rejects.toThrow();
    await expect(pipe.transform(validBody({ username: 'a' }), metadata)).rejects.toThrow();
    await expect(pipe.transform(validBody({ username: 'has space' }), metadata)).rejects.toThrow();
  });

  it('requires an email, a username and a password', async () => {
    await expect(pipe.transform(validBody({ email: undefined }), metadata)).rejects.toThrow();
    await expect(pipe.transform(validBody({ email: 'not-an-email' }), metadata)).rejects.toThrow();
    await expect(pipe.transform(validBody({ username: undefined }), metadata)).rejects.toThrow();
    await expect(pipe.transform(validBody({ password: undefined }), metadata)).rejects.toThrow();
    await expect(pipe.transform(validBody({ password: 'short' }), metadata)).rejects.toThrow();
  });

  it('rejects a gender outside the supported values', async () => {
    await expect(pipe.transform(validBody({ gender: 'anything' }), metadata)).rejects.toThrow();
    await expect(pipe.transform(validBody({ gender: 'female' }), metadata)).resolves.toBeDefined();
  });
});

describe('a hostile request, from the wire to the stored document', () => {
  /**
   * The whole boundary in one pass: the real pipe, the real controller, the real
   * service, and a model that records what would be written.
   *
   * The payload test above proves the *shape* refuses the fields. This proves
   * nothing downstream puts them back — that the service's own allow-list and
   * its forced values hold even when every layer above is handed a request
   * asking for an admin account.
   */
  async function registerThroughTheStack(body: Record<string, any>) {
    // Required lazily: `user.service` reaches the payload barrel, and importing
    // it at module scope would pull `isomorphic-dompurify` into the two
    // payload-only describes above for no reason.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { UserAccountManagementService } = require('src/services/identity/user/user.service');

    const written: Record<string, any>[] = [];
    const model: any = {
      db: { collection: () => ({ countDocuments: async () => 0 }) },
      create: async (doc: any) => {
        const { password, ...persisted } = doc;
        const stored = { _id: new ObjectId(), ...persisted };
        written.push(stored);
        return stored;
      }
    };

    const service = new UserAccountManagementService(
      model,
      { publish: jest.fn().mockResolvedValue(undefined) },
      { createAuthPassword: jest.fn().mockResolvedValue({}) },
      {}, {}, {}, {}
    );
    const registerNewUser = jest.spyOn(service, 'registerNewUser');

    const controller = new RegisterController(service);
    const validated: any = await pipe.transform(body, metadata);
    const response = await controller.register(validated);

    return {
      response, written, registerNewUser, validated
    };
  }

  it('never lets an internal field reach the service', async () => {
    const { registerNewUser } = await registerThroughTheStack(validBody(INTERNAL_FIELDS));

    const received = registerNewUser.mock.calls[0][0] as Record<string, any>;
    expect(Object.keys(received).sort()).toEqual(PUBLIC_FIELDS);
  });

  it('stores an ordinary, active, unverified account regardless of what was asked for', async () => {
    const { written } = await registerThroughTheStack(validBody(INTERNAL_FIELDS));

    expect(written).toHaveLength(1);
    const [document] = written;
    // The three that matter, whatever the request said.
    expect(document.isAdmin).toBe(false);
    expect(document.status).toBe('active');
    expect(document.verifiedEmail).toBe(false);
    // And nothing else the request tried to smuggle in.
    expect(document.isCreator).toBeUndefined();
    expect(document.role).toBeUndefined();
    expect(document.roles).toBeUndefined();
    expect(document.permissions).toBeUndefined();
    expect(document.balance).toBeUndefined();
    expect(document.dateOfBirth).toBeUndefined();
  });

  it('does not leak the credential or the internal flags back in the response', async () => {
    const { response } = await registerThroughTheStack(validBody(INTERNAL_FIELDS));

    const profile = response.data as Record<string, any>;
    expect(profile.password).toBeUndefined();
    expect(profile.isAdmin).toBeUndefined();
    expect(profile.status).toBe('active');
    expect(profile.verifiedEmail).toBe(false);
  });
});

describe('registration does not weaken admin user creation', () => {
  it('leaves POST /admin/users behind the admin role guard', () => {
    const handler = AdminUserController.prototype.createUser;

    expect(Reflect.getMetadata('roles', handler)).toEqual(['admin']);
    expect(Reflect.getMetadata('__guards__', handler)).toContain(RoleGuard);
  });

  it('leaves the public route unguarded by role, which is the point of it existing', () => {
    const handler = RegisterController.prototype.register;

    expect(Reflect.getMetadata('roles', handler)).toBeUndefined();
    expect(Reflect.getMetadata('__guards__', handler) || []).not.toContain(RoleGuard);
  });
});
