/**
 * Fills one (theme, purpose) slot with validated, de-duplicated media.
 *
 * ## Provider order
 *
 * Pexels is asked for everything first — every query, every page — and Pixabay
 * is only consulted for slots Pexels could not fill. That ordering is a
 * requirement rather than a preference, and it is enforced structurally here
 * (two sequential passes) rather than by a per-candidate rule that a later edit
 * could weaken into "whichever answers first".
 *
 * ## Why a file can be downloaded and then thrown away
 *
 * Three of the checks can only run on bytes that have arrived: the checksum
 * (the same photograph under two ids), the real format (the extension is a
 * claim), and the decode (a header describes an image the file may not contain).
 * Discarding a download is the normal cost of not seeding a broken dataset. A
 * rejected file never counts towards a slot, so the loop simply keeps going —
 * the size pre-filter below is what keeps the wasted transfers rare.
 *
 * ## Progress survives a crash
 *
 * The manifest is saved after every accepted file rather than at the end. A run
 * interrupted after ninety downloads resumes with ninety files cached, which is
 * the difference between a retry costing seconds and costing the whole transfer
 * again.
 */

const fs = require('fs');
const path = require('path');

const logger = require('./logger');
const manifestLib = require('./manifest');
const { downloadToFile, createPacer } = require('./http');
const { validateImage, validateVideo } = require('./validate');
const { extractPosterFrame } = require('./ffmpeg');

/**
 * How a purpose maps onto an upload policy, a search, and a shape.
 *
 * Video is split by orientation. The provider's orientation filter only narrows
 * the search — what a clip actually *is* comes from the width and height ffprobe
 * reports, checked against the shape below. A portrait clip returned by a
 * landscape search is refused rather than relabelled, so the manifest's
 * `orientation` is always a measurement.
 */
const PURPOSE_SPEC = {
  'post-photo': {
    kind: 'photo', uploadType: 'post-photo', orientation: 'portrait', queryKind: 'photo', shapeKey: 'photo'
  },
  'post-video-landscape': {
    kind: 'video', uploadType: 'post-video', orientation: 'landscape', queryKind: 'videoLandscape', shapeKey: 'videoLandscape'
  },
  'post-video-portrait': {
    kind: 'video', uploadType: 'post-video', orientation: 'portrait', queryKind: 'videoPortrait', shapeKey: 'videoPortrait'
  },
  cover: {
    kind: 'photo', uploadType: 'cover', orientation: 'landscape', queryKind: 'cover', shapeKey: 'cover'
  }
};

/** Pages to walk per query before giving up on it. */
const MAX_PAGES_PER_QUERY = 4;

