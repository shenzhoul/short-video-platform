/**
 * Public read-only media delivery for the Douyin Clone R2 bucket.
 *
 * ## Why this exists
 *
 * The bucket is private and `r2.dev` is disabled. Cloudflare documents the
 * `r2.dev` URL as rate-limited and "should only be used for development
 * purposes", and a custom domain needs a domain nobody has bought. A Worker
 * with an **R2 binding** on `workers.dev` is the remaining supported way to
 * serve public media for free, and it is strictly better than `r2.dev` anyway:
 * the bucket stays private, and every response passes through code we control.
 *
 * ## The security posture
 *
 * The binding grants this Worker full access to the bucket, so the Worker — not
 * the bucket — is the entire access-control boundary. Cloudflare's own guide is
 * explicit that binding a bucket "means your bucket is publicly exposed and its
 * contents can be accessed and modified by undesired actors" unless the Worker
 * implements authorization. So:
 *
 *   - only `GET` and `HEAD` reach the bucket; every other method is refused
 *     before any binding call, so there is no code path from the internet to
 *     `put`, `delete` or `list`
 *   - `list()` is never called, so no request can enumerate the bucket
 *   - the key is derived from the path and validated; a malformed or traversing
 *     key is refused rather than repaired
 *
 * ## What it must get right for video
 *
 * Seeking is `Range`. R2 resolves the range itself when the request headers are
 * passed through, and the response has to carry `206`, `Content-Range`,
 * `Accept-Ranges` and a correct `Content-Length`, or the browser will download
 * the whole file to scrub — or refuse to scrub at all.
 */

/** Methods that may reach the bucket at all. */
const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Same character rule as the file server's `object-key.ts`, deliberately.
 *
 * Keys are server-generated (`photos/<ObjectId>/<uuid>.webp`) and normalised
 * through that module on the way in, so anything arriving here outside this set
 * did not come from our pipeline. Refusing is correct and cheap; "repairing" it
 * would mean guessing at a key somebody else chose.
 */
const SAFE_KEY = /^[A-Za-z0-9._~/-]+$/;

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER = /[\x00-\x1f\x7f]/;

/**
 * Turn a request path into a bucket key, or return null to refuse.
 *
 * `decodeURIComponent` runs first because `%2e%2e%2f` is `../` and must be
 * caught by the traversal check rather than sailing past it as an opaque
 * string. A malformed escape throws, which is itself a refusal.
 */
export function objectKeyFromPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (CONTROL_CHARACTER.test(decoded)) return null;

  // Backslashes are not a path separator in a bucket, and allowing them would
  // give `..\\` a second spelling that the segment check below would miss.
  if (decoded.includes('\\')) return null;

  const key = decoded.replace(/^\/+/, '');

  // An empty key is a request for the bucket root — i.e. a listing. There is no
  // such object and we never enumerate.
  if (!key) return null;

  const segments = key.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return null;

  if (!SAFE_KEY.test(key)) return null;

  // A bucket key is capped at 1024 bytes; refuse before spending a lookup.
  if (new TextEncoder().encode(key).length > 1024) return null;

  return key;
}

/**
 * The exact origins allowed to read media cross-origin.
 *
 * A wildcard would be tempting because media is public anyway, but this header
 * is also what decides whether a *browser* will let a canvas read the pixels or
 * a `fetch()` see the bytes. Keeping it to the two front ends means an
 * embedding of this media on someone else's page cannot read it programmatically.
 */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function corsHeaders(request, env, headers = new Headers()) {
  const origin = request.headers.get('Origin');

  // `Vary: Origin` regardless of whether this particular request had one:
  // without it a cached response for one origin is replayed for another.
  headers.set('Vary', 'Origin');

  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    // Range is not a CORS-safelisted request header, so a cross-origin video
    // seek fails the preflight without this.
    headers.set('Access-Control-Allow-Headers', 'Range, If-None-Match, If-Modified-Since');
    // Without exposing these the browser hides them from script even on a 206.
    headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, ETag');
    headers.set('Access-Control-Max-Age', '86400');
  }

  return headers;
}

