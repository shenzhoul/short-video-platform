import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

/**
 * The one place that knows how a password is stored.
 *
 * Registration, admin create-user, password change and login all go through
 * here. Nothing else may hash, compare, or decide what a stored credential
 * means — the moment two places implement it, one of them is the one that keeps
 * accepting the old format forever.
 *
 * ## Why scrypt
 *
 * The previous scheme was a single SHA256 round over `password + salt`. SHA256
 * is built to be *fast*, which is the opposite of what a password needs: a
 * commodity GPU works through billions of candidates per second, so a stolen
 * `auth` collection is a list of passwords with a delay attached. scrypt is a
 * memory-hard KDF — the cost parameters below make each guess expensive in RAM
 * as well as CPU, which is what removes the GPU's advantage.
 *
 * `node:crypto` rather than argon2 or bcrypt deliberately: both of those are
 * native addons that need a toolchain to install and are a recurring source of
 * "works on my machine" on Windows. scrypt ships with Node, is in the OpenSSL
 * core, and is an RFC-7914 standard. It is the strongest option that costs
 * nothing to deploy.
 */

/**
 * Cost parameters, in one place and versioned.
 *
 * `N` is the work factor and dominates both time and memory: memory is roughly
 * `128 * N * r` bytes, so N=2^15 with r=8 is ~32MB and lands around 100ms on a
 * modern server core. That is the usual target — slow enough that offline
 * guessing is expensive, fast enough that a login does not feel like one.
 *
 * `maxmem` must be raised above Node's 32MB default or the derivation throws;
 * it is set with headroom rather than exactly at the requirement.
 *
 * These are recorded *in every hash* rather than read from here at verify time,
 * so raising them later cannot lock anybody out: an old credential still
 * verifies with the parameters it was written with, and is re-hashed on the
 * next successful login.
 */
export const SCRYPT_PARAMS = {
  /** CPU/memory cost. Must be a power of two. */
  N: 2 ** 15,
  /** Block size. */
  r: 8,
  /** Parallelisation. */
  p: 1,
  /** Derived key length in bytes. */
  keylen: 64,
  /** Salt length in bytes. */
  saltBytes: 16,
  /** ~64MB, comfortably above the ~32MB that N=2^15, r=8 needs. */
  maxmem: 64 * 1024 * 1024
} as const;

/** Marks the storage format. Bump when the encoding itself changes. */
const SCRYPT_VERSION = 1;

/** Prefix that identifies a credential this service wrote. */
const SCRYPT_PREFIX = 'scrypt$';

export type CredentialFormat = 'scrypt' | 'legacy-sha256' | 'unknown';

export interface StoredCredential {
  /** The encoded value in the `auth` document. */
  value?: string;
  /** Present only on legacy credentials. */
  salt?: string;
}

export interface VerificationResult {
  /** Whether the supplied password matched. */
  valid: boolean;
  /** Which format the stored credential was in. */
  format: CredentialFormat;
  /**
   * True when the password was correct *and* the credential is not yet scrypt,
   * so the caller should re-hash it. Never true for a failed verification —
   * upgrading on a wrong password would rewrite a credential on demand.
   */
  needsUpgrade: boolean;
}

@Injectable()
export class PasswordHasherService {
  /**
   * Hash a password for storage.
   *
   * The returned string is self-describing:
   *
   * ```text
   * scrypt$v=1$N=32768,r=8,p=1$<salt-base64>$<derived-key-base64>
   * ```
   *
   * Parameters travel with the hash so a future cost increase does not
   * invalidate existing credentials, and the version marker means a later
   * encoding change can be told apart rather than guessed at.
   *
   * A fresh random salt every time, so two accounts with the same password —
   * and the same account hashed twice — never produce the same stored value.
   */
  public async hash(password: string): Promise<string> {
    const salt = crypto.randomBytes(SCRYPT_PARAMS.saltBytes);
    const derived = await scrypt(password, salt, SCRYPT_PARAMS.keylen, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      maxmem: SCRYPT_PARAMS.maxmem
    });

