/**
 * Media validation for the fetch phase.
 *
 * ## Why validate here at all
 *
 * The file server is the authority and re-checks everything on upload. This runs
 * earlier for one reason: a file that is going to be refused should be found in
 * phase 1, where the answer is "fetch a different one", rather than in phase 2,
 * where it is "the dataset is short a post". Nothing here is permission to skip
 * a server-side check, and phase 2 still fails loudly if an upload is rejected.
 *
 * ## What a file *is* comes from its bytes
 *
 * Not from the extension, not from the URL, not from the `Content-Type` a CDN
 * returned. Renaming `clip.mp4` to `photo.png` changes all three at once. Every
 * decision below starts from a magic-byte sniff and is confirmed by a decode.
 *
 * ## Bytes are not a size limit
 *
 * A flat 30000x30000 PNG is a few hundred kilobytes on disk and nine hundred
 * megapixels in memory. Pixels are bounded separately from bytes, and each side
 * separately again so a pathological aspect ratio cannot pass on area alone.
 *
 * The per-axis limits come from `@douyin-clone/upload-policy` — the same module
 * the API and the file server read, so a file accepted here is one the pipeline
 * will accept, and tightening a limit in one place tightens it here too.
 */

const fs = require('fs');
const { getUploadPolicy } = require('@douyin-clone/upload-policy');

const { probeVideo, decodesNearEnd } = require('./ffmpeg');
const { execFile } = require('child_process');

/**
 * Identify a file from its leading bytes.
 *
 * Returns a format name matching the vocabulary the upload policies use
 * (`jpeg`, `png`, `webp`, ...), or null when the bytes are not something the
 * project accepts. SVG is deliberately absent: it is a scriptable document, not
 * a raster image, and the pipeline refuses it.
 */
function sniffFormat(filePath) {
  let handle;
  try {
    handle = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(16);
    const read = fs.readSync(handle, header, 0, 16, 0);
    if (read < 12) return null;

    if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) return 'jpeg';
    if (header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) return 'png';
    if (header.subarray(0, 3).toString('ascii') === 'GIF') return 'gif';
    if (header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
    if (header.subarray(0, 4).equals(Buffer.from([0x1A, 0x45, 0xDF, 0xA3]))) return 'webm';

    // ISO base media: the box type sits at offset 4, the brand at 8.
    if (header.subarray(4, 8).toString('ascii') === 'ftyp') {
      const brand = header.subarray(8, 12).toString('ascii').trim().toLowerCase();
      if (brand.startsWith('avif') || brand.startsWith('avis')) return 'avif';
      if (brand.startsWith('heic') || brand.startsWith('heix') || brand.startsWith('mif1')) return 'heic';
      if (brand.startsWith('qt')) return 'mov';
      return 'mp4';
    }

    return null;
  } catch {
    return null;
  } finally {
    if (handle !== undefined) try { fs.closeSync(handle); } catch { /* already gone */ }
  }
}

/** Container name as the video policy spells it. */
const CONTAINER_BY_FORMAT = { mp4: 'mp4', mov: 'mov', webm: 'webm' };

function runFfprobeJson(filePath, extraArgs = []) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'error', '-print_format', 'json', '-show_streams', ...extraArgs, filePath
    ], { timeout: 60000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL', windowsHide: true },
    (error, stdout) => {
      if (error) return resolve(null);
      try { return resolve(JSON.parse(stdout)); } catch { return resolve(null); }
    });
  });
}

/** Fully decode a still image, so a truncated file behind a good header fails. */
function decodesFully(filePath) {
  return new Promise((resolve) => {
    execFile('ffmpeg', [
      '-v', 'error', '-xerror', '-i', filePath, '-f', 'null', '-'
    ], { timeout: 60000, maxBuffer: 256 * 1024, killSignal: 'SIGKILL', windowsHide: true },
    (error) => resolve(!error));
  });
}

/**
 * Validate a downloaded still image against one upload type's policy plus the
 * demo dataset's own shape preferences.
 *
 * @returns `{ ok }` or `{ ok: false, reason }`. Reasons are written here and
 *   never quoted from a decoder.
 */
async function validateImage(filePath, uploadType, shape = {}) {
  const policy = getUploadPolicy(uploadType);
  // An unregistered type is a bug, never a licence to skip the check.
  if (!policy) return { ok: false, reason: `no upload policy registered for '${uploadType}'` };

  const format = sniffFormat(filePath);
  if (!format) return { ok: false, reason: 'unrecognised file signature' };
  if (!policy.allowedFormats.includes(format)) {
    return { ok: false, reason: `format '${format}' is not allowed for ${uploadType}` };
  }

  const bytes = fs.statSync(filePath).size;
  if (bytes > policy.maxBytes) {
    return { ok: false, reason: `${(bytes / 1048576).toFixed(1)}MB exceeds the ${uploadType} byte limit` };
  }
  if (bytes === 0) return { ok: false, reason: 'file is empty' };

  const probe = await runFfprobeJson(filePath);
  const stream = probe?.streams?.find((s) => s.codec_type === 'video');
  const width = Number(stream?.width ?? 0);
  const height = Number(stream?.height ?? 0);
  if (!width || !height) return { ok: false, reason: 'dimensions could not be read' };

  if (width > policy.maxWidth || height > policy.maxHeight) {
    return { ok: false, reason: `${width}x${height} exceeds the ${uploadType} dimension limit` };
  }
  if (width * height > policy.maxPixels) {
    return { ok: false, reason: `${(width * height / 1e6).toFixed(1)}MP exceeds the ${uploadType} pixel budget` };
  }

  // Dataset shape preferences, separate from the policy: the policy says what
  // the product accepts, these say what looks right in a vertical feed.
  const aspect = width / height;
  if (shape.minAspect && aspect < shape.minAspect) {
    return { ok: false, reason: `aspect ${aspect.toFixed(2)} is narrower than ${shape.minAspect}` };
  }
  if (shape.maxAspect && aspect > shape.maxAspect) {
    return { ok: false, reason: `aspect ${aspect.toFixed(2)} is wider than ${shape.maxAspect}` };
  }
  if (shape.minWidth && width < shape.minWidth) {
    return { ok: false, reason: `${width}px wide is below the ${shape.minWidth}px minimum` };
  }
  if (shape.minHeight && height < shape.minHeight) {
    return { ok: false, reason: `${height}px tall is below the ${shape.minHeight}px minimum` };
  }

  // Last, because it is the expensive one: a header can describe an image the
  // file does not actually contain.
  if (!await decodesFully(filePath)) {
    return { ok: false, reason: 'image is truncated or does not decode' };
  }

  return {
    ok: true, format, width, height, bytes, mimeType: mimeForFormat(format)
  };
}

