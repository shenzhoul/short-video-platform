/**
 * Types for the shared comment-image upload policy.
 *
 * Hand-written rather than generated: `index.js` is plain CommonJS so that both
 * Nest services and the Next app can load it without a build step, and a
 * declaration file is what gives that JavaScript a typed surface. The two are
 * kept in step by `shared/upload-policy/policy-contract.spec.ts` in each
 * consumer, which compares the installed copy against the source of truth.
 */

/** A format a comment image may be, decided from its bytes. */
export type SupportedCommentImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'avif';

/** The stable codes a rejected comment image is reported with. */
export type CommentImageErrorCode =
  | 'INVALID_COMMENT_IMAGE_FORMAT'
  | 'COMMENT_IMAGE_FILE_TOO_LARGE'
  | 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED';

/** The stable codes an image rejected by the generic tier is reported with. */
export type ImageErrorCode =
  | 'INVALID_IMAGE_FORMAT'
  | 'IMAGE_FILE_TOO_LARGE'
  | 'IMAGE_DIMENSIONS_EXCEEDED';

export interface CommentImageLimits {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxPixels: number;
  maxFrames: number;
  maxDurationMs: number;
}

export declare const MAX_COMMENT_IMAGE_BYTES: number;
export declare const MAX_COMMENT_IMAGE_WIDTH: number;
export declare const MAX_COMMENT_IMAGE_HEIGHT: number;
export declare const MAX_COMMENT_IMAGE_PIXELS: number;
export declare const MAX_COMMENT_IMAGE_FRAMES: number;
export declare const MAX_COMMENT_IMAGE_DURATION_MS: number;

export declare const SUPPORTED_COMMENT_IMAGE_FORMATS: readonly SupportedCommentImageFormat[];
export declare const SUPPORTED_COMMENT_IMAGE_MIME_TYPES: readonly string[];

export declare const INVALID_COMMENT_IMAGE_FORMAT: 'INVALID_COMMENT_IMAGE_FORMAT';
export declare const COMMENT_IMAGE_FILE_TOO_LARGE: 'COMMENT_IMAGE_FILE_TOO_LARGE';
export declare const COMMENT_IMAGE_DIMENSIONS_EXCEEDED: 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED';

export declare const COMMENT_IMAGE_ERROR_CODES: Readonly<Record<CommentImageErrorCode, CommentImageErrorCode>>;
export declare const COMMENT_IMAGE_ERROR_STATUS: Readonly<Record<CommentImageErrorCode, number>>;
export declare const COMMENT_IMAGE_ERROR_MESSAGES: Readonly<Record<CommentImageErrorCode, string>>;
export declare const COMMENT_IMAGE_LIMITS: Readonly<CommentImageLimits>;

export declare const INVALID_IMAGE_FORMAT: 'INVALID_IMAGE_FORMAT';
export declare const IMAGE_FILE_TOO_LARGE: 'IMAGE_FILE_TOO_LARGE';
export declare const IMAGE_DIMENSIONS_EXCEEDED: 'IMAGE_DIMENSIONS_EXCEEDED';

export declare const IMAGE_ERROR_CODES: Readonly<Record<ImageErrorCode, ImageErrorCode>>;
export declare const IMAGE_ERROR_STATUS: Readonly<Record<ImageErrorCode, number>>;
export declare const IMAGE_ERROR_MESSAGES: Readonly<Record<ImageErrorCode, string>>;

/** The durable upload type the comment-image limits apply to. */
export declare const COMMENT_IMAGE_UPLOAD_TYPE: 'comment-photo';

/** The stable code for an upload type nothing in the registry claims. */
export declare const UNSUPPORTED_UPLOAD_TYPE: 'UNSUPPORTED_UPLOAD_TYPE';

/** The stable codes a rejected video is reported with. */
export type VideoErrorCode =
  | 'INVALID_VIDEO_FORMAT'
  | 'VIDEO_FILE_TOO_LARGE'
  | 'VIDEO_DURATION_EXCEEDED'
  | 'VIDEO_RESOLUTION_EXCEEDED'
  | 'VIDEO_FRAME_RATE_EXCEEDED'
  | 'VIDEO_CODEC_NOT_SUPPORTED';

/** Every code any upload policy can raise. */
export type UploadErrorCode =
  | CommentImageErrorCode
  | ImageErrorCode
  | VideoErrorCode
  | 'UNSUPPORTED_UPLOAD_TYPE';

export declare const INVALID_VIDEO_FORMAT: 'INVALID_VIDEO_FORMAT';
export declare const VIDEO_FILE_TOO_LARGE: 'VIDEO_FILE_TOO_LARGE';
export declare const VIDEO_DURATION_EXCEEDED: 'VIDEO_DURATION_EXCEEDED';
export declare const VIDEO_RESOLUTION_EXCEEDED: 'VIDEO_RESOLUTION_EXCEEDED';
export declare const VIDEO_FRAME_RATE_EXCEEDED: 'VIDEO_FRAME_RATE_EXCEEDED';
export declare const VIDEO_CODEC_NOT_SUPPORTED: 'VIDEO_CODEC_NOT_SUPPORTED';

export declare const VIDEO_ERROR_CODES: Readonly<Record<VideoErrorCode, VideoErrorCode>>;
export declare const VIDEO_ERROR_STATUS: Readonly<Record<VideoErrorCode, number>>;
export declare const VIDEO_ERROR_MESSAGES: Readonly<Record<VideoErrorCode, string>>;

