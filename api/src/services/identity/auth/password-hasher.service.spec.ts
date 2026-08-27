import * as crypto from 'crypto';

import { PasswordHasherService, SCRYPT_PARAMS } from './password-hasher.service';

/**
 * The storage format for passwords, and the boundary between the new scheme and
 * the one it replaces.
 *
 * Two things are being pinned here. First, that a new credential is scrypt and
 * says so — a format you cannot identify is a format you cannot migrate off.
 * Second, that every way of handing this service rubbish produces "no" rather
 * than an exception: a 500 on a malformed credential tells an attacker their
 * input reached something that parses.
 */

const hasher = new PasswordHasherService();

/** Reproduces the pre-migration scheme, for credentials written before this. */
function legacyCredential(password: string) {
  const salt = crypto.randomBytes(16).toString('base64');
  return {
    salt,
    value: crypto.createHash('sha256').update(password + salt).digest('hex')
  };
}

// scrypt at N=2^15 is ~100ms by design, and several tests hash more than once.
jest.setTimeout(30000);

describe('hashing a new password', () => {
  it('produces a value that identifies its algorithm and version', async () => {
    const stored = await hasher.hash('correct horse battery staple');

    expect(stored.startsWith('scrypt$v=1$')).toBe(true);
    // Algorithm, version, parameters, salt, key.
    expect(stored.split('$')).toHaveLength(5);
  });

  it('records the cost parameters in the hash itself', async () => {
    const stored = await hasher.hash('correct horse battery staple');
    const [, , params] = stored.split('$');

    // Carried per-credential so raising the cost later cannot lock anybody out:
    // an old hash still verifies with the parameters it was written under.
    expect(params).toBe(`N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`);
  });

  it('produces a different hash every time for the same password', async () => {
    const [first, second] = await Promise.all([
      hasher.hash('same-password'),
      hasher.hash('same-password')
    ]);

    // Different salts. Without this, identical passwords are visibly identical
    // in the database and one cracked hash reveals every account that shares it.
    expect(first).not.toBe(second);
    expect(first.split('$')[3]).not.toBe(second.split('$')[3]);
  });

  it('never contains the plaintext', async () => {
    const stored = await hasher.hash('hunter2');

    expect(stored).not.toContain('hunter2');
  });
});

describe('verifying a scrypt credential', () => {
  it('accepts the correct password', async () => {
    const value = await hasher.hash('correct-password');

    const result = await hasher.verify('correct-password', { value });

    expect(result).toEqual({ valid: true, format: 'scrypt', needsUpgrade: false });
  });

  it('rejects the wrong password', async () => {
    const value = await hasher.hash('correct-password');

    const result = await hasher.verify('wrong-password', { value });

    expect(result.valid).toBe(false);
    expect(result.needsUpgrade).toBe(false);
  });

  it('rejects an empty password rather than treating it as a match', async () => {
    const value = await hasher.hash('correct-password');

    expect((await hasher.verify('', { value })).valid).toBe(false);
  });

  it('never asks to upgrade a credential that is already current', async () => {
    const value = await hasher.hash('correct-password');

    expect((await hasher.verify('correct-password', { value })).needsUpgrade).toBe(false);
  });
});

describe('verifying a legacy salted-SHA256 credential', () => {
  it('accepts the correct password and asks for an upgrade', async () => {
    const credential = legacyCredential('legacy-password');

    const result = await hasher.verify('legacy-password', credential);

    expect(result).toEqual({ valid: true, format: 'legacy-sha256', needsUpgrade: true });
  });

  it('rejects the wrong password and does NOT ask for an upgrade', async () => {
    const credential = legacyCredential('legacy-password');

    const result = await hasher.verify('not-the-password', credential);

    // Upgrading on a failed attempt would let anyone rewrite a credential by
    // guessing at it.
    expect(result.valid).toBe(false);
    expect(result.needsUpgrade).toBe(false);
  });
});

describe('a credential that cannot be understood fails safely', () => {
  const rubbish: Array<[string, any]> = [
    ['null', null],
    ['undefined', undefined],
    ['an empty object', {}],
    ['an empty value', { value: '' }],
    ['a non-string value', { value: 12345 }],
    ['a hex digest with no salt', { value: 'a'.repeat(64) }],
    ['an unknown algorithm', { value: 'argon2$v=1$m=1$c2FsdA==$a2V5' }],
    ['a future scrypt version', { value: 'scrypt$v=99$N=32768,r=8,p=1$c2FsdA==$a2V5' }],
    ['too few sections', { value: 'scrypt$v=1$N=32768,r=8,p=1$c2FsdA==' }],
    ['too many sections', { value: 'scrypt$v=1$N=32768,r=8,p=1$c2FsdA==$a2V5$extra' }],
    ['non-numeric parameters', { value: 'scrypt$v=1$N=abc,r=8,p=1$c2FsdA==$a2V5' }],
    ['a cost factor that is not a power of two', { value: 'scrypt$v=1$N=1000,r=8,p=1$c2FsdA==$a2V5' }],
    ['a negative cost factor', { value: 'scrypt$v=1$N=-1,r=8,p=1$c2FsdA==$a2V5' }],
    ['an empty salt section', { value: 'scrypt$v=1$N=32768,r=8,p=1$$a2V5' }],
    ['a corrupted base64 salt', { value: 'scrypt$v=1$N=32768,r=8,p=1$not base64!!$a2V5' }],
    ['a truncated hex digest with a salt', { salt: 'c2FsdA==', value: 'abc' }]
  ];

  it.each(rubbish)('refuses %s without throwing', async (_label, credential) => {
    const result = await hasher.verify('any-password', credential);

    expect(result.valid).toBe(false);
    expect(result.needsUpgrade).toBe(false);
  });

  it('classifies unreadable credentials as unknown, never as legacy', async () => {
    // The dangerous shape: "not scrypt" must not imply "legacy", or a corrupted
    // value gets handed to the legacy verifier on the strength of a guess.
    expect(hasher.detectFormat({ value: 'garbage' })).toBe('unknown');
    expect(hasher.detectFormat({ value: 'a'.repeat(64) })).toBe('unknown');
    expect(hasher.detectFormat({ value: 'a'.repeat(64), salt: 'c2FsdA==' })).toBe('legacy-sha256');
  });
});

describe('a password that has been upgraded stays on the new path', () => {
  it('verifies through scrypt and asks for nothing further', async () => {
    const legacy = legacyCredential('shared-password');
    const before = await hasher.verify('shared-password', legacy);
    expect(before.needsUpgrade).toBe(true);

    // What the login path writes back.
    const upgraded = { value: await hasher.hash('shared-password') };

    const after = await hasher.verify('shared-password', upgraded);
    expect(after.format).toBe('scrypt');
    expect(after.valid).toBe(true);
    expect(after.needsUpgrade).toBe(false);
  });
});
