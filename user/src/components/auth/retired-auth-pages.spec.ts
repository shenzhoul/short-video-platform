import fs from 'fs';
import path from 'path';

/**
 * `/auth/login` and `/auth/logout` are gone from the user app, and this is the
 * guard that keeps them gone.
 *
 * Both were replaced by the shared dialog and by `useLogout`. The risk is not
 * that somebody rebuilds the pages deliberately — it is that a new feature
 * reaches for `router.push('/auth/login')` or
 * `window.location.href = '/auth/logout'` because that is what the codebase used
 * to do, and nothing complains until a user hits a redirect they did not expect.
 *
 * The check is over source text rather than behaviour on purpose: it catches the
 * reference wherever it appears, including in a file that has no test of its own.
 */

const SRC = path.resolve(__dirname, '../..');

/** Files that may legitimately mention the retired paths, and why. */
const ALLOWED = [
  // Redirects the retired URLs; naming them is the point.
  'proxy.ts',
  // The API's `POST /auth/login` and `POST /auth/logout` endpoints share these
  // strings and are unrelated to the deleted pages.
  path.join('lib', 'auth-options.ts'),
  path.join('services', 'auth.service.ts'),
  path.join('services', 'api-request.ts')
];

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      sourceFiles(full, found);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** Source with comments stripped — the notes explaining the removal name them. */
const code = (file: string) => fs.readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const files = sourceFiles(SRC);
const rel = (file: string) => path.relative(SRC, file).replace(/\\/g, '/');
const isAllowed = (file: string) => ALLOWED.some((allowed) => file.endsWith(allowed));

describe('the retired auth pages do not exist', () => {
  it.each([
    ['login', path.join(SRC, 'app/auth/login')],
    ['logout', path.join(SRC, 'app/auth/logout')]
  ])('has no /auth/%s route directory', (_name, dir) => {
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('has no logout page component', () => {
    expect(fs.existsSync(path.join(SRC, 'components/auth/logout.tsx'))).toBe(false);
  });

  it('keeps the token pages, which are reached from email links', () => {
    // These are public by necessity — whoever follows them cannot sign in yet —
    // and are explicitly out of scope of the page removal.
    expect(fs.existsSync(path.join(SRC, 'app/auth/verify-email/page.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(SRC, 'app/auth/reset-password/page.tsx'))).toBe(true);
  });

  it('keeps the shared auth layout the token pages render inside', () => {
    expect(fs.existsSync(path.join(SRC, 'app/auth/layout.tsx'))).toBe(true);
  });
});

describe('nothing navigates to them', () => {
  it('has no client navigation to /auth/login', () => {
    const offenders = files
      .filter((file) => !isAllowed(file))
      .filter((file) => /['"`]\/auth\/login['"`]/.test(code(file)));

    expect(offenders.map(rel)).toEqual([]);
  });

  it('has no client navigation to /auth/logout', () => {
    const offenders = files
      .filter((file) => !isAllowed(file))
      .filter((file) => /['"`]\/auth\/logout['"`]/.test(code(file)));

    expect(offenders.map(rel)).toEqual([]);
  });

  it('leaves no window.location assignment pointing at an auth page', () => {
    // The specific shape the old logout used, which bypasses the router and
    // therefore every guard and test that watches it.
    const offenders = files.filter((file) => /window\.location\.href\s*=\s*['"`]\/auth\//.test(code(file)));

    expect(offenders.map(rel)).toEqual([]);
  });
});

describe('NextAuth is not configured to render its own auth pages', () => {
  const authOptions = fs.readFileSync(path.join(SRC, 'lib/auth-options.ts'), 'utf8');

  it('declares no custom pages block', () => {
    // A `pages: { signIn: '/auth/login' }` would send every internal `signIn()`
    // call to a route that no longer exists. There is none, and the login form
    // calls `signIn(..., { redirect: false })` from inside the dialog instead.
    expect(/\bpages\s*:\s*\{/.test(code(path.join(SRC, 'lib/auth-options.ts')))).toBe(false);
    expect(authOptions).not.toMatch(/signIn\s*:\s*['"`]\/auth\/login/);
    expect(authOptions).not.toMatch(/signOut\s*:\s*['"`]\/auth\/logout/);
  });

  it('still revokes the API token in its signOut event', () => {
    // This is what makes `performLogout` a real server-side revoke rather than a
    // cookie wipe; deleting the logout page must not have touched it.
    expect(authOptions).toMatch(/events\s*:/);
    expect(authOptions).toMatch(/async signOut/);
    expect(authOptions).toMatch(/auth\/logout/);
  });
});
