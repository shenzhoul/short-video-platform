import {
  getUploadPolicy,
  UNSUPPORTED_UPLOAD_TYPE,
  UPLOAD_ERROR_MESSAGES,
  UPLOAD_ERROR_STATUS,
  UPLOAD_HARD_CEILINGS,
  UPLOAD_POLICIES
} from '@douyin-clone/upload-policy';

/**
 * Which rules an upload is held to, and what a refusal is called.
 *
 * ## One policy per durable type, and no "generic" tier
 *
 * This file used to hold two tiers: the comment-image policy, and a generic one
 * that every other upload fell into with no byte, pixel, frame or duration cap
 * at all. That split was written to undo a worse bug — the comment limits
 * leaking onto post photos and avatars nobody had chosen them for — but it left
 * most of the product's uploads governed by the absence of a policy rather than
 * by one.
 *
 * Now every durable type names its own, in `@douyin-clone/upload-policy`, and
 * the numbers live there once so the API, this service and the web client all
 * read the same table. This module is the file server's half: it turns a durable
 * file record into the policy that applies to it, and refuses when there is not
 * one.
 *
 * ## The only input that may decide this
 *
 * `type` is written onto the file record when the **API** asks this service for
 * an upload URL — a server-to-server call behind the internal API guard, naming
 * `comment-photo`, `post-photo`, `post-video` and so on. The uploader never
 * supplies it. The TUS transfer is then bound to that record by a signed token
 * carrying the file id, so the bytes that arrive cannot be attached to a
 * different record than the one the API created.
 *
 * That is why the parameter is the record and not the request. TUS metadata —
 * `filename`, `filetype`, anything else the client sends — is chosen by whoever
 * uploads, so selecting a policy from it would let an uploader opt out of a
 * limit by relabelling their upload, and equally let them impose someone else's
 * limits on it. Neither is a decision the uploader gets to make, and both
 * directions are covered by `scripts/verify-upload-policies.js`.
 *
 * ## Failing closed
 *
 * An unrecognised or missing type resolves to `null`, and callers turn that into
 * `UNSUPPORTED_UPLOAD_TYPE`. It deliberately does **not** fall back to something
 * permissive: a typo like `post-phto` and a type somebody forgot to register
 * look identical from here, and quietly uploading either under a wider policy is
 * exactly the failure this registry exists to remove.
 *
 * ## Adjusted limits, and why they ride on the record
 *
 * Some of the numbers can be changed by an operator in Admin → Settings. The API
 * resolves them and writes them onto the durable file record as
 * `metadata.uploadLimits` when the upload URL is issued; this module merges them
 * over the defaults.
 *
 * Carrying them on the record rather than reading settings here buys two things.
 * An upload is judged by the policy that was in force when its **token** was
 * issued, so lowering a limit does not retroactively refuse a transfer already
 * in progress. And this service stays ignorant of the settings collection — it
 * has no Redis subscription to the settings channel and needs none.
 *
 * They are **not** taken on trust. Every value is clamped to
 * `UPLOAD_HARD_CEILINGS` here as well as in the API: this is the process that
 * would have to allocate the memory, and a number that arrives over an internal
 * API is still a number from somewhere else. A value that is missing, not a
 * finite positive number, or past the ceiling falls back to the default for that
 * one field.
 */

export interface ImageLimits {
  /** Largest the file may be, in bytes. */
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  /** Total decoded pixels across every frame. */
  maxPixels: number;
  maxFrames: number;
  /** Playing time, enforced only when the decoder reports per-frame delays. */
  maxDurationMs: number;
}

export interface ImageErrorContract {
  /** Not an image at all: wrong container, corrupt bytes, or a liar. */
  format: string;
  /** Too many bytes. */
  fileTooLarge: string;
  /** Too much picture: width, height, pixels, frames or playing time. */
  dimensions: string;
}

export interface ImageUploadPolicy {
  /** For logs and for the runtime harness's report. */
  name: string;
  mediaKind: 'image';
  limits: ImageLimits;
  /** Formats decided from the bytes — never from a MIME or an extension. */
  allowedFormats: readonly string[];
  /** Whether the pipeline keeps multi-frame input moving. */
  preserveAnimation: boolean;
  codes: ImageErrorContract;
  /** The HTTP status that belongs to each code. */
  statuses: Record<string, number>;
  /** What the reader is shown, one message per code. */
  messages: Record<string, string>;
}

export interface VideoLimits {
  maxBytes: number;
  /** The long edge. Orientation-aware — see {@link VideoUploadPolicy}. */
  maxWidth: number;
  /** The short edge. */
  maxHeight: number;
  maxDurationMs: number;
  maxFrameRate: number;
  maxVideoBitrate: number;
}

export interface VideoErrorContract {
  format: string;
  fileTooLarge: string;
  duration: string;
  resolution: string;
  frameRate: string;
  codec: string;
}

export interface VideoUploadPolicy {
  name: string;
  mediaKind: 'video';
  limits: VideoLimits;
  /** Containers decided by probing the bytes, never by the extension. */
  allowedContainers: readonly string[];
  allowedVideoCodecs: readonly string[];
  allowedAudioCodecs: readonly string[];
  codes: VideoErrorContract;
  statuses: Record<string, number>;
  messages: Record<string, string>;
}

export type UploadPolicy = ImageUploadPolicy | VideoUploadPolicy;

const toImagePolicy = (spec: any): ImageUploadPolicy => ({
  name: spec.type,
  mediaKind: 'image',
  limits: {
    maxBytes: spec.maxBytes,
    maxWidth: spec.maxWidth,
    maxHeight: spec.maxHeight,
    maxPixels: spec.maxPixels,
    maxFrames: spec.maxFrames,
    maxDurationMs: spec.maxDurationMs
  },
  allowedFormats: spec.allowedFormats,
  preserveAnimation: spec.preserveAnimation,
  codes: spec.codes,
  statuses: spec.statuses,
  messages: spec.messages
});

