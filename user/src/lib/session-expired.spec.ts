/**
 * The involuntary half of signing out.
 *
 * A 401 on an API call, a deactivated account, a socket the server hung up on.
 * All of these used to navigate to `/auth/logout` and let that page do the
 * revoke; the page is gone, so this module does it instead.
 *
 * It reloads on purpose, unlike the Logout button. It runs from places with no
 * router — `api-request.ts` is shared with server rendering, and socket handlers
 * fire outside React — and the session is already dead, so every piece of client
 * cache built from it is stale.
 */

const signOut = jest.fn();
jest.mock('next-auth/react', () => ({ signOut: (...args: any[]) => signOut(...args) }));

const cookieRemove = jest.fn();
jest.mock('js-cookie', () => ({ __esModule: true, default: { remove: (...args: any[]) => cookieRemove(...args) } }));

import { endExpiredSession, resetExpiredSessionState } from './session-expired';

const originalLocation = window.location;
let replace: jest.Mock;

beforeEach(() => {
  signOut.mockReset().mockResolvedValue(undefined);
  cookieRemove.mockReset();
  resetExpiredSessionState();

  replace = jest.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, replace, href: 'http://localhost:8081/messages' }
  });
});

afterAll(() => {
  Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
});

describe('ending a rejected session', () => {
  it('revokes through NextAuth rather than only clearing cookies', async () => {
    await endExpiredSession();

    // The `signOut` event in `auth-options.ts` is what calls the API's logout
    // endpoint. Removing the cookie alone would leave a live token behind.
    expect(signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it('clears the local API token', async () => {
    await endExpiredSession();

    expect(cookieRemove).toHaveBeenCalledWith('token');
  });

  it('lands on the home page, replacing history', async () => {
    await endExpiredSession();

    // `replace`, so Back does not return to the page that just 401ed.
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('never navigates to the retired logout page', async () => {
    await endExpiredSession();

    expect(replace.mock.calls.flat()).not.toContain('/auth/logout');
  });
});

describe('when several requests fail at once', () => {
  it('signs out once and navigates once', async () => {
    // A single failed render can produce several 401s together — the profile
    // load, a feed request and a notification poll all rejecting at the same
    // time. Each one calls this.
    await Promise.all([endExpiredSession(), endExpiredSession(), endExpiredSession()]);

    expect(signOut).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledTimes(1);
  });
});

describe('when the revoke round trip fails', () => {
  it('still clears the token and gets the visitor off the dead page', async () => {
    signOut.mockRejectedValue(new Error('network down'));

    await endExpiredSession();

    // Unlike the Logout button, refusing to navigate here would strand somebody
    // on a page that cannot load — the server has already rejected them, and
    // NextAuth clears its own cookie regardless.
    expect(cookieRemove).toHaveBeenCalledWith('token');
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('does not reject, so callers already handling an error are not doubled up', async () => {
    signOut.mockRejectedValue(new Error('network down'));

    await expect(endExpiredSession()).resolves.toBeUndefined();
  });
});