/** Status and wording for every code in the registry, in one table. */
export declare const UPLOAD_ERROR_STATUS: Readonly<Record<string, number>>;
export declare const UPLOAD_ERROR_MESSAGES: Readonly<Record<string, string>>;

/** What every policy states, whatever kind of media it governs. */
interface BaseUploadPolicy {
  /** The durable `type` this policy belongs to. */
  type: string;
  mediaKind: 'image' | 'video';
  /** Whether a client may request an upload URL for this type. */
  publicUpload: boolean;
  /** MIME types for the picker's `accept`. Never used to decide what a file is. */
  allowedMimeTypes: readonly string[];
  /** The same list, joined, ready for an `accept` attribute. */
  acceptAttribute: string;
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
  maxDurationMs: number;
  /** Whether multi-frame input is kept as an animation by the pipeline. */
  preserveAnimation: boolean;
  /** The HTTP status that belongs to each of this policy's codes. */
  statuses: Readonly<Record<string, number>>;
  /** What the reader is shown, one message per code. */
  messages: Readonly<Record<string, string>>;
}

export interface ImageUploadPolicySpec extends BaseUploadPolicy {
  mediaKind: 'image';
  /** Formats decided from the bytes, not from the MIME or the extension. */
  allowedFormats: readonly string[];
  /** Total decoded pixels across every frame. */
  maxPixels: number;
  maxFrames: number;
  codes: Readonly<{
    format: string;
    fileTooLarge: string;
    dimensions: string;
  }>;
}

export interface VideoUploadPolicySpec extends BaseUploadPolicy {
  mediaKind: 'video';
  /** Containers decided by probing, not by the extension. */
  allowedContainers: readonly string[];
  allowedVideoCodecs: readonly string[];
  allowedAudioCodecs: readonly string[];
  maxFrameRate: number;
  maxVideoBitrate: number;
  codes: Readonly<{
    format: string;
    fileTooLarge: string;
    duration: string;
    resolution: string;
    frameRate: string;
    codec: string;
  }>;
}

export type UploadPolicy = ImageUploadPolicySpec | VideoUploadPolicySpec;

/** Every durable upload type in the product, keyed by its `type`. */
export declare const UPLOAD_POLICIES: Readonly<Record<string, UploadPolicy>>;

/** The keys of {@link UPLOAD_POLICIES}, for callers that enumerate them. */
export declare const UPLOAD_POLICY_TYPES: readonly string[];

/**
 * The policy for a durable upload type, or `null` when there is not one.
 *
 * `null` means refuse with `UNSUPPORTED_UPLOAD_TYPE`. It never means "use a
 * looser default" — an unregistered type is a bug, not a permission.
 */
export declare function getUploadPolicy(fileType: string | null | undefined): UploadPolicy | null;

/** Whether a client may request an upload URL for this durable type. */
export declare function isPublicUploadType(fileType: string | null | undefined): boolean;

/**
 * One adjustable limit: the policy field it sets, the settings key suffix it is
 * stored under, and how the operator's unit converts to the stored one.
 */
export interface UploadLimitField {
  /** The policy field this writes, e.g. `maxBytes`. */
  field: string;
  /** The settings key suffix, e.g. `maxFileSizeMb`. */
  settingSuffix: string;
  /** What the admin form calls it. */
  label: string;
  unit: string;
  /** Multiply the operator's number by this to get the policy's. */
  factor: number;
  step: number;
}

/** Ceilings no override may pass, whoever sets it. */
export declare const UPLOAD_HARD_CEILINGS: Readonly<{
  image: Readonly<Record<string, number>>;
  video: Readonly<Record<string, number>>;
}>;

/** The adjustable fields, per media kind. */
export declare const UPLOAD_LIMIT_FIELDS: Readonly<{
  image: readonly UploadLimitField[];
  video: readonly UploadLimitField[];
}>;

/** The settings group the admin form renders these under. */
export declare const UPLOAD_LIMIT_SETTING_GROUP: 'upload-limits';

/** The settings key for one adjustable field of one upload type. */
export declare function uploadLimitSettingKey(type: string, settingSuffix: string): string;

/** The adjustable fields for a type, or `[]` if it is not registered. */
export declare function uploadLimitFieldsFor(type: string): readonly UploadLimitField[];

/** Every settings key this feature owns, for seeding and for reading back. */
export declare function allUploadLimitSettingKeys(): string[];

/**
 * The policy actually in force for a type, given whatever settings are stored.
 *
 * `overrides` is keyed by settings key. Each field is resolved independently and
 * falls back to the registry default when its override is missing, unparseable
 * or not a positive number; every applied value is clamped to the hard ceiling.
 * Returns `null` only for an upload type the registry does not know.
 */
export declare function resolveEffectiveUploadPolicy(
  type: string,
  overrides?: Record<string, any> | null
): UploadPolicy | null;

/**
 * What is wrong with a proposed override, or `null` if it is acceptable.
 *
 * Returns `null` for any key this feature does not own, so a caller can run it
 * over every setting write without knowing which are upload limits.
 */
export declare function validateUploadLimitSetting(
  key: string,
  value: any,
  siblings?: Record<string, any> | null
): string | null;
