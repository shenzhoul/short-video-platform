/**
 * Contract test between the demo seeder's password hashing and the real one.
 *
 * `demo/lib/seed-accounts.js` is plain Node and cannot import the Nest-decorated
 * `PasswordHasherService`, so it reproduces the scrypt parameters and the stored
 * encoding. Reproduced constants drift. This test is what turns that drift into
 * a failing build instead of sixteen demo accounts that silently cannot log in.
 *
 * It checks the direction that matters: a credential the seeder writes must be
 * accepted by the service the login path actually uses.
 */

import { PasswordHasherService } from '../../src/services/identity/auth/password-hasher.service';

/* eslint-disable @typescript-eslint/no-var-requires */
const crypto = require('crypto');
const { hashPassword } = require('./seed-accounts');

/** What the browser sends: the plaintext, SHA-256'd. */
const asClientSends = (plain: string) => crypto.createHash('sha256').update(plain).digest('hex');

describe('demo account credentials', () => {
  const hasher = new PasswordHasherService();
  const plaintext = 'demodemo';

  it('produces a credential the real hasher verifies', async () => {
    const stored = await hashPassword(plaintext);

    const result = await hasher.verify(asClientSends(plaintext), { value: stored });

    expect(result.valid).toBe(true);
    expect(result.format).toBe('scrypt');
    // The whole point of writing the current format: nothing to upgrade.
    expect(result.needsUpgrade).toBe(false);
  });

  it('rejects the wrong password', async () => {
    const stored = await hashPassword(plaintext);

    const result = await hasher.verify(asClientSends('not-the-password'), { value: stored });

    expect(result.valid).toBe(false);
  });

  it('is detected as scrypt, not as a legacy credential', async () => {
    const stored = await hashPassword(plaintext);

    expect(stored.startsWith('scrypt$')).toBe(true);
    expect(hasher.detectFormat({ value: stored })).toBe('scrypt');
  });

  it('salts every credential separately', async () => {
    const [a, b] = await Promise.all([hashPassword(plaintext), hashPassword(plaintext)]);

    // Sixteen demo accounts share one password; they must not share a value.
    expect(a).not.toEqual(b);
  });

  it('encodes the parameters the service expects to parse back', async () => {
    const [scheme, version, params, salt, key] = (await hashPassword(plaintext)).split('$');

    expect(scheme).toBe('scrypt');
    expect(version).toBe('v=1');
    expect(params).toBe('N=32768,r=8,p=1');
    // 16-byte salt, 64-byte derived key, both base64.
    expect(Buffer.from(salt, 'base64')).toHaveLength(16);
    expect(Buffer.from(key, 'base64')).toHaveLength(64);
  });
});
