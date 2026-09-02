/**
 * The media manifest: the contract between the two phases.
 *
 * Phase 1 writes it, phase 2 reads it and nothing else. That is what makes
 * `demo:seed` work with the network unplugged — it never learns a provider's
 * name from anywhere but this file, and never has a URL it could call.
 *
 * The manifest is also the provenance record. For every file it names where it
 * came from, who made it, under what licence, and what the bytes hash to. A
 * dataset that cannot answer those questions cannot be audited when somebody
 * asks a year later why a particular image is in a database.
 *
 * ## De-duplication has two keys, and both are needed
 *
 *  - `source:kind:sourceMediaId` catches re-fetching the same asset: the cheap
 *    check, made before anything is downloaded.
 *  - `sha256` catches the same bytes arriving under different ids — the same
 *    photograph uploaded twice to one provider, or present on both. Only
 *    computable after the download, and the reason a file can be discarded
 *    immediately after being fetched.
 *
 * Neither subsumes the other, so both are enforced.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * Version 2 added `orientation`, `aspectRatio`, and split the single
 * `post-video` purpose into `post-video-landscape` and `post-video-portrait`.
 *
 * A version 1 manifest is **migrated, not discarded**. Every fact the new fields
 * state is already derivable from the `width` and `height` a v1 entry recorded,
 * so upgrading costs one arithmetic pass and saves re-downloading gigabytes of
 * video that is still on disk and still valid.
 */
const MANIFEST_VERSION = 2;

/** sha256 of a file, streamed so a 60MB video is not held in memory. */
function checksumFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function emptyManifest() {
  return {
    version: MANIFEST_VERSION,
    generatedAt: null,
    entries: []
  };
}

function load(manifestPath) {
  if (!fs.existsSync(manifestPath)) return emptyManifest();
  try {
    const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!Array.isArray(parsed.entries)) return emptyManifest();
    if (parsed.version === MANIFEST_VERSION) return parsed;
    if (parsed.version === 1) return migrateV1(parsed);
    // A version this build does not recognise. Rebuilding is slow but correct,
    // and guessing at an unknown shape is neither.
    return emptyManifest();
  } catch {
    // A corrupt manifest means the cache is unusable, not that the run should
    // die: rebuilding it re-downloads, which is slow but always correct.
    return emptyManifest();
  }
}

/**
 * Upgrade a version 1 manifest in place.
 *
 * Both new facts come from dimensions the old entry already recorded, so nothing
 * is re-probed and nothing is re-downloaded. The one judgement call is the
 * purpose split: a v1 `post-video` entry becomes landscape or portrait according
 * to its own measured shape, and a square clip — which satisfies neither
 * requirement — is dropped from the manifest rather than assigned to a bucket it
 * does not belong in. Its file stays on disk and is simply not referenced.
 */
function migrateV1(parsed) {
  const entries = [];
  for (const entry of parsed.entries) {
    const orientation = orientationOf(entry.width, entry.height);
    if (entry.purpose === 'post-video') {
      if (orientation !== 'landscape' && orientation !== 'portrait') continue;
      entries.push({
        ...entry,
        purpose: `post-video-${orientation}`,
        aspectRatio: aspectRatioOf(entry.width, entry.height),
        orientation
      });
      continue;
    }
    entries.push({
      ...entry,
      aspectRatio: aspectRatioOf(entry.width, entry.height),
      orientation
    });
  }
  return { version: MANIFEST_VERSION, generatedAt: parsed.generatedAt, entries };
}