    const params = `N=${SCRYPT_PARAMS.N},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}`;
    return [
      `${SCRYPT_PREFIX}v=${SCRYPT_VERSION}`,
      params,
      salt.toString('base64'),
      derived.toString('base64')
    ].join('$');
  }

  /**
   * What kind of credential this is.
   *
   * Detection is by explicit prefix, never by shape. A legacy value is 64 hex
   * characters and a scrypt value is not, but "does not look like scrypt" is not
   * the same statement as "is a legacy hash" — a truncated or corrupted value
   * would satisfy it and get handed to the legacy verifier, which is precisely
   * the ambiguous fallback this avoids.
   */
  public detectFormat(credential: StoredCredential | null | undefined): CredentialFormat {
    const value = credential?.value;
    if (typeof value !== 'string' || !value) return 'unknown';

    if (value.startsWith(SCRYPT_PREFIX)) return 'scrypt';

    // A legacy credential is a hex digest *and* a separate salt column. Both are
    // required: a value with no salt cannot be verified by the legacy scheme, so
    // calling it legacy would only produce a confident failure later.
    if (typeof credential?.salt === 'string' && credential.salt && /^[0-9a-f]{64}$/i.test(value)) {
      return 'legacy-sha256';
    }

    return 'unknown';
  }

  /**
   * Verify a password against a stored credential, whatever format it is in.
   *
   * Never throws for bad input. A malformed credential, an unsupported version,
   * an unparseable parameter list — all of them are an authentication failure,
   * because the alternative is a 500 that tells an attacker their input reached
   * something interesting. What went wrong is the caller's to log; the caller's
   * *answer* to the user is always the same.
   */
  public async verify(
    password: string,
    credential: StoredCredential | null | undefined
  ): Promise<VerificationResult> {
    const format = this.detectFormat(credential);

    if (!password || format === 'unknown') {
      return { valid: false, format, needsUpgrade: false };
    }

    if (format === 'scrypt') {
      const valid = await this.verifyScrypt(password, credential!.value!);
      return { valid, format, needsUpgrade: false };
    }

    const valid = this.verifyLegacySha256(password, credential!.value!, credential!.salt!);
    // Only a correct password earns an upgrade. Re-hashing on a failed attempt
    // would let anybody rewrite a credential by guessing at it.
    return { valid, format, needsUpgrade: valid };
  }

  /**
   * The legacy scheme, reproduced exactly.
   *
   * Kept here rather than left in `AuthService` so there is one description of
   * how an old credential was made, next to the one that replaces it. It is
   * verify-only: nothing in the codebase writes this format any more.
   */
  private verifyLegacySha256(password: string, storedValue: string, salt: string): boolean {
    const computed = crypto.createHash('sha256').update(password + salt).digest('hex');
    return this.timingSafeEquals(Buffer.from(computed, 'hex'), Buffer.from(storedValue, 'hex'));
  }

  private async verifyScrypt(password: string, storedValue: string): Promise<boolean> {
    const parsed = this.parseScrypt(storedValue);
    if (!parsed) return false;

    try {
      const derived = await scrypt(password, parsed.salt, parsed.key.length, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem: SCRYPT_PARAMS.maxmem
      });
      return this.timingSafeEquals(derived, parsed.key);
    } catch {
      // Parameters that Node refuses (an N above maxmem, say) are a broken
      // credential, not an exception for the caller to handle.
      return false;
    }
  }

  /**
   * Decode a stored scrypt value, or `null` if it is not one this version can
   * read.
   *
   * Everything is validated before use: an unknown version, a missing section, a
   * non-numeric parameter or a non-power-of-two `N` all return null rather than
   * being passed to the KDF.
   */
  private parseScrypt(storedValue: string): { N: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
    const sections = storedValue.split('$');
    // scrypt | v=1 | N=..,r=..,p=.. | salt | key
    if (sections.length !== 5) return null;

    const [algorithm, version, params, saltPart, keyPart] = sections;
    if (algorithm !== 'scrypt') return null;
    if (version !== `v=${SCRYPT_VERSION}`) return null;

    const parsedParams: Record<string, number> = {};
    for (const entry of params.split(',')) {
      const [name, raw] = entry.split('=');
      const numeric = Number(raw);
      if (!name || !Number.isInteger(numeric) || numeric <= 0) return null;
      parsedParams[name] = numeric;
    }

    const { N, r, p } = parsedParams;
    if (!N || !r || !p) return null;
    // scrypt requires a power-of-two cost factor; anything else makes Node throw.
    if ((N & (N - 1)) !== 0) return null;

    const salt = this.decodeBase64(saltPart);
    const key = this.decodeBase64(keyPart);
    if (!salt?.length || !key?.length) return null;

    return {
      N, r, p, salt, key
    };
  }

  private decodeBase64(value: string): Buffer | null {
    if (!value) return null;
    const buffer = Buffer.from(value, 'base64');
    // `Buffer.from` is lenient and silently drops invalid characters, so the
    // round trip is what actually rejects a corrupted section.
    return buffer.toString('base64') === value ? buffer : null;
  }

  /**
   * Constant-time comparison.
   *
   * `timingSafeEqual` throws on a length mismatch, which would itself leak the
   * length through an exception, so the lengths are compared first and the
   * mismatch answered without calling it.
   */
  private timingSafeEquals(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  }
}
