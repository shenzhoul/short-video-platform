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

/** A response whose `cookies.set` is observable, like the real one. */
const makeResponse = (base: Record<string, unknown>) => {
  const setCookies: any[] = [];
  return {
    ...base,
    setCookies,
    headers: { set: jest.fn() },
    cookies: { set: (options: any) => {
 setCookies.push(options);
} }
  };
};

const redirect = jest.fn((url: string) => makeResponse({ kind: 'redirect', url }));
const rewrite = jest.fn((url: URL, init?: any) => makeResponse({ kind: 'rewrite', url, init }));

jest.mock('next/server', () => ({
  NextResponse: {
    redirect: (url: string) => redirect(url),
    rewrite: (url: URL, init?: any) => rewrite(url, init)
  },
  userAgent: () => ({ device: { type: undefined } })
}));

let token: any = null;
jest.mock('next-auth/jwt', () => ({
  getToken: async () => token
}));

import { readdirSync } from 'fs';
import { join, relative, sep } from 'path';

import { config, proxy } from './proxy';

/**
 * A request with a mutable cookie jar, as `NextRequest` has. `cookies.set` on
 * the *request* is what makes an issued value visible to this request's own
 * server render rather than only to the next one.
 */
function request(path: string, cookies: Record<string, string> = {}) {
  const jar = new Map(Object.entries(cookies));
  return {
    nextUrl: new URL(`http://localhost:8081${path}`),
    headers: new Headers(),
    cookies: {
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
      set: (name: string, value: string) => {
 jar.set(name, value);
},
      jar
    }
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

/**
 * The guest recommendation subject, issued before anything renders.
 *
 * A feed session belongs to the subject that created it. Issuing this id from
 * the client meant the *first* server render had no subject, built a throwaway
 * session, and the client then abandoned it — two sessions for one page load,
 * and a Home feed of 78-86 cards against a 70-item policy. Every test here
 * fails against that arrangement, because none of it existed.
 */
describe('the guest recommendation-subject cookie', () => {
  const KEY = 'douyin-clone-reco-anonymous-id';

  it('is issued on a first-ever request', async () => {
    const result: any = await proxy(request('/'));

    expect(result.setCookies).toHaveLength(1);
    expect(result.setCookies[0]).toEqual(expect.objectContaining({
      name: KEY, path: '/', sameSite: 'lax', httpOnly: false
    }));
    expect(result.setCookies[0].maxAge).toBeGreaterThan(0);
  });

  it('is visible to this request\'s own server render, not only the next one', async () => {
    const req = request('/');
    const result: any = await proxy(req);

    // Set on the *request* jar…
    const issued = req.cookies.get(KEY)?.value;
    expect(issued).toBeTruthy();
    // …and the rewrite forwards the request headers so the render sees it.
    expect(result.init).toEqual(expect.objectContaining({ request: expect.anything() }));
    // …and the same value is what the browser is told to keep.
    expect(result.setCookies[0].value).toBe(issued);
  });

  it('issues an opaque token, not anything derived from the request', async () => {
    const first: any = await proxy(request('/'));
    const second: any = await proxy(request('/'));

    const a = first.setCookies[0].value;
    const b = second.setCookies[0].value;
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it('leaves an existing valid id alone, so a returning guest keeps one subject', async () => {
    const existing = '11111111-2222-4333-8444-555555555555';
    const result: any = await proxy(request('/', { [KEY]: existing }));

    expect(result.setCookies).toHaveLength(0);
    expect(rewrite).toHaveBeenCalled();
  });

  it('replaces a value outside the accepted shape rather than trusting it', async () => {
    // This becomes a Redis key segment and a session owner.
    const rejected = ['short', 'has spaces here', `${'x'.repeat(200)}`, 'colon:separated'];
    for (const value of rejected) {

      const result: any = await proxy(request('/', { [KEY]: value }));
      expect(result.setCookies).toHaveLength(1);
      expect(result.setCookies[0].value).not.toBe(value);
    }
  });

  it('attaches the cookie to redirects too, so the id is not lost at the edge', async () => {
    const result: any = await proxy(request('/auth/login'));

    expect(result.kind).toBe('redirect');
    expect(result.setCookies).toHaveLength(1);
    expect(result.setCookies[0].name).toBe(KEY);
  });

  it('never issues a subject shared between visitors', async () => {
    const seen = new Set<string>();
    for (let index = 0; index < 25; index += 1) {

      const result: any = await proxy(request('/'));
      seen.add(result.setCookies[0].value);
    }
    expect(seen.size).toBe(25);
    expect([...seen]).not.toContain('guest');
  });
});

/**
 * What the edge is allowed to run on at all.
 *
 * These assert the exported `config.matcher`, not the handler. A matcher defect
 * is invisible to every test that calls `proxy()` directly — the handler is
 * correct and simply never runs, or runs where it must not. Both directions
 * have a cost that only shows in production:
 *
 *  - too narrow, and a page renders with no recommendation subject
 *  - too wide, and every image in `public/` gets `Cache-Control: no-store`
 *    plus a `getToken()` JWT decrypt, which is what shipped before this.
 */
describe('the proxy matcher', () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  const runsOn = (path: string) => matcher.test(path);

  describe('does not run on static assets', () => {
    /*
     * Read the real directory rather than a hand-written list. Dropping a
     * `.woff2` or an `.mp4` into `public/` and forgetting the matcher is
     * exactly the regression this is here to catch, and a literal list would
     * happily keep passing.
     */
    const publicDir = join(__dirname, '..', 'public');
    const assets = readdirSync(publicDir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => `/${relative(publicDir, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/')}`);

    it('finds the assets it is meant to be checking', () => {
      // Guards the guard: a glob that silently matched nothing would make every
      // assertion below vacuously true.
      expect(assets.length).toBeGreaterThan(10);
      expect(assets).toContain('/no_avatar.jpeg');
      expect(assets).toContain('/icons/ic_camera.svg');
    });

    it.each(assets)('leaves %s to the CDN', (asset) => {
      expect(runsOn(asset)).toBe(false);
    });
  });

  it.each([
    '/_next/static/chunks/main.js',
    '/_next/image?url=%2Fno_avatar.jpeg',
    '/api/auth/session',
    '/favicon.ico',
    '/robots.txt',
    '/sitemap.xml'
  ])('does not run on %s', (path) => {
    expect(runsOn(path)).toBe(false);
  });

  /**
   * The half a generic `\.[\w]+$` rule would have broken. Creator profiles are
   * a root-level `/[creator]` segment and every seeded username contains a dot,
   * so an extension-shaped exclusion silently swallows the entire creator
   * namespace: no subject cookie, no viewport hint, and nothing logged.
   */
  it.each([
    '/maitran.eats',
    '/diego.streetbites',
    '/elena.offmap',
    '/kai.wanders',
    '/marcus.sixstring',
    '/yuki.homestudio',
    '/priya.moves',
    '/owen.fosters',
    '/noor.thread',
    '/sofia.builds',
    '/iris.inthefield',
    '/tomasberg.plays',
    '/hana.inks',
    '/adrien.onset',
    '/camille.everyday',
    '/hannah.andco'
  ])('still runs on the creator profile %s', (path) => {
    expect(runsOn(path)).toBe(true);
  });

  it.each([
    '/',
    '/for-you',
    '/following',
    '/friend',
    '/search',
    '/messages',
    '/creator/publish/video',
    '/auth/verify-email',
    '/auth/reset-password'
  ])('still runs on %s', (path) => {
    expect(runsOn(path)).toBe(true);
  });
});

/**
 * Headers as they actually leave the edge.
 *
 * The cookie tests above prove the *value* is right. These prove the response
 * carries what it should and nothing it should not — in particular that a
 * returning visitor with a valid subject gets no `Set-Cookie` at all, on any
 * kind of response, rather than having it replayed on every request.
 */
describe('the response the proxy returns', () => {
  const KEY = 'douyin-clone-reco-anonymous-id';
  const valid = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

  it('marks a page render uncacheable, because it is per-visitor', async () => {
    const result: any = await proxy(request('/'));

    expect(result.headers.set).toHaveBeenCalledWith(
      'Cache-Control',
      'no-store, no-cache, must-revalidate, proxy-revalidate'
    );
  });

  it.each([
    ['an ordinary page', '/'],
    ['a creator profile', '/maitran.eats'],
    ['a public token route', '/auth/verify-email'],
    ['a redirect', '/auth/login']
  ])('replays no Set-Cookie for a returning visitor on %s', async (_label, path) => {
    const result: any = await proxy(request(path, { [KEY]: valid }));

    expect(result.setCookies).toHaveLength(0);
  });

  it('forwards the request headers so the server render sees this request\'s subject', async () => {
    await proxy(request('/'));

    const [, init] = rewrite.mock.calls[0];
    expect(init).toEqual({ request: { headers: expect.any(Headers) } });
  });
});
