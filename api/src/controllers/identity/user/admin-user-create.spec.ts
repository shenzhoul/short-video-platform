// `src/payloads` reaches `isomorphic-dompurify`, an ESM package Jest cannot parse
// under this project's CommonJS transform. Stubbed as elsewhere in the suite.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

import { ValidationPipe } from '@nestjs/common';
import { ObjectId } from 'mongodb';

import { USER_STATUS } from 'src/common/constants/identity';
import { RoleGuard } from 'src/common/guards';
import { AdminUserCreatePayload } from 'src/payloads';
import { UserAccountManagementService } from 'src/services/identity/user/user.service';
import { AdminUserController } from './admin-user.controller';

/**
 * Who gets to decide what kind of account is created.
 *
 * An administrator legitimately creates suspended and under-review accounts —
 * the form has a Status selector for it — and that choice used to be discarded:
 * `createNewUserAccount` overwrote `status` with `active` regardless, so an
 * admin who suspended an account on creation got a working one with no error.
 *
 * The fix is a trust boundary, not a merge. `data` is request-shaped and its
 * `status` is ignored; `intent` is stated by the caller in its own code. This
 * route may state one because `RoleGuard` has already established who is asking.
 * Public registration states `ACTIVE` and never consults the request.
 */

const pipe = new ValidationPipe({ transform: true, whitelist: true });
const metadata = { type: 'body' as const, metatype: AdminUserCreatePayload };

interface Written {
  status?: string;
  isAdmin?: boolean;
  verifiedEmail?: boolean;
  email?: string;
  username?: string;
}

function buildController() {
  const written: Written[] = [];
  const createAuthPassword = jest.fn().mockResolvedValue({});

  const model: any = {
    db: { collection: () => ({ countDocuments: async () => 0 }) },
    create: async (doc: any) => {
      const { password, ...persisted } = doc;
      const stored = { _id: new ObjectId(), ...persisted };
      written.push(stored);
      return stored;
    }
  };

  const sendVerificationEmail = jest.fn().mockResolvedValue(undefined);

  const service = new UserAccountManagementService(
    model,
    { publish: jest.fn().mockResolvedValue(undefined) } as any,
    { createAuthPassword } as any,
    null as any, null as any, null as any, null as any,
    // A fake mail service. Nothing in this repository's test suite opens a
    // connection to a mail server; see `mail-provider.spec.ts`.
    { sendVerificationEmail } as any,
    { supersedeSiblings: jest.fn().mockResolvedValue(0) } as any
  );

  const controller = new AdminUserController(service, null as any);

  return {
    controller, service, written, createAuthPassword, sendVerificationEmail
  };
}

function adminBody(overrides: Record<string, any> = {}) {
  return {
    email: 'managed@example.com',
    username: 'managed99',
    name: 'Managed User',
    firstName: 'Man',
    lastName: 'Aged',
    gender: 'female',
    status: USER_STATUS.ACTIVE,
    password: 'a'.repeat(64),
    ...overrides
  };
}

/** Runs the real pipe, then the real controller, then the real service. */
async function createAsAdmin(body: Record<string, any>) {
  const harness = buildController();
  const validated: any = await pipe.transform(body, metadata);
  const response = await harness.controller.createUser(validated);
  return { ...harness, response, validated };
}

describe('an admin gets the status they chose', () => {
  it.each([
    [USER_STATUS.ACTIVE],
    [USER_STATUS.INACTIVE],
    [USER_STATUS.UNDER_REVIEW],
    [USER_STATUS.DELETED]
  ])('persists %s', async (status) => {
    const { written } = await createAsAdmin(adminBody({ status }));

    expect(written).toHaveLength(1);
    expect(written[0].status).toBe(status);
  });

  it('reports the chosen status back in the response', async () => {
    const { response } = await createAsAdmin(adminBody({ status: USER_STATUS.INACTIVE }));

    expect((response.data as any).status).toBe(USER_STATUS.INACTIVE);
  });

  it('falls back to active when no status is sent', async () => {
    const { written } = await createAsAdmin(adminBody({ status: undefined }));

    // The payload marks it required, so this is the service's own default rather
    // than a route that silently accepts a gap — but the default must still be
    // the safe one.
    expect(written[0].status).toBe(USER_STATUS.ACTIVE);
  });

  it('refuses an invalid status without creating anything', async () => {
    const harness = buildController();

    await expect(pipe.transform(adminBody({ status: 'whatever' }), metadata)).rejects.toThrow();

    expect(harness.written).toHaveLength(0);
    expect(harness.createAuthPassword).not.toHaveBeenCalled();
  });

  it('still writes exactly one credential, through the shared path', async () => {
    const { createAuthPassword, written } = await createAsAdmin(adminBody());

    // This route used to call `createAuthPassword` a second time after
    // `createNewUserAccount` had already stored the credential — the same hash
    // written twice, with a second salt, for nothing.
    expect(createAuthPassword).toHaveBeenCalledTimes(1);
    expect(createAuthPassword).toHaveBeenCalledWith({
      userId: written[0] && (written[0] as any)._id,
      type: 'password',
      value: 'a'.repeat(64),
      key: 'managed@example.com'
    });
  });
});

describe('a public registration cannot borrow any of that', () => {
  it('is forced to an ordinary active account whatever it sends', async () => {
    const harness = buildController();

    await harness.service.registerNewUser({
      email: 'visitor@example.com',
      username: 'visitor99',
      name: 'Visitor',
      password: 'b'.repeat(64),
      // Everything a hostile client might try.
      status: USER_STATUS.INACTIVE,
      isAdmin: true,
      isCreator: true,
      verifiedEmail: true
    } as any);

    const [created] = harness.written;
    expect(created.status).toBe(USER_STATUS.ACTIVE);
    expect(created.isAdmin).toBe(false);
    expect(created.verifiedEmail).toBe(false);
  });

  it('cannot reach the admin status path by putting status in the body', async () => {
    const harness = buildController();

    // The service reads status from `intent`, never from `data` — so even a
    // direct service call with a status-bearing payload is ignored.
    await harness.service.createNewUserAccount({
      email: 'sneaky@example.com',
      username: 'sneaky99',
      status: USER_STATUS.INACTIVE
    } as any);

    expect(harness.written[0].status).toBe(USER_STATUS.ACTIVE);
  });

  it('honours an explicit intent, which only server code can state', async () => {
    const harness = buildController();

    await harness.service.createNewUserAccount(
      { email: 'managed@example.com', username: 'managed99' } as any,
      { status: USER_STATUS.UNDER_REVIEW }
    );

    expect(harness.written[0].status).toBe(USER_STATUS.UNDER_REVIEW);
  });
});

describe('the admin route stays admin-only', () => {
  it('still declares the admin role and the guard', () => {
    const handler = AdminUserController.prototype.createUser;

    expect(Reflect.getMetadata('roles', handler)).toEqual(['admin']);
    expect(Reflect.getMetadata('__guards__', handler)).toContain(RoleGuard);
  });
});

describe('compensation on a failed credential write', () => {
  it('surfaces the failure rather than reporting a usable account', async () => {
    const harness = buildController();
    (harness as any).createAuthPassword.mockRejectedValue(new Error('credential store down'));

    const validated: any = await pipe.transform(adminBody(), metadata);

    // The user row is written before the credential — that ordering is existing
    // behaviour and is not changed here. What matters is that the caller is told,
    // rather than handed a profile for an account nobody can sign in to.
    await expect(harness.controller.createUser(validated)).rejects.toThrow('credential store down');
  });
});
