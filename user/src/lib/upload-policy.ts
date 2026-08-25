'use client';

import {
  getUploadPolicy,
  UPLOAD_ERROR_MESSAGES,
  UploadPolicy
} from '@douyin-clone/upload-policy';
import {
  detectImageFormat,
  DIMENSION_SCAN_BYTES,
  ImageMeasurement,
  readGifAnimation,
  readImageDimensions
} from '@lib/image-probe';
import { getUploadPolicies } from '@services/setting.service';

/**
 * The composer's side of the per-type upload policy.
 *
 * ## What this is for, and what it is not
 *
 * Every number here comes from `@douyin-clone/upload-policy`, the same module
 * the API and the file server import. There is no client copy to drift: a limit
 * changed in that package changes all three at once, and
 * `upload-policy-contract.spec.ts` fails if the installed copy falls behind the
 * repository — which Yarn v1's `file:` *copying* makes a real and invisible risk.
 *
 * None of it is enforcement. The file server decodes the picture or probes the
 * video and is the only side whose answer counts; it is never permitted to skip
 * a check because the client claims to have run one. What checking here buys is
 * that an obviously wrong file never costs an upload, never creates a record to
 * clean up, and never replaces a valid attachment with one that was always going
 * to be refused.
 *
 * ## Why the type is the argument
 *
 * The old client had a `FILE_VALIDATION_PRESETS.IMAGE` with `maxSizeMB: 5` that
 * some pickers used and others did not, and a `VIDEO` preset at 2048MB that no
 * server ever agreed with. Both were guesses. Now a picker names the durable
 * upload type it is about to request — the same string the API writes onto the
 * file record — and gets exactly the limits that upload will be held to.
 */

export type { UploadPolicy };

/**
 * ## Defaults in the bundle, the real numbers from the API
 *
 * Some limits can be changed by an operator in Admin → Settings, so the bundled
 * registry is the *default*, not necessarily what this upload will be held to.
 * `GET /settings/upload-policies` returns the effective policy for every type,
 * already resolved and already in the units the checks use.
 *
 * What is cached here is a convenience with a short life. A stale client shows a
 * slightly wrong number before an upload; it cannot allow one, because the file
 * server judges the bytes against the limits bound to the durable record. So the
 * TTL is chosen to keep a long-lived tab roughly current, not to be a
 * consistency mechanism.
 *
 * A failed fetch is not an error state: the bundled defaults are known good and
 * are what a blank database uses anyway.
 */
const EFFECTIVE_POLICY_TTL_MS = 5 * 60 * 1000;

let effectivePolicies: Record<string, UploadPolicy> | null = null;
let effectivePoliciesFetchedAt = 0;
let inFlight: Promise<void> | null = null;

/**
 * Make sure the effective policies are loaded, at most once at a time.
 *
 * Concurrent callers share one request: a picker that judges twelve files at
 * once must not open twelve identical fetches.
 */
