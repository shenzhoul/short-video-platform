/**
 * What the edge does with the URLs that used to lead to a login page.
 *
 * Two properties matter and neither is visible from the React tests:
 *
 *  - `/auth/login` has no page behind it any more, so it must resolve to a
 *    *public* route with the dialog marker attached, by redirect — which
 *    replaces the navigation rather than stacking on it, so there is no history
 *    loop back into a route that no longer renders anything.
 *  - Protected routes are no longer intercepted here at all. The whole point of
 *    the change is that `/creator/publish` stays `/creator/publish` while the
 *    visitor signs in, and an edge redirect would throw that away before the
 *    page ever got to decide.
 */

const redirect = jest.fn((url: string) => ({ kind: 'redirect', url }));
const rewrite = jest.fn((url: URL) => ({ kind: 'rewrite', url, headers: { set: jest.fn() } }));

jest.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string) => redirect(url),
    rewrite: (url: URL) => rewrite(url)
  },
  userAgent: () => ({ device: { type: undefined } })
}));

let token: any = null;
jest.mock('next-auth/jwt', () => ({
  getToken: async () => token
}));

import { proxy } from './proxy';

function request(path: string) {
  return {
    nextUrl: new URL(`http://localhost:8081${path}`),
    headers: new Headers()
  } as any;
}

beforeEach(() => {
  token = null;
  redirect.mockClear();
  rewrite.mockClear();
});

describe('the retired /auth/login URL', () => {
  it('sends a signed-out visitor to the home page with the dialog marker', async () => {
    const result: any = await proxy(request('/auth/login'));

    expect(result.kind).toBe('redirect');
    expect(result.url).toBe('http://localhost:8081/?authModal=login');
  });

  it('sends a signed-in visitor to the home page with no dialog at all', async () => {
    token = { user: { _id: 'u1' } };

    const result: any = await proxy(request('/auth/login'));

    expect(result.url).toBe('http://localhost:8081/');
  });

  /**
   * `/auth/forgot-password` never rendered anything.
   *
   * Audited against git history and the API before this redirect was added:
   * no page ever existed under `user/src/app/auth/` beyond `layout`, `login`,
   * `logout` and the OAuth callback; the old login form's "Forgot password?"
   * link pointed at a route that resolved to not-found; and the API exposes no
   * forgot or reset endpoint at all (`POST /auth/forgot` answers 404). So this
   * redirect replaces a dead link with a working one — it removes nothing.
   *
   * If a real reset flow is ever built, this expectation is what should fail.
   */
  it('does the same for the retired forgot-password URL, which never had a page', async () => {
    const result: any = await proxy(request('/auth/forgot-password'));

    expect(result.url).toBe('http://localhost:8081/?authModal=login');
  });
});

/**
 * The two routes reached from a link in an email.
 *
 * Whoever follows one is, by definition, somebody who cannot sign in — they have
 * either not confirmed their address or forgotten their password. Any redirect
 * here, in either session state, strands them.
 *
 * The signed-in cases matter as much as the signed-out ones: a visitor who
 * confirms a second account, or resets a password while a session from another
 * device is still live, must still reach the page rather than being bounced to
 * the home page.
 */
describe('public token routes', () => {
  it.each([
    '/auth/verify-email',
    '/auth/reset-password'
  ])('lets a signed-out visitor through to %s', async (pathname) => {
    const result: any = await proxy(request(pathname));

    expect(redirect).not.toHaveBeenCalled();
    expect(result.kind).toBe('rewrite');
    expect(result.url.pathname).toBe(pathname);
  });

  it.each([
    '/auth/verify-email',
    '/auth/reset-password'
  ])('lets a signed-in visitor through to %s too', async (pathname) => {
    token = { user: { _id: 'u1' } };

    const result: any = await proxy(request(pathname));

    expect(redirect).not.toHaveBeenCalled();
    expect(result.kind).toBe('rewrite');
    expect(result.url.pathname).toBe(pathname);
  });

  it('keeps the token in the query string', async () => {
    const result: any = await proxy(request('/auth/verify-email?token=abc123'));

    // The page reads it from `useSearchParams` and posts it to the API. Losing
    // it here would turn every confirmation link into an "invalid link" page.
    expect(result.url.searchParams.get('token')).toBe('abc123');
  });

  it('is not confused with the retired forgot-password URL', async () => {
    // `/auth/forgot-password` is a *different* path: it never had a page and is
    // redirected into the dialog. `/auth/reset-password` is a real page.
    const retired: any = await proxy(request('/auth/forgot-password'));
    const real: any = await proxy(request('/auth/reset-password'));

    expect(retired.url).toBe('http://localhost:8081/?authModal=login');
    expect(real.kind).toBe('rewrite');
  });
});

describe('the retired /auth/logout URL', () => {
  it('redirects to the home page', async () => {
    const result: any = await proxy(request('/auth/logout'));

    expect(result.kind).toBe('redirect');
    expect(result.url).toBe('http://localhost:8081/');
  });

  it('does the same for a signed-in visitor', async () => {
    token = { user: { _id: 'u1' } };

    const result: any = await proxy(request('/auth/logout'));

    expect(result.url).toBe('http://localhost:8081/');
  });

  it('carries no auth-dialog marker — this is not a login prompt', async () => {
    const result: any = await proxy(request('/auth/logout'));

    // `/auth/login` lands on `/?authModal=login`. `/auth/logout` must not: a
    // bookmark that used to sign somebody out should leave them on the home
    // page, not stare a login form at them.
    expect(result.url).not.toContain('authModal');
  });

  /**
   * The page this replaced ran `signOut()` from a `useEffect`, which made a
   * plain GET perform a state change — reachable by a prefetch, a crawler, or an
   * `<img src>`. The redirect below performs no logout at all; signing out
   * happens only through the Logout control or `endExpiredSession`.
   */
  it('performs no session revoke — a GET must not change state', async () => {
    token = { user: { _id: 'u1' } };

    const result: any = await proxy(request('/auth/logout'));

    // A redirect and nothing else: no rewrite, no cookie clearing, no call out.
    expect(result.kind).toBe('redirect');
    expect(rewrite).not.toHaveBeenCalled();
  });
});

describe('protected routes', () => {
  it('are no longer redirected away from at the edge', async () => {
    const result: any = await proxy(request('/creator/publish'));

    // The page itself checks the session and renders `AuthRequiredGate`, which
    // opens the dialog over this exact URL.
    expect(redirect).not.toHaveBeenCalled();
    expect(result.kind).toBe('rewrite');
    expect(result.url.pathname).toBe('/creator/publish');
  });

  it('keep the query string they were requested with', async () => {
    const result: any = await proxy(request('/creator/publish/video?enter_from=draft'));

    expect(redirect).not.toHaveBeenCalled();
    expect(result.url.searchParams.get('enter_from')).toBe('draft');
  });

  it('are still rewritten normally for a signed-in visitor', async () => {
    token = { user: { _id: 'u1' } };

    const result: any = await proxy(request('/messages'));

    expect(result.kind).toBe('rewrite');
    expect(result.url.pathname).toBe('/messages');
  });
});

describe('ordinary pages', () => {
  it('are rewritten with the viewport hint, as before', async () => {
    const result: any = await proxy(request('/for-you'));

    expect(result.kind).toBe('rewrite');
    expect(result.url.searchParams.get('viewport')).toBe('desktop');
  });
});