/**
 * Validate a downloaded video.
 *
 * Uses the video policy and a video probe — never the image validator. They
 * answer different questions: an audio file renamed `.mp4` is a perfectly valid
 * MP4, and only counting non-`attached_pic` video streams catches it.
 */
async function validateVideo(filePath, uploadType, shape = {}) {
  const policy = getUploadPolicy(uploadType);
  if (!policy) return { ok: false, reason: `no upload policy registered for '${uploadType}'` };

  const format = sniffFormat(filePath);
  const container = CONTAINER_BY_FORMAT[format];
  if (!container) return { ok: false, reason: 'unrecognised or non-video file signature' };
  if (!policy.allowedContainers.includes(container)) {
    return { ok: false, reason: `container '${container}' is not allowed for ${uploadType}` };
  }

  const bytes = fs.statSync(filePath).size;
  if (bytes === 0) return { ok: false, reason: 'file is empty' };
  if (bytes > policy.maxBytes) {
    return { ok: false, reason: `${(bytes / 1048576).toFixed(1)}MB exceeds the ${uploadType} byte limit` };
  }

  const probe = await probeVideo(filePath);
  if (!probe.ok) return { ok: false, reason: probe.reason };
  const info = probe.info;

  if (!policy.allowedVideoCodecs.includes(info.videoCodec)) {
    return { ok: false, reason: `video codec '${info.videoCodec}' is not playable by the pipeline` };
  }
  if (info.audioCodec && !policy.allowedAudioCodecs.includes(info.audioCodec)) {
    return { ok: false, reason: `audio codec '${info.audioCodec}' is not supported` };
  }

  // The policy's resolution limit is orientation-aware: the long edge may reach
  // maxWidth and the short edge maxHeight, whichever way the clip was shot.
  const longEdge = Math.max(info.width, info.height);
  const shortEdge = Math.min(info.width, info.height);
  if (longEdge > policy.maxWidth || shortEdge > policy.maxHeight) {
    return { ok: false, reason: `${info.width}x${info.height} exceeds the ${uploadType} resolution limit` };
  }
  if (info.durationMs > policy.maxDurationMs) {
    return { ok: false, reason: `${Math.round(info.durationMs / 1000)}s exceeds the ${uploadType} duration limit` };
  }
  if (info.frameRate && info.frameRate > policy.maxFrameRate) {
    return { ok: false, reason: `${info.frameRate}fps exceeds the ${uploadType} frame-rate limit` };
  }

  // Dataset ceiling, separate from and stricter than the policy's byte limit.
  if (shape.maxBytes && bytes > shape.maxBytes) {
    return {
      ok: false,
      reason: `${(bytes / 1048576).toFixed(1)}MB is over the dataset's ${Math.round(shape.maxBytes / 1048576)}MB video budget`
    };
  }

  const aspect = info.width / info.height;
  if (shape.minAspect && aspect < shape.minAspect) {
    return { ok: false, reason: `aspect ${aspect.toFixed(2)} is narrower than ${shape.minAspect}` };
  }
  if (shape.maxAspect && aspect > shape.maxAspect) {
    return { ok: false, reason: `aspect ${aspect.toFixed(2)} is wider than ${shape.maxAspect}` };
  }
  if (shape.minWidth && info.width < shape.minWidth) {
    return { ok: false, reason: `${info.width}px wide is below the ${shape.minWidth}px minimum` };
  }
  if (shape.minHeight && info.height < shape.minHeight) {
    return { ok: false, reason: `${info.height}px tall is below the ${shape.minHeight}px minimum` };
  }
  if (shape.minDurationMs && info.durationMs < shape.minDurationMs) {
    return { ok: false, reason: `${Math.round(info.durationMs / 1000)}s is shorter than the dataset minimum` };
  }
  if (shape.maxDurationMs && info.durationMs > shape.maxDurationMs) {
    return { ok: false, reason: `${Math.round(info.durationMs / 1000)}s is longer than the dataset maximum` };
  }

  // A container that probes cleanly is not a video that exists. A faststart MP4
  // truncated to a third of its length reports a full duration from its header;
  // the failure only appears when something decodes the tail.
  const tail = await decodesNearEnd(filePath, info.durationMs);
  if (!tail.ok) return { ok: false, reason: tail.reason };

  return {
    ok: true,
    format,
    container,
    bytes,
    width: info.width,
    height: info.height,
    durationMs: info.durationMs,
    frameRate: info.frameRate,
    videoCodec: info.videoCodec,
    audioCodec: info.audioCodec,
    mimeType: mimeForFormat(format)
  };
}

function mimeForFormat(format) {
  return {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    mp4: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm'
  }[format] || 'application/octet-stream';
}

module.exports = {
  sniffFormat, validateImage, validateVideo, mimeForFormat
};
