/**
 * TEMPORARY — client-side trace of which token each consumer actually sends.
 *
 * Every earlier probe in this investigation wrote to container stdout, and the
 * failing requests are made in the BROWSER. That is why none of them ever
 * appeared, and why three successive hypotheses were argued from source rather
 * than from data. These lines go to the browser console, where they can be read.
 *
 * What is proven already, and therefore not in question here: `POST /auth/login`
 * writes a 43-character token to `douyin-clone:session:<userId>:<token>` with a
 * 7-day TTL, and `GET /users/me` with that token answers 200 for an active
 * isAdmin superadmin. So a 403 means the value sent is not the value issued —
 * this finds where it diverges.
 *
 * `len=<n> sha256=<first 8 hex>` only. Eight hex characters of a SHA-256 cannot
 * be reversed, and the length alone separates the shapes that matter. The
 * non-obvious failures are named rather than hashed, because each is a
 * non-empty string an Authorization header would carry happily.
 *
 * Logged unconditionally: gating on an environment variable is what hid the
 * last two attempts. Remove with the fix.
 */

export async function fingerprint(value: unknown): Promise<string> {
  if (value === undefined) return 'MISSING(undefined)';
  if (value === null) return 'MISSING(null)';
  if (typeof value !== 'string') return `NOT-A-STRING(${typeof value})`;
  if (value === '') return 'EMPTY';
  if (value === 'undefined' || value === 'null') return `STRINGIFIED(${value})`;
  if (value === '[object Object]') return 'STRINGIFIED(object)';

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `len=${value.length} sha256=${hex.slice(0, 8)}`;
}

/**
 * Fire-and-forget so a sync call site (a request builder, a render) never has to
 * await a hash. Ordering between lines is not guaranteed, which is why every
 * line carries its own stage name.
 */
export function traceAuth(stage: string, fields: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;

  void (async () => {
    const parts: string[] = [];
    for (const [key, value] of Object.entries(fields)) {
      parts.push(`${key}=${key.endsWith('Fp') ? await fingerprint(value) : String(value)}`);
    }
    // eslint-disable-next-line no-console
    console.info(`[auth-trace] ${stage}: ${parts.join(' ')}`);
  })();
}
