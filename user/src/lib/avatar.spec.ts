import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEFAULT_AVATAR_URL, hasCustomAvatar, resolveAvatarUrl } from '@lib/avatar';

describe('resolveAvatarUrl', () => {
  it('keeps a real uploaded avatar untouched', () => {
    const uploaded = 'https://media.example.test/avatars/64f0/9c2a.webp';
    expect(resolveAvatarUrl(uploaded)).toBe(uploaded);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    // Not merely tidiness: a whitespace `src` resolves against the page URL and
    // makes the browser re-request the current document as an image.
    ['whitespace only', '   ']
  ])('falls back to the placeholder for %s', (_label, value) => {
    expect(resolveAvatarUrl(value as string | null | undefined)).toBe(DEFAULT_AVATAR_URL);
  });

  it('never returns an empty string, so no <img> is ever rendered with a blank src', () => {
    for (const value of [undefined, null, '', ' ', '\t\n']) {
      expect(resolveAvatarUrl(value as string | null | undefined)).not.toBe('');
    }
  });
});

describe('hasCustomAvatar', () => {
  it('is false for every shape of "no avatar"', () => {
    expect(hasCustomAvatar(undefined)).toBe(false);
    expect(hasCustomAvatar(null)).toBe(false);
    expect(hasCustomAvatar('')).toBe(false);
    expect(hasCustomAvatar('  ')).toBe(false);
  });

  it('is true for a stored avatar', () => {
    expect(hasCustomAvatar('https://media.example.test/a.webp')).toBe(true);
  });

  it('is true for the base64 preview the admin uploader shows before saving', () => {
    expect(hasCustomAvatar('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });
});

describe('the placeholder asset', () => {
  const repoRoot = join(__dirname, '..', '..', '..');
  const userAsset = join(repoRoot, 'user', 'public', 'no_avatar.jpeg');
  const adminAsset = join(repoRoot, 'admin', 'public', 'no_avatar.jpeg');

  it('exists in user/public at the path the helper points at', () => {
    expect(DEFAULT_AVATAR_URL).toBe('/no_avatar.jpeg');
    expect(() => readFileSync(userAsset)).not.toThrow();
  });

  /*
    `admin` is a separate Next app on its own origin, so a root-relative
    `/no_avatar.jpeg` has to exist in `admin/public/` too — see the comment at
    the top of `admin/src/lib/avatar.ts` for why a shared package cannot serve
    it. The duplication is deliberate; this test is what keeps it honest.

    It lives in the user app's suite because `admin` has a `test` script but no
    Jest configuration, so a spec placed there would never run.
  */
  it('is byte-identical in admin/public, which serves its own copy', () => {
    expect(readFileSync(adminAsset)).toEqual(readFileSync(userAsset));
  });
});
