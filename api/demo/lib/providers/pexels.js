/**
 * Pexels — the primary source.
 *
 * Chosen as primary because it takes its credential in an `Authorization`
 * header, so no request this module builds can put the key in a URL, a redirect
 * chain, or a proxy access log.
 *
 * Licence: the Pexels License (https://www.pexels.com/license/). Free for
 * commercial and non-commercial use, no attribution required — recorded in the
 * manifest anyway, because "not required" is not the same as "not owed", and a
 * dataset that cannot say where a file came from cannot be audited later.
 * Identifiable people may not be shown in a way that is defamatory or implies
 * endorsement, which is one of the reasons account avatars here are drawn rather
 * than photographed.
 */

const { requestJson, createPacer } = require('../http');

const PHOTO_ENDPOINT = 'https://api.pexels.com/v1/search';
const VIDEO_ENDPOINT = 'https://api.pexels.com/videos/search';

const LICENSE = Object.freeze({
  name: 'Pexels License',
  url: 'https://www.pexels.com/license/',
  attributionRequired: false,
  commercialUse: true
});

function createPexelsProvider({ apiKey, network }) {
  const pace = createPacer(network.searchIntervalMs);
  let remaining = null;

  const requestOptions = {
    headers: {
      // The key travels here and nowhere else.
      Authorization: apiKey,
      'User-Agent': 'douyin-clone-demo-seeder/1.0 (+local development tooling)'
    },
    timeoutMs: 30000,
    maxRetries: network.maxRetries,
    retryBaseDelayMs: network.retryBaseDelayMs,
    label: 'pexels'
  };

  /** Read the published quota so the run can stop above the floor. */
  const noteQuota = (headers) => {
    const value = Number(headers?.get('x-ratelimit-remaining'));
    if (Number.isFinite(value)) remaining = value;
  };

  const exhausted = () => remaining !== null && remaining < network.rateLimitFloor;

  async function searchPhotos({ query, orientation, page = 1, perPage = 40 }) {
    if (exhausted()) return { ok: false, reason: 'rate limit floor reached', candidates: [] };

    const url = new URL(PHOTO_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    if (orientation) url.searchParams.set('orientation', orientation);
    url.searchParams.set('size', 'large');

    const result = await pace(() => requestJson(url.toString(), requestOptions));
    if (!result.ok) return { ok: false, reason: result.reason, candidates: [] };
    noteQuota(result.headers);

    const candidates = (result.body.photos || []).map((photo) => ({
      source: 'pexels',
      kind: 'photo',
      sourceMediaId: String(photo.id),
      sourcePageUrl: photo.url,
      creator: { name: photo.photographer || 'Unknown', profileUrl: photo.photographer_url || null },
      license: LICENSE,
      width: Number(photo.width) || null,
      height: Number(photo.height) || null,
      durationMs: null,
      // `original` is the full-resolution file. The upload policies allow up to
      // 12000px and 20MB for a post photo, and validation re-measures whatever
      // actually arrives, so taking the original rather than a resized rendition
      // costs bandwidth and never correctness.
      downloadUrl: photo.src?.original || photo.src?.large2x || photo.src?.large,
      extension: guessExtension(photo.src?.original) || '.jpg',
      declaredBytes: null,
      description: photo.alt || null
    })).filter((c) => c.downloadUrl);

    return { ok: true, candidates };
  }

  async function searchVideos({
    query, orientation, page = 1, perPage = 30, preferences
  }) {
    if (exhausted()) return { ok: false, reason: 'rate limit floor reached', candidates: [] };

    const url = new URL(VIDEO_ENDPOINT);
    url.searchParams.set('query', query);
    url.searchParams.set('per_page', String(perPage));
    url.searchParams.set('page', String(page));
    if (orientation) url.searchParams.set('orientation', orientation);

    const result = await pace(() => requestJson(url.toString(), requestOptions));
    if (!result.ok) return { ok: false, reason: result.reason, candidates: [] };
    noteQuota(result.headers);

    const candidates = [];
    for (const video of result.body.videos || []) {
      const rendition = pickRendition(video.video_files || [], preferences);
      if (!rendition) continue;
      candidates.push({
        source: 'pexels',
        kind: 'video',
        sourceMediaId: String(video.id),
        sourcePageUrl: video.url,
        creator: { name: video.user?.name || 'Unknown', profileUrl: video.user?.url || null },
        license: LICENSE,
        width: Number(rendition.width) || Number(video.width) || null,
        height: Number(rendition.height) || Number(video.height) || null,
        durationMs: Number(video.duration) ? Math.round(Number(video.duration) * 1000) : null,
        downloadUrl: rendition.link,
        extension: '.mp4',
        declaredBytes: Number(rendition.size) || null,
        description: null
      });
    }

    return { ok: true, candidates };
  }

  return {
    name: 'pexels',
    searchPhotos,
    searchVideos,
    get remainingQuota() { return remaining; },
    get isExhausted() { return exhausted(); }
  };
}

/**
 * Choose one of a Pexels video's renditions.
 *
 * Prefers the largest MP4 that stays inside the configured ceiling rather than
 * the highest quality on offer: the policy permits 4K at 500MB, and a demo
 * dataset that downloads forty-eight of those is a bad trade for everybody.
 * Falls back to the smallest available when every rendition is over the ceiling,
 * so a clip is skipped for failing validation rather than for having no
 * acceptable size.
 */
function pickRendition(files, preferences) {
  const usable = files
    .filter((f) => f.link && (f.file_type === 'video/mp4' || String(f.link).includes('.mp4')))
    .filter((f) => Number(f.width) > 0 && Number(f.height) > 0);
  if (usable.length === 0) return null;

  const maxWidth = preferences?.preferredMaxWidth ?? 1440;
  const withinCeiling = usable.filter((f) => Number(f.width) <= maxWidth);
  const pool = withinCeiling.length > 0 ? withinCeiling : usable;

  return pool.sort((a, b) => {
    // Largest first inside the ceiling; smallest first when everything is over.
    if (withinCeiling.length > 0) return Number(b.width) - Number(a.width);
    return Number(a.width) - Number(b.width);
  })[0];
}

function guessExtension(url) {
  if (!url) return null;
  const match = String(url).split('?')[0].match(/(\.[a-z0-9]{2,5})$/i);
  return match ? match[1].toLowerCase() : null;
}

module.exports = { createPexelsProvider, PEXELS_LICENSE: LICENSE };