export async function ensureEffectiveUploadPolicies(): Promise<void> {
  const fresh = effectivePolicies && (Date.now() - effectivePoliciesFetchedAt) < EFFECTIVE_POLICY_TTL_MS;
  if (fresh) return;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const loaded = await getUploadPolicies();
      if (loaded && typeof loaded === 'object') {
        effectivePolicies = loaded as Record<string, UploadPolicy>;
        effectivePoliciesFetchedAt = Date.now();
      }
    } catch {
      // Keep whatever we had — or the bundled defaults. An upload picker that
      // refused to work because a settings endpoint was briefly unavailable
      // would be worse than one showing last week's number.
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Drop the cache. For tests, and for a surface that needs a guaranteed re-read. */
export function resetEffectiveUploadPolicies(): void {
  effectivePolicies = null;
  effectivePoliciesFetchedAt = 0;
  inFlight = null;
}

/**
 * The durable upload types, named once so a picker cannot mistype one.
 *
 * These are the exact strings the API writes onto the file record, which is what
 * makes them the key the registry is looked up by. A typo would resolve to no
 * policy at all — and `uploadPolicyFor` returning `null` is refused rather than
 * waved through — so getting it wrong is loud rather than silent. Naming them
 * here means it does not happen in the first place.
 */
export const AVATAR_UPLOAD_TYPE = 'avatar';
export const COVER_UPLOAD_TYPE = 'cover';
export const POST_PHOTO_UPLOAD_TYPE = 'post-photo';
export const POST_THUMBNAIL_UPLOAD_TYPE = 'post-thumbnail';
export const POST_VIDEO_UPLOAD_TYPE = 'post-video';
export const POST_TEASER_UPLOAD_TYPE = 'post-teaser';
export const MESSAGE_PHOTO_UPLOAD_TYPE = 'message-photo';
export const MESSAGE_VIDEO_UPLOAD_TYPE = 'message-video';

/**
 * The policy for a durable upload type, or `null` if it is not registered.
 *
 * The effective policy when one has been loaded, the bundled default otherwise.
 * Synchronous on purpose: it is called from render (`accept` attributes, limit
 * labels) where an await is not available, and the default is always a usable
 * answer. `ensureEffectiveUploadPolicies()` is what makes it the *current* one.
 */
export function uploadPolicyFor(type: string): UploadPolicy | null {
  const fallback = getUploadPolicy(type);
  if (!fallback) return null;
  const effective = effectivePolicies?.[type];
  // A malformed payload must not be able to remove a limit: only an object that
  // actually carries the axes is preferred over the default.
  if (effective && typeof effective === 'object' && Number.isFinite((effective as any).maxBytes)) {
    return effective;
  }
  return fallback;
}

/**
 * What a file input should advertise for this upload type.
 *
 * A hint to the picker and never a check: `accept` is trivially bypassed by
 * choosing "All files", and on some platforms it is ignored outright. It is
 * worth setting because it saves people from picking a file that will be
 * refused, and worth never trusting because it decides nothing.
 *
 * Returns `''` for an unknown type rather than a permissive `*`, so a typo
 * narrows the picker instead of widening it.
 */
export function acceptAttributeFor(type: string): string {
  return uploadPolicyFor(type)?.acceptAttribute ?? '';
}

/** The message that belongs to a rejection code, or `null` if it is not ours. */
export function messageForUploadError(code: string | null | undefined): string | null {
  if (!code) return null;
  return UPLOAD_ERROR_MESSAGES[code] || null;
}

/**
 * The stable code a failed upload carried, wherever the transport put it.
 *
 * Matched on instead of the message, always. Wording gets reworded and
 * translated; the code is the contract.
 */
export function readUploadErrorCode(error: any): string | null {
  if (!error) return null;
  if (typeof error === 'string') return null;
  if (typeof error.errorCode === 'string') return error.errorCode;
  if (typeof error.code === 'string') return error.code;
  const body = error?.response?.data || error?.data || error;
  return body?.error || body?.message?.error || null;
}

/**
 * Everything about a picked file that can be judged without reading it.
 *
 * Split from the byte-reading check so the size and MIME rules stay synchronous
 * and free: a 900MB video is refused on its declared size alone, without a read
 * and without a decode.
 *
 * The MIME check is a whitelist rather than `startsWith('image/')`, because that
 * would admit SVG — the one "image" type that is really a scriptable document.
 * A file with no `type` at all is passed through: some platforms report nothing,
 * and the server settles it from the bytes.
 */
export function classifyPickedFile(file: File, type: string): string | null {
  const policy = uploadPolicyFor(type);
  if (!policy) return 'UNSUPPORTED_UPLOAD_TYPE';
  if (!file || !file.size) return policy.codes.format;
  if (file.size > policy.maxBytes) return policy.codes.fileTooLarge;
  if (file.type && !policy.allowedMimeTypes.includes(file.type.toLowerCase())) {
    return policy.codes.format;
  }
  return null;
}

/**
 * Which limit a set of measurements breaks, or `null` if none.
 *
 * Width, height, pixels, frames and duration all report the same code because
 * they are the same answer to whoever picked the file: the picture is fine,
 * there is too much of it. A smaller or shorter copy of the very same file goes
 * through.
 */
export function classifyMeasuredImage(
  measurement: ImageMeasurement | null,
  type: string
): string | null {
  const policy = uploadPolicyFor(type);
  if (!policy || policy.mediaKind !== 'image') return null;
  if (!measurement) return null;

  const {
    width, height, frames, durationMs
  } = measurement;

  if (!width || !height || width < 0 || height < 0) return policy.codes.format;
  if (width > policy.maxWidth || height > policy.maxHeight) return policy.codes.dimensions;

  const countedFrames = frames && frames > 0 ? frames : 1;
  if (countedFrames > policy.maxFrames) return policy.codes.dimensions;
  if (width * height * countedFrames > policy.maxPixels) return policy.codes.dimensions;
  if (typeof durationMs === 'number' && durationMs > policy.maxDurationMs) {
    return policy.codes.dimensions;
  }

  return null;
}

/**
 * The full image check, including the file's actual first bytes.
 *
 * A read that fails resolves to `null` rather than to a rejection: the browser
 * could not answer, so the question goes to the server instead of blocking a
 * file that may well be fine.
 */
export async function classifyPickedImage(file: File, type: string): Promise<string | null> {
  await ensureEffectiveUploadPolicies();
  const policy = uploadPolicyFor(type);
  if (!policy) return 'UNSUPPORTED_UPLOAD_TYPE';

  const cheap = classifyPickedFile(file, type);
  if (cheap) return cheap;
  if (policy.mediaKind !== 'image') return null;

  try {
    // One read answers both questions: the first bytes say what the file is,
    // and the same bytes say how big the picture is.
    const header = new Uint8Array(await file.slice(0, DIMENSION_SCAN_BYTES).arrayBuffer());
    const format = detectImageFormat(header);
    if (!format) return policy.codes.format;

    // Decodable is not the same as allowed here. An animated GIF is a fine
    // message picture and not a fine avatar, and the policy's list is what
    // separates them — checked against the format read from the bytes, never
    // against the MIME the browser guessed from the extension.
    if (!policy.allowedFormats.includes(format)) return policy.codes.format;

    const size = readImageDimensions(header);
    if (!size) return null;

    // Only a GIF needs the rest of its bytes, and only to count frames — the one
    // thing its header does not state. Every other format has already answered.
    let animation: { frames: number; durationMs: number } | null = null;
    if (format === 'gif') {
      try {
        animation = readGifAnimation(
          new Uint8Array(await file.arrayBuffer()),
          policy.maxFrames,
          policy.maxBytes
        );
      } catch {
        animation = null;
      }
    }

    return classifyMeasuredImage({
      width: size.width,
      height: size.height,
      frames: animation?.frames ?? null,
      durationMs: animation?.durationMs ?? null
    }, type);
  } catch {
    return null;
  }
}

/**
 * How long a picked video runs, without decoding a frame of it.
 *
 * `<video preload="metadata">` reads the container's header and stops, which is
 * the browser's own version of `ffprobe -show_format`. It never allocates a
 * decode surface, so measuring a 500MB clip costs the same as measuring a small
 * one.
 *
 * Resolves `null` when the browser cannot answer — a codec it does not ship, a
 * container it will not open, a metadata event that never fires. That is not a
 * rejection: the file server probes properly, and refusing here on the browser's
 * inability would block, for example, a perfectly good HEVC clip in Firefox.
 */
function measureVideo(file: File): Promise<{ durationMs: number; width: number; height: number } | null> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
      resolve(null);
      return;
    }

    const element = document.createElement('video');
    const url = URL.createObjectURL(file);
    let settled = false;
    // A holder rather than a bare `let`, because `finish` has to clear the
    // timeout and the timeout has to call `finish` — one of the two must be
    // reachable before it is created, and a `const` object with a mutable field
    // is the version of that which needs no forward reference.
    const handle: { timer?: ReturnType<typeof setTimeout> } = {};

    const finish = (value: { durationMs: number; width: number; height: number } | null) => {
      if (settled) return;
      settled = true;
      if (handle.timer) clearTimeout(handle.timer);
      element.removeAttribute('src');
      // The element is discarded either way; revoking is what actually releases
      // the file, and leaking one object URL per pick adds up over a session.
      try {
        element.load();
      } catch { /* nothing to abort */ }
      URL.revokeObjectURL(url);
      resolve(value);
    };

    // A metadata event that never fires must not leave the picker waiting. Two
    // seconds is far longer than a header read and short enough not to be felt.
    handle.timer = setTimeout(() => finish(null), 2000);

    element.preload = 'metadata';
    element.muted = true;
    element.onloadedmetadata = () => {
      const seconds = element.duration;
      finish(Number.isFinite(seconds) && seconds > 0
        ? {
          durationMs: Math.round(seconds * 1000),
          width: element.videoWidth || 0,
          height: element.videoHeight || 0
        }
        : null);
    };
    element.onerror = () => finish(null);
    element.src = url;
  });
}

