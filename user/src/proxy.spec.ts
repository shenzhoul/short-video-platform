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
