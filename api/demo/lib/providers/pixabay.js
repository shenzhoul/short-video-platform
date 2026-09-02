/**
 * Pixabay — the fallback, consulted only when Pexels cannot fill a slot.
 *
 * ## The key is in the query string, and that is Pixabay's design
 *
 * Pixabay accepts its credential only as `?key=`; there is no header form. That
 * makes the URL itself a secret, which is why:
 *
 *  - no Pixabay request URL is ever logged, at any level;
 *  - the logger strips `?key=` and `&key=` from anything printed, independently
 *    of the registered-secret list, so an accidental print in some future caller
 *    is still safe;
 *  - the manifest records `pageURL` — a public page, no credential — and never a
 *    request URL. Download URLs are CDN links that carry no key.
 *
 * ## Licence and terms
 *
 * The Pixabay Content License (https://pixabay.com/service/license-summary/):
 * free for commercial and non-commercial use, attribution not required. Two of
 * their API terms shape this code: results must be cached rather than re-fetched
 * on every use (the media cache and manifest are that cache — `demo:seed` never
 * calls the API at all), and permanent hotlinking of Pixabay-hosted files is not
 * permitted, which is why every file is downloaded and served from this
 * project's own file server.
 *
 * The default quota is 100 requests per 60 seconds, considerably tighter than
 * Pexels — another reason this is the fallback rather than the primary.
 */

const { requestJson, createPacer } = require('../http');

const IMAGE_ENDPOINT = 'https://pixabay.com/api/';
const VIDEO_ENDPOINT = 'https://pixabay.com/api/videos/';

const LICENSE = Object.freeze({
  name: 'Pixabay Content License',
  url: 'https://pixabay.com/service/license-summary/',
  attributionRequired: false,
  commercialUse: true
});

function createPixabayProvider({ apiKey, network }) {
  // Pixabay's window is 100/60s. Keep a wider gap than Pexels gets.
  const pace = createPacer(Math.max(network.searchIntervalMs, 700));
  let remaining = null;

  const requestOptions = {
    headers: { 'User-Agent': 'douyin-clone-demo-seeder/1.0 (+local development tooling)' },
    timeoutMs: 30000,
    maxRetries: network.maxRetries,
    retryBaseDelayMs: network.retryBaseDelayMs,
    // The label is what appears in a retry log line. It must not be the URL.
    label: 'pixabay'
  };

  const noteQuota = (headers) => {
    const value = Number(headers?.get('x-ratelimit-remaining'));
    if (Number.isFinite(value)) remaining = value;
  };

  const exhausted = () => remaining !== null && remaining < Math.min(network.rateLimitFloor, 15);

  async function searchPhotos({ query, orientation, page = 1, perPage = 50 }) {
    if (exhausted()) return { ok: false, reason: 'rate limit floor reached', candidates: [] };

    const url = new URL(IMAGE_ENDPOINT);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('image_type', 'photo');
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    url.searchParams.set('safesearch', 'true');
    // Pixabay says "vertical"/"horizontal" where Pexels says portrait/landscape.
    if (orientation === 'portrait') url.searchParams.set('orientation', 'vertical');
    if (orientation === 'landscape') url.searchParams.set('orientation', 'horizontal');

    const result = await pace(() => requestJson(url.toString(), requestOptions));
    if (!result.ok) return { ok: false, reason: result.reason, candidates: [] };
    noteQuota(result.headers);

    const candidates = (result.body.hits || []).map((hit) => ({
      source: 'pixabay',
      kind: 'photo',
      sourceMediaId: String(hit.id),
      sourcePageUrl: hit.pageURL,
      creator: {
        name: hit.user || 'Unknown',
        profileUrl: hit.user_id ? `https://pixabay.com/users/-${hit.user_id}/` : null
      },
      license: LICENSE,
      width: Number(hit.imageWidth) || null,
      height: Number(hit.imageHeight) || null,
      durationMs: null,
      // `largeImageURL` is the largest the API returns without a fullHD grant.
      downloadUrl: hit.largeImageURL || hit.webformatURL,
      extension: guessExtension(hit.largeImageURL || hit.webformatURL) || '.jpg',
      declaredBytes: null,
      description: hit.tags || null
    })).filter((c) => c.downloadUrl);

    return { ok: true, candidates };
  }

  async function searchVideos({ query, page = 1, perPage = 50, preferences }) {
    if (exhausted()) return { ok: false, reason: 'rate limit floor reached', candidates: [] };

    const url = new URL(VIDEO_ENDPOINT);
    url.searchParams.set('key', apiKey);
    url.searchParams.set('q', query);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    url.searchParams.set('safesearch', 'true');

    const result = await pace(() => requestJson(url.toString(), requestOptions));
    if (!result.ok) return { ok: false, reason: result.reason, candidates: [] };
    noteQuota(result.headers);

    const candidates = [];
    for (const hit of result.body.hits || []) {
      // Pixabay's video search has no orientation filter, so portrait selection
      // happens here on the reported dimensions rather than in the query.
      const rendition = pickRendition(hit.videos || {}, preferences);
      if (!rendition) continue;
      candidates.push({
        source: 'pixabay',
        kind: 'video',
        sourceMediaId: String(hit.id),
        sourcePageUrl: hit.pageURL,
        creator: {
          name: hit.user || 'Unknown',
          profileUrl: hit.user_id ? `https://pixabay.com/users/-${hit.user_id}/` : null
        },
        license: LICENSE,
        width: Number(rendition.width) || null,
        height: Number(rendition.height) || null,
        durationMs: Number(hit.duration) ? Math.round(Number(hit.duration) * 1000) : null,
        downloadUrl: rendition.url,
        extension: '.mp4',
        declaredBytes: Number(rendition.size) || null,
        description: hit.tags || null
      });
    }

    return { ok: true, candidates };
  }

  return {
    name: 'pixabay',
    searchPhotos,
    searchVideos,
    get remainingQuota() { return remaining; },
    get isExhausted() { return exhausted(); }
  };
}

/** Largest rendition inside the width ceiling, preferring portrait shapes. */
function pickRendition(videos, preferences) {
  const maxWidth = preferences?.preferredMaxWidth ?? 1440;
  const usable = Object.values(videos)
    .filter((v) => v && v.url && Number(v.width) > 0 && Number(v.height) > 0);
  if (usable.length === 0) return null;

  const portrait = usable.filter((v) => Number(v.height) > Number(v.width));
  const pool = portrait.length > 0 ? portrait : usable;
  const withinCeiling = pool.filter((v) => Number(v.width) <= maxWidth);
  const finalPool = withinCeiling.length > 0 ? withinCeiling : pool;

  return finalPool.sort((a, b) => {
    if (withinCeiling.length > 0) return Number(b.width) - Number(a.width);
    return Number(a.width) - Number(b.width);
  })[0];
}

function guessExtension(url) {
  if (!url) return null;
  const match = String(url).split('?')[0].match(/(\.[a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : null;
}

module.exports = { createPixabayProvider, PIXABAY_LICENSE: LICENSE };