/**
 * The full video check the browser is able to make.
 *
 * Deliberately much thinner than the server's: it cannot name a codec, cannot
 * count streams and cannot tell a truncated container from an intact one. What
 * it can do is refuse the two mistakes people actually make — a clip that is far
 * too long, and one shot at a resolution nothing will play — before spending
 * minutes uploading it.
 *
 * Everything it cannot answer resolves to `null` and goes to the server.
 */
export async function classifyPickedVideo(file: File, type: string): Promise<string | null> {
  await ensureEffectiveUploadPolicies();
  const policy = uploadPolicyFor(type);
  if (!policy) return 'UNSUPPORTED_UPLOAD_TYPE';

  const cheap = classifyPickedFile(file, type);
  if (cheap) return cheap;
  if (policy.mediaKind !== 'video') return null;

  const measured = await measureVideo(file);
  if (!measured) return null;

  if (measured.durationMs > policy.maxDurationMs) return policy.codes.duration;

  // Orientation-aware, exactly as the server is: a portrait phone recording is
  // the same amount of video as the same clip rotated.
  const longEdge = Math.max(measured.width, measured.height);
  const shortEdge = Math.min(measured.width, measured.height);
  if (longEdge > policy.maxWidth || shortEdge > policy.maxHeight) {
    return policy.codes.resolution;
  }

  return null;
}