const toVideoPolicy = (spec: any): VideoUploadPolicy => ({
  name: spec.type,
  mediaKind: 'video',
  limits: {
    maxBytes: spec.maxBytes,
    maxWidth: spec.maxWidth,
    maxHeight: spec.maxHeight,
    maxDurationMs: spec.maxDurationMs,
    maxFrameRate: spec.maxFrameRate,
    maxVideoBitrate: spec.maxVideoBitrate
  },
  allowedContainers: spec.allowedContainers,
  allowedVideoCodecs: spec.allowedVideoCodecs,
  allowedAudioCodecs: spec.allowedAudioCodecs,
  codes: spec.codes,
  statuses: spec.statuses,
  messages: spec.messages
});

/** Every policy in the registry, in this service's own vocabulary. */
export const UPLOAD_POLICY_BY_TYPE: Readonly<Record<string, UploadPolicy>> = Object.freeze(
  Object.fromEntries(
    Object.entries(UPLOAD_POLICIES).map(([type, spec]: [string, any]) => [
      type,
      spec.mediaKind === 'video' ? toVideoPolicy(spec) : toImagePolicy(spec)
    ])
  )
);

/** The record fields each policy shape may have adjusted. */
const ADJUSTABLE: Record<'image' | 'video', string[]> = {
  image: ['maxBytes', 'maxWidth', 'maxHeight', 'maxPixels', 'maxFrames', 'maxDurationMs'],
  video: ['maxBytes', 'maxWidth', 'maxHeight', 'maxDurationMs', 'maxFrameRate']
};

/**
 * Merge the record's adjusted limits over a default policy, clamped.
 *
 * Field by field on purpose: one unusable number costs that one limit its
 * override and leaves the rest of the policy alone, so a partially written
 * record still produces a complete, enforceable policy rather than a hole.
 */
function withRecordLimits<T extends UploadPolicy>(policy: T, recordLimits: any): T {
  if (!recordLimits || typeof recordLimits !== 'object') return policy;

  const ceilings: Record<string, number> = (UPLOAD_HARD_CEILINGS as any)[policy.mediaKind] || {};
  // Loosely typed on purpose: the fields being written are chosen at runtime
  // from `ADJUSTABLE`, so there is no index signature TypeScript can check them
  // against. The shape is restored by spreading it back over `policy`, which
  // keeps the union's discriminant and therefore the caller's narrowing.
  const limits: any = { ...policy.limits };
  let changed = false;

  for (const field of ADJUSTABLE[policy.mediaKind]) {
    const value = Number(recordLimits[field]);
    if (!Number.isFinite(value) || value <= 0) continue;

    const ceiling = ceilings[field];
    const clamped = ceiling ? Math.min(value, ceiling) : value;
    if (clamped !== limits[field]) {
      limits[field] = clamped;
      changed = true;
    }
  }

  if (!changed) return policy;
  return { ...policy, limits };
}

/**
 * The policy for a pending upload, chosen from the durable file record.
 *
 * Returns `null` for a type the registry does not know. Callers must refuse
 * rather than substitute a default — see the module comment for why.
 *
 * The record's `metadata.uploadLimits` — written by the API, never by the
 * uploader — adjusts the default's numbers within the hard ceilings.
 */
export function resolveUploadPolicy(
  fileRecord: { type?: string; metadata?: any } | null | undefined
): UploadPolicy | null {
  const spec = getUploadPolicy(fileRecord?.type);
  if (!spec) return null;
  return withRecordLimits(UPLOAD_POLICY_BY_TYPE[spec.type], fileRecord?.metadata?.uploadLimits);
}

/** The image policy for a record, or `null` when it is not an image type. */
export function resolveImagePolicy(
  fileRecord: { type?: string; metadata?: any } | null | undefined
): ImageUploadPolicy | null {
  const policy = resolveUploadPolicy(fileRecord);
  return policy && policy.mediaKind === 'image' ? policy : null;
}

/** The video policy for a record, or `null` when it is not a video type. */
export function resolveVideoPolicy(
  fileRecord: { type?: string; metadata?: any } | null | undefined
): VideoUploadPolicy | null {
  const policy = resolveUploadPolicy(fileRecord);
  return policy && policy.mediaKind === 'video' ? policy : null;
}

/**
 * The rejection used when nothing in the registry claims an upload's type.
 *
 * Given its own code rather than being reported as a format problem: the file
 * may be a perfectly good picture, and the thing that is wrong is the upload
 * type on the record — a bug on our side, not something the uploader chose. It
 * still refuses, because the alternative is enforcing no policy at all.
 */
export const UNSUPPORTED_UPLOAD_TYPE_CODE = UNSUPPORTED_UPLOAD_TYPE;
export const UNSUPPORTED_UPLOAD_TYPE_STATUS = UPLOAD_ERROR_STATUS[UNSUPPORTED_UPLOAD_TYPE];
export const UNSUPPORTED_UPLOAD_TYPE_MESSAGE = UPLOAD_ERROR_MESSAGES[UNSUPPORTED_UPLOAD_TYPE];

/** Every code any policy can raise — for callers that have to list them all. */
export const ALL_UPLOAD_REJECTION_CODES: string[] = Array.from(
  new Set([
    ...Object.values(UPLOAD_POLICY_BY_TYPE).flatMap((policy) => Object.values(policy.codes)),
    UNSUPPORTED_UPLOAD_TYPE
  ])
);