function save(manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  const payload = {
    ...manifest,
    version: MANIFEST_VERSION,
    generatedAt: new Date().toISOString()
  };
  // Write-then-rename, so an interrupted save cannot truncate a good manifest
  // and lose the record of files that are still on disk.
  const temporary = `${manifestPath}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, manifestPath);
}

/** The key that identifies one asset at one provider. */
const sourceKey = (entry) => `${entry.source}:${entry.kind}:${entry.sourceMediaId}`;

/**
 * Index a manifest for the lookups the fetcher makes on every candidate.
 *
 * `mediaDir` is needed because an entry whose file has been deleted from disk
 * must not count as cached — otherwise a run that lost its media directory would
 * report everything present and seed against files that are not there.
 */
function index(manifest, mediaDir) {
  const bySource = new Map();
  const byChecksum = new Map();
  const bySlot = new Map();
  const live = [];

  for (const entry of manifest.entries) {
    const absolute = path.join(mediaDir, entry.localFile);
    if (!fs.existsSync(absolute)) continue;
    // A video entry is only usable with its poster frame.
    if (entry.kind === 'video' && entry.thumbnail
        && !fs.existsSync(path.join(mediaDir, entry.thumbnail.localFile))) continue;

    live.push(entry);
    bySource.set(sourceKey(entry), entry);
    byChecksum.set(entry.checksum, entry);
    const slot = `${entry.theme}:${entry.purpose}`;
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(entry);
  }

  return {
    live,
    hasSource: (source, kind, id) => bySource.has(`${source}:${kind}:${id}`),
    hasChecksum: (sum) => byChecksum.has(sum),
    forSlot: (theme, purpose) => bySlot.get(`${theme}:${purpose}`) || [],
    countFor: (theme, purpose) => (bySlot.get(`${theme}:${purpose}`) || []).length
  };
}

/**
 * Build one manifest entry.
 *
 * Every field the task requires is present and none is optional: an entry that
 * cannot say where a file came from is worse than no entry, because it looks
 * like provenance.
 */
function buildEntry({
  candidate, theme, purpose, localFile, checksum, measured, thumbnail = null
}) {
  return {
    source: candidate.source,
    sourceMediaId: candidate.sourceMediaId,
    sourcePageUrl: candidate.sourcePageUrl,
    creator: {
      name: candidate.creator?.name || 'Unknown',
      profileUrl: candidate.creator?.profileUrl || null
    },
    license: {
      name: candidate.license.name,
      url: candidate.license.url,
      attributionRequired: candidate.license.attributionRequired,
      commercialUse: candidate.license.commercialUse
    },
    theme,
    purpose,
    kind: candidate.kind,
    localFile,
    checksum,
    mimeType: measured.mimeType,
    bytes: measured.bytes,
    width: measured.width,
    height: measured.height,
    // Recorded from the decoded dimensions, never from the search filter that
    // found the file or from anything the provider claimed. `demo:verify`
    // re-probes and fails if these disagree.
    aspectRatio: aspectRatioOf(measured.width, measured.height),
    orientation: orientationOf(measured.width, measured.height),
    durationMs: measured.durationMs ?? null,
    videoCodec: measured.videoCodec ?? null,
    frameRate: measured.frameRate ?? null,
    description: candidate.description || null,
    thumbnail,
    downloadedAt: new Date().toISOString()
  };
}

/** Two decimal places is enough to compare against a probe without float noise. */
function aspectRatioOf(width, height) {
  if (!width || !height) return null;
  return Math.round((width / height) * 100) / 100;
}

/**
 * `landscape` when wider than tall, `portrait` when taller than wide, `square`
 * when neither. Square is named rather than folded into one of the other two:
 * a 1:1 clip satisfies no orientation requirement and should be visible as such
 * rather than counted towards whichever bucket happened to fetch it.
 */
function orientationOf(width, height) {
  if (!width || !height) return null;
  if (width > height) return 'landscape';
  if (height > width) return 'portrait';
  return 'square';
}

/** An entry for a locally generated file, which has no provider or licence. */
function buildGeneratedEntry({
  theme, purpose, localFile, checksum, measured, generator, seed
}) {
  return {
    source: 'generated',
    sourceMediaId: seed,
    sourcePageUrl: null,
    creator: { name: 'Generated locally', profileUrl: null },
    license: {
      name: 'Generated by this repository',
      url: null,
      attributionRequired: false,
      commercialUse: true
    },
    theme,
    purpose,
    kind: 'photo',
    localFile,
    checksum,
    mimeType: measured.mimeType,
    bytes: measured.bytes,
    width: measured.width,
    height: measured.height,
    aspectRatio: aspectRatioOf(measured.width, measured.height),
    orientation: orientationOf(measured.width, measured.height),
    durationMs: null,
    videoCodec: null,
    frameRate: null,
    description: `Procedurally drawn ${purpose} (${generator})`,
    thumbnail: null,
    downloadedAt: new Date().toISOString()
  };
}

module.exports = {
  MANIFEST_VERSION,
  aspectRatioOf,
  orientationOf,
  checksumFile,
  emptyManifest,
  load,
  save,
  index,
  sourceKey,
  buildEntry,
  buildGeneratedEntry
};