function createFetcher({
  config, manifest, manifestPath, mediaDir, providers
}) {
  const downloadPace = createPacer(config.network.downloadIntervalMs);
  const stats = {
    downloaded: 0, cached: 0, rejected: 0, duplicates: 0, bytes: 0
  };

  const save = () => manifestLib.save(manifestPath, manifest);

  /** Delete a file we have decided not to keep. Never throws. */
  const discard = (absolutePath) => {
    try {
      if (fs.existsSync(absolutePath)) fs.unlinkSync(absolutePath);
    } catch (error) {
      logger.warn(`could not remove rejected file: ${logger.redact(error.message)}`);
    }
  };

  /**
   * Try to turn one search result into a manifest entry.
   *
   * @returns 'accepted' | 'duplicate' | 'rejected' | 'failed'
   */
  async function consider(candidate, theme, purpose, spec) {
    const index = manifestLib.index(manifest, mediaDir);

    // Cheapest rejection first: we already have this asset from this provider.
    if (index.hasSource(candidate.source, candidate.kind, candidate.sourceMediaId)) {
      return 'duplicate';
    }

    // Refuse on the declared size before spending the transfer. Pexels reports
    // `size` on every video rendition, and the first full run threw away 48
    // files after downloading them — mostly 40-180MB videos over the dataset's
    // budget. A declared length is a claim and is never the check that matters,
    // but it is free, and the real measurement still runs on the bytes that
    // arrive.
    const declaredCeiling = config.media[spec.shapeKey]?.maxBytes;
    if (declaredCeiling && candidate.declaredBytes && candidate.declaredBytes > declaredCeiling) {
      return 'rejected';
    }

    const relativeDir = path.join(theme.key, purpose);
    const baseName = `${candidate.source}-${candidate.sourceMediaId}${candidate.extension}`;
    const relativePath = path.join(relativeDir, baseName);
    const absolutePath = path.join(mediaDir, relativePath);

    const download = await downloadPace(() => downloadToFile(candidate.downloadUrl, absolutePath, {
      timeoutMs: config.network.requestTimeoutMs,
      maxRetries: config.network.maxRetries,
      retryBaseDelayMs: config.network.retryBaseDelayMs,
      label: `${candidate.source} ${candidate.kind} ${candidate.sourceMediaId}`
    }));

    if (!download.ok) {
      logger.warn(`${candidate.source}:${candidate.sourceMediaId} download failed — ${download.reason}`);
      return 'failed';
    }

    const checksum = await manifestLib.checksumFile(absolutePath);
    // The same bytes under a different id, possibly from the other provider.
    if (index.hasChecksum(checksum)) {
      discard(absolutePath);
      return 'duplicate';
    }

    const shape = config.media[spec.shapeKey] || {};
    const measured = spec.kind === 'video'
      ? await validateVideo(absolutePath, spec.uploadType, shape)
      : await validateImage(absolutePath, spec.uploadType, shape);

    if (!measured.ok) {
      logger.skip(`${candidate.source}:${candidate.sourceMediaId} rejected — ${measured.reason}`);
      discard(absolutePath);
      return 'rejected';
    }

    let thumbnail = null;
    if (spec.kind === 'video') {
      const built = await buildPosterFrame({
        absolutePath, relativeDir, candidate, measured, theme, purpose
      });
      if (!built.ok) {
        logger.skip(`${candidate.source}:${candidate.sourceMediaId} rejected — ${built.reason}`);
        discard(absolutePath);
        return 'rejected';
      }
      thumbnail = built.thumbnail;
    }

    manifest.entries.push(manifestLib.buildEntry({
      candidate,
      theme: theme.key,
      purpose,
      localFile: toPosix(relativePath),
      checksum,
      measured,
      thumbnail
    }));
    save();

    stats.downloaded += 1;
    stats.bytes += measured.bytes + (thumbnail?.bytes || 0);
    return 'accepted';
  }

  /**
   * Extract and validate a poster frame from the video itself.
   *
   * From the clip rather than from a stock still, so the thumbnail a viewer sees
   * on a feed card is genuinely a frame of the video behind it. Validated as a
   * `post-thumbnail`, because that is the upload type it will be sent under and
   * an unvalidated frame is a rejected upload discovered in phase 2.
   */
  async function buildPosterFrame({
    absolutePath, relativeDir, candidate, measured
  }) {
    const relativePath = path.join(
      relativeDir, `${candidate.source}-${candidate.sourceMediaId}-poster.jpg`
    );
    const posterPath = path.join(mediaDir, relativePath);

    const extracted = await extractPosterFrame(absolutePath, posterPath, measured.durationMs);
    if (!extracted.ok) {
      discard(posterPath);
      return { ok: false, reason: extracted.reason };
    }

    const posterMeasured = await validateImage(posterPath, 'post-thumbnail', {});
    if (!posterMeasured.ok) {
      discard(posterPath);
      return { ok: false, reason: `poster frame invalid — ${posterMeasured.reason}` };
    }

    return {
      ok: true,
      thumbnail: {
        localFile: toPosix(relativePath),
        checksum: await manifestLib.checksumFile(posterPath),
        mimeType: posterMeasured.mimeType,
        bytes: posterMeasured.bytes,
        width: posterMeasured.width,
        height: posterMeasured.height,
        extractedFromSourceVideo: true
      }
    };
  }

  /** Ask one provider for candidates until the slot is full or it runs dry. */
  async function fillFromProvider(provider, theme, purpose, spec, target) {
    const queries = theme.queries[spec.queryKind] || [];

    for (const query of queries) {
      for (let page = 1; page <= MAX_PAGES_PER_QUERY; page += 1) {
        const current = manifestLib.index(manifest, mediaDir).countFor(theme.key, purpose);
        if (current >= target) return;
        if (provider.isExhausted) {
          logger.warn(`${provider.name} quota floor reached, stopping this provider`);
          return;
        }

        const search = spec.kind === 'video'
          ? await provider.searchVideos({
            query,
            orientation: spec.orientation,
            page,
            preferences: config.media[spec.shapeKey]
          })
          : await provider.searchPhotos({ query, orientation: spec.orientation, page });

        if (!search.ok) {
          logger.warn(`${provider.name} search "${query}" p${page} failed — ${search.reason}`);
          break;
        }
        if (search.candidates.length === 0) break;

        // Small batches rather than one at a time: three concurrent transfers
        // keeps the pipe busy without turning a polite script into a swarm.
        for (let i = 0; i < search.candidates.length; i += config.network.downloadConcurrency) {
          const filled = manifestLib.index(manifest, mediaDir).countFor(theme.key, purpose);
          if (filled >= target) return;

          const batch = search.candidates.slice(i, i + config.network.downloadConcurrency);
          const outcomes = await Promise.all(
            batch.map((candidate) => consider(candidate, theme, purpose, spec)
              .catch((error) => {
                logger.warn(`unexpected error on ${candidate.source}:${candidate.sourceMediaId} — ${logger.redact(error.message)}`);
                return 'failed';
              }))
          );
          for (const outcome of outcomes) {
            if (outcome === 'duplicate') stats.duplicates += 1;
            if (outcome === 'rejected') stats.rejected += 1;
          }
        }
      }
    }
  }

  /**
   * Fill one slot, Pexels first and Pixabay only for the shortfall.
   *
   * @returns `{ have, required, target, satisfied }`
   */
  async function fillSlot(theme, purpose, required) {
    const spec = PURPOSE_SPEC[purpose];
    if (!spec) throw new Error(`unknown purpose '${purpose}'`);

    const target = Math.ceil(required * (1 + config.fetchOverheadRatio));
    const before = manifestLib.index(manifest, mediaDir).countFor(theme.key, purpose);
    if (before >= target) {
      stats.cached += before;
      return {
        have: before, required, target, satisfied: true, cachedOnly: true
      };
    }

    await fillFromProvider(providers.primary, theme, purpose, spec, target);

    let have = manifestLib.index(manifest, mediaDir).countFor(theme.key, purpose);
    if (have < required && providers.fallback) {
      logger.detail(`Pexels left ${theme.key}/${purpose} at ${have}/${required} — trying Pixabay`);
      await fillFromProvider(providers.fallback, theme, purpose, spec, target);
      have = manifestLib.index(manifest, mediaDir).countFor(theme.key, purpose);
    }

    return {
      have, required, target, satisfied: have >= required, cachedOnly: false
    };
  }

  return { fillSlot, stats, save };
}

/** Manifest paths are POSIX-style so a dataset fetched on Windows reads on Linux. */
const toPosix = (relativePath) => relativePath.split(path.sep).join('/');

module.exports = { createFetcher, PURPOSE_SPEC, toPosix };
