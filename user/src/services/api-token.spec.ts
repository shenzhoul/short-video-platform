/**
 * The Authorization header must be populated from the first authenticated
 * request of a session, not from the second.
 *
 * Regression cover for a production 403: the next-auth session reached
 * `authenticated` while the `token` cookie was still unwritten, because the
 * bridge wrote it from a `useEffect` that React runs AFTER the effects of the
 * children consuming it. `GET /notifications/unread-count` went out with an
 * empty header and was refused — silently, since the badge refresher swallows
 * its errors.
 */
import cookie from 'js-cookie';

import { getApiAuthToken, hasApiAuthToken, setApiAuthToken } from '@services/api-request';

jest.mock('js-cookie', () => ({
  __esModule: true,
  default: { get: jest.fn(), set: jest.fn(), remove: jest.fn() }
}));

const cookieGet = cookie.get as unknown as jest.Mock;

describe('api auth token', () => {
  beforeEach(() => {
    setApiAuthToken(null);
    cookieGet.mockReset();
    cookieGet.mockReturnValue(undefined);
  });

  it('is empty before anything sets it', () => {
    expect(getApiAuthToken()).toBe('');
    expect(hasApiAuthToken()).toBe(false);
  });

  it('is available immediately after the session publishes it, with no cookie written yet', () => {
    // Exactly the failing window: the bridge has run its render, the cookie
    // effect has not.
    setApiAuthToken('session-token');
    expect(cookieGet).not.toHaveBeenCalledWith('token');
    expect(getApiAuthToken()).toBe('session-token');
    expect(hasApiAuthToken()).toBe(true);
  });

  it('falls back to the cookie across a reload, when memory is empty', () => {
    cookieGet.mockReturnValue('cookie-token');
    expect(getApiAuthToken()).toBe('cookie-token');
    expect(hasApiAuthToken()).toBe(true);
  });

  it('prefers the in-memory token over a stale cookie', () => {
    cookieGet.mockReturnValue('stale-cookie-token');
    setApiAuthToken('fresh-session-token');
    expect(getApiAuthToken()).toBe('fresh-session-token');
  });

  it('stops authenticating once cleared, even though a cookie may linger', () => {
    setApiAuthToken('session-token');
    setApiAuthToken(null);
    // Logout clears the cookie too; this asserts the memory half specifically,
    // so a cleared session cannot keep authenticating from memory.
    expect(getApiAuthToken()).toBe('');
    expect(hasApiAuthToken()).toBe(false);
  });

  it('treats an empty string as no token rather than a valid one', () => {
    setApiAuthToken('');
    expect(getApiAuthToken()).toBe('');
    expect(hasApiAuthToken()).toBe(false);
  });
});