function refuse(request, env, status, message) {
  const headers = corsHeaders(request, env, new Headers({
    'Content-Type': 'text/plain; charset=utf-8',
    // A refusal must never be cached as if it were media.
    'Cache-Control': 'no-store'
  }));
  return new Response(`${message}\n`, { status, headers });
}

/**
 * Content-Range for a resolved R2 range.
 *
 * R2 hands back either `{ offset, length }` or `{ suffix }` depending on how
 * the request was phrased, and the response must state absolute byte positions
 * against the FULL object size — `object.size` is that full size, not the slice.
 */
export function contentRangeFor(range, size) {
  if (!range) return null;

  if (typeof range.suffix === 'number') {
    const start = Math.max(0, size - range.suffix);
    return { start, end: size - 1, length: size - start };
  }

  const start = typeof range.offset === 'number' ? range.offset : 0;
  const length = typeof range.length === 'number' ? range.length : size - start;
  const end = Math.min(size - 1, start + length - 1);
  return { start, end, length: end - start + 1 };
}

async function handleRequest(request, env) {
  const method = request.method.toUpperCase();

  if (method === 'OPTIONS') {
    // Preflight for a cross-origin ranged video request.
    return new Response(null, { status: 204, headers: corsHeaders(request, env) });
  }

  if (!READ_METHODS.has(method)) {
    // Refused before any binding call — there is no path from here to a write.
    const headers = corsHeaders(request, env, new Headers({ Allow: 'GET, HEAD, OPTIONS' }));
    return new Response('Method Not Allowed\n', { status: 405, headers });
  }

  const url = new URL(request.url);
  const key = objectKeyFromPath(url.pathname);
  if (!key) return refuse(request, env, 400, 'Bad Request');

  const bucket = env.MEDIA_BUCKET;
  if (!bucket) return refuse(request, env, 500, 'Storage is not configured');

  // HEAD never needs a body, and `head()` avoids R2 preparing one.
  if (method === 'HEAD') {
    const head = await bucket.head(key);
    if (!head) return refuse(request, env, 404, 'Not Found');

    const headers = corsHeaders(request, env);
    head.writeHttpMetadata(headers);
    headers.set('ETag', head.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Length', String(head.size));
    if (!headers.has('Cache-Control')) headers.set('Cache-Control', env.CACHE_CONTROL || 'public, max-age=31536000, immutable');
    return new Response(null, { status: 200, headers });
  }

  /*
   * Both `range` and `onlyIf` are handed the raw request headers so R2 parses
   * them itself. Doing it by hand means reimplementing `If-Range`, multi-range
   * and suffix-range semantics, and getting any of them subtly wrong shows up
   * as a video that will not scrub rather than as an error.
   */
  const object = await bucket.get(key, {
    range: request.headers,
    onlyIf: request.headers
  });

  if (object === null) return refuse(request, env, 404, 'Not Found');

  const headers = corsHeaders(request, env);
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  headers.set('Accept-Ranges', 'bytes');
  if (!headers.has('Cache-Control')) {
    headers.set('Cache-Control', env.CACHE_CONTROL || 'public, max-age=31536000, immutable');
  }

  /*
   * No body means the precondition decided this request needs no payload.
   * A conditional GET that matched is a 304; anything else that failed a
   * precondition is a 412. Returning 200 with an empty body here would tell the
   * browser the object is zero bytes and poison its cache.
   */
  if (!('body' in object) || object.body === undefined || object.body === null) {
    const conditional = request.headers.get('If-None-Match') || request.headers.get('If-Modified-Since');
    return new Response(null, { status: conditional ? 304 : 412, headers });
  }

  const resolved = contentRangeFor(object.range, object.size);
  if (resolved && resolved.length !== object.size) {
    headers.set('Content-Range', `bytes ${resolved.start}-${resolved.end}/${object.size}`);
    headers.set('Content-Length', String(resolved.length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      /*
       * Never surface the thrown message. It can carry a key, a bucket name or
       * internal state, and whoever is fetching an image has no use for any of
       * it. The detail goes to the Worker log instead.
       */
      console.error('media worker error', { message: error?.message });
      return refuse(request, env, 500, 'Internal Server Error');
    }
  }
};

export { handleRequest };