/**
 * The one call a picker needs: judge this file for this upload type.
 *
 * Dispatches on the policy's media kind rather than on the file's claimed MIME,
 * because the upload type is the thing that is actually decided — a picker that
 * asked for an avatar is asking about an image whatever the file says it is.
 */
export async function classifyPickedUpload(file: File, type: string): Promise<string | null> {
  await ensureEffectiveUploadPolicies();
  const policy = uploadPolicyFor(type);
  if (!policy) return 'UNSUPPORTED_UPLOAD_TYPE';
  return policy.mediaKind === 'video'
    ? classifyPickedVideo(file, type)
    : classifyPickedImage(file, type);
}

/** The same judgement, as the message a toast would show, or `null` if it passes. */
export async function describeRejectedUpload(file: File, type: string): Promise<string | null> {
  if (!file) return 'No file selected.';
  const code = await classifyPickedUpload(file, type);
  if (!code) return null;
  return messageForUploadError(code) || 'That file cannot be uploaded.';
}

/**
 * The message to show for a failed upload request.
 *
 * The server's code decides; its prose is never parsed. A failure carrying no
 * code we recognise falls back to the caller's wording, because inventing a
 * reason for an unknown failure is worse than saying the upload failed.
 */
export function describeUploadFailure(error: any, fallback: string): string {
  return messageForUploadError(readUploadErrorCode(error)) || fallback;
}
