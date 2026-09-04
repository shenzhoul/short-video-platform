/**
 * Turning an internal storage key into an object key that is safe to put in a
 * bucket and safe to put in a URL.
 *
 * Most of a key is server-generated and already safe:
 * `photos/<ObjectId>/<uuid>.webp`. The ObjectId and the UUID are what make it
 * collision-proof, and nothing in the pipeline ever rewrites an existing key.
 *
 * One part is not. `generateFilePaths` appends
 * `extname(multerData.originalname)` for video, audio and document uploads, and
 * `originalname` is chosen by whoever uploads. `path.extname` cannot contain a
 * slash, so it is not a traversal vector, but it can carry anything else —
 * `clip.mp4?x=1` yields the extension `.mp4?x=1`, which is a legal S3 key and a
 * broken URL the moment it is concatenated onto a public base. Percent signs,
 * `#`, quotes, spaces and control characters all arrive the same way.
 *
 * So the rule is: the key is normalised and sanitised on the way to the bucket,
 * never trusted as given.
 */

/**
 * Characters kept verbatim. This is the RFC 3986 unreserved set plus `/` as the
 * hierarchy separator — every one of them survives a URL path unencoded and is
 * unambiguous as an S3 key. Everything else is replaced rather than encoded,
 * because an encoded key has two spellings (the raw one in the bucket and the
 * escaped one in the URL) and the two drift apart the first time somebody
 * copies a key out of a log.
 */
const SAFE_CHARACTER = /[^A-Za-z0-9._~/-]/g;

/** Anything a bucket listing or a log line should never have to carry. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

export class UnsafeObjectKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeObjectKeyError';
  }
}

/**
 * Normalise an internal key to a bucket object key.
 *
 * @param key   the key as the pipeline built it, with or without a leading `/`
 * @param prefix optional deployment namespace (`R2_KEY_PREFIX`)
 *
 * @throws UnsafeObjectKeyError when the key is empty, contains a control
 *         character, or contains a `..` segment. These are refused rather than
 *         repaired: `..` is the one input that can move an object *out* of its
 *         prefix, and the prefix is what separates staging from production when
 *         they share a bucket. Quietly rewriting it would put a staging object
 *         into the production namespace and report success.
 */
export function normalizeObjectKey(key: string, prefix = ''): string {
  if (typeof key !== 'string' || !key.trim()) {
    throw new UnsafeObjectKeyError('Object key is empty.');
  }

  if (CONTROL_CHARACTER.test(key)) {
    throw new UnsafeObjectKeyError('Object key contains a control character.');
  }

  // Windows builds the odd key with backslashes; a bucket has one separator.
  const withForwardSlashes = key.replace(/\\/g, '/');

  const segments = withForwardSlashes
    .split('/')
    // Drops the leading slash, any trailing one, and `a//b`.
    .filter((segment) => segment.length > 0 && segment !== '.');

  if (segments.some((segment) => segment === '..')) {
    throw new UnsafeObjectKeyError('Object key contains a parent-directory segment.');
  }

  const sanitized = segments
    .map((segment) => segment.replace(SAFE_CHARACTER, '_'))
    // A segment of nothing but unsafe characters must not collapse to empty and
    // silently shorten the path.
    .filter((segment) => segment.length > 0);

  if (!sanitized.length) {
    throw new UnsafeObjectKeyError('Object key has no usable segments.');
  }

  const prefixSegments = String(prefix || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    .map((segment) => segment.replace(SAFE_CHARACTER, '_'))
    .filter((segment) => segment.length > 0);

  return [...prefixSegments, ...sanitized].join('/');
}

/**
 * Build the public URL for an object key.
 *
 * Kept next to the normaliser on purpose: the URL must be built from exactly
 * the key that was written, and the only way to guarantee that is to run both
 * through the same normalisation.
 *
 * `new URL(key, base)` is deliberately NOT used — it resolves the key
 * relatively, so a base of `https://cdn.example.com/media/` and a key of
 * `photos/x.webp` silently drops `media/` unless the base ends in a slash and
 * the key does not begin with one.
 */
export function buildPublicObjectUrl(publicBaseUrl: string, objectKey: string): string {
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');
  return `${base}/${objectKey.replace(/^\/+/, '')}`;
}
