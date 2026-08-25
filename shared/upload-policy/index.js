/**
 * The public upload policy for a comment image.
 *
 * ## Why this is a package and not three copies
 *
 * The file server enforces these limits, the API refuses an upload URL that
 * already violates them, and the composer says no before it starts a transfer
 * nobody wants. Three enforcement points is right; three sets of numbers is not.
 * When the client's copy drifts low it refuses files the server would happily
 * take; when it drifts high it uploads files that were always going to come
 * back rejected, having already opened a "replace the current image?" dialog
 * about them.
 *
 * So the numbers live here once, and all three import them.
 *
 * ## What may go in here
 *
 * Constants and plain data. Nothing else. This module is loaded into a browser
 * bundle, into a NestJS process, and into Jest under jsdom, so it must not
 * reach for `window`, `process`, Nest, Mongoose or Sharp — a single such import
 * would make it unloadable in two of the three places.
 *
 * It is deliberately CommonJS with a hand-written `.d.ts` rather than TypeScript
 * source: the two Nest apps compile with `tsc` and cannot build a `.ts` file
 * that lives under `node_modules`, so shipping source would work in the web app
 * and fail in both services.
 *
 * ## The client is a hint, the server is the authority
 *
 * Sharing the numbers does not make the client an enforcer. Everything the
 * composer decides is early feedback for whoever picked the file: it saves a
 * pointless upload and keeps a valid attachment from being replaced by an
 * invalid one. The file server measures the bytes that actually arrive and is
 * the only side whose answer counts — it is never permitted to skip a check
 * because the client claims to have run it.
 */

/**
 * Largest a comment image may be, in bytes.
 *
 * The composer refuses anything bigger before it starts uploading, and the API
 * refuses to issue an upload URL for a larger declared size. Both are
 * courtesies: a declared length is a claim like any other, and only the bytes
 * that actually arrive settle it.
 */
const MAX_COMMENT_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * ## Why a byte limit is not enough
 *
 * Compressed size says almost nothing about what a decoder has to hold. A PNG of
 * 6000x6000 flat pixels is 120KB on disk and 36 million pixels in memory; the
 * same trick at 30000x30000 is still comfortably under 10MB and asks for nine
 * hundred million. The bytes arrive quickly; the decode is what falls over.
 *
 * So a comment image is bounded on five axes at once, and has to satisfy all of
 * them:
 *
 *  - each side, so a pathological aspect ratio cannot slip through on area;
 *  - total decoded pixels, which is what memory actually tracks;
 *  - frame count, because per-frame work is CPU the pixel budget does not see;
 *  - playing time, because a comment image is a picture, not a clip;
 *  - bytes, which is still the cheapest thing to check first.
 */
const MAX_COMMENT_IMAGE_WIDTH = 12000;
const MAX_COMMENT_IMAGE_HEIGHT = 12000;

/**
 * Total decoded pixels across every frame.
 *
 * 40 million is roughly a 6300x6300 still — far past anything a comment needs,
 * and about 160MB of RGBA, which the pipeline handles without strain. The
 * per-side limits allow a shape up to 12000x3333 within the same budget.
 */
const MAX_COMMENT_IMAGE_PIXELS = 40000000;

/**
 * Frames (GIF/WebP) or pages (AVIF/HEIC) a comment image may carry.
 *
 * ## Why the pixel budget does not cover this
 *
 * The budget is a memory guard, and memory is not the only cost. Per-frame work
 * — parsing each frame's metadata, allocating its state, re-encoding it, writing
 * its delay — is roughly linear in frame count and almost independent of frame
 * size. A 16x16 GIF with 3000 frames spends 768k pixels, under 2% of the pixel
 * budget, while asking the encoder to do three thousand frames of work. Nothing
 * else here would stop it, which is what makes a very long animation of very
 * small frames the cheapest denial-of-service the format allows.
 *
 * 300 frames is about ten seconds of ordinary 30fps animation and comfortably
 * more than any reaction GIF a comment carries, while capping the per-frame work
 * at something a single request can absorb.
 */
const MAX_COMMENT_IMAGE_FRAMES = 300;

/**
 * How long a comment animation may play, in milliseconds.
 *
 * Frame count alone does not bound playing time: 300 frames at a one-second
 * delay each is five minutes of animation inside every other limit. Duration is
 * the axis a reader actually experiences, and a comment image that runs longer
 * than half a minute is a video wearing a picture's container.
 *
 * Enforced only when the decoder reports per-frame delays it can stand behind.
 * When it does not, the frame limit still applies — that is why both exist, and
 * why neither may be dropped in favour of the other.
 */
const MAX_COMMENT_IMAGE_DURATION_MS = 30000;

/**
 * The raster formats a comment image may be.
 *
 * Every one is verified decodable by the installed Sharp/libvips and re-encoded
 * to WebP by the processing pipeline, so what a reader eventually downloads is
 * WebP regardless of what was uploaded.
 *
 * Deliberately absent:
 *
 *  - **SVG.** Not a raster image at all — it is a document that may carry
 *    script, external references and entity expansions. Sharp *can* rasterise
 *    it, which is precisely the trap: accepting it because the decoder managed
 *    would mean accepting markup as a picture.
 *  - **TIFF.** Decodable, but it is not a web delivery format and nothing in the
 *    product asks for it. A narrower list is a smaller thing to defend.
 */
const SUPPORTED_COMMENT_IMAGE_FORMATS = Object.freeze([
  'jpeg',
  'png',
  'webp',
  'gif',
  'avif'
]);

/**
 * The MIME types that go with the whitelist.
 *
 * Used for the picker's `accept` attribute and for reporting a stored file's
 * type. Never used to decide what a file *is* — that comes from its bytes.
 */
const SUPPORTED_COMMENT_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif'
]);

/**
 * The file is not a supported image at all.
 *
 * Covers everything where the answer is "pick a different file": a video, a PDF
 * or an SVG; a header that matches nothing in the whitelist; a header and a
 * decoder that disagree; and a picture that is truncated, corrupt or otherwise
 * undecodable. All of those are the same instruction to whoever chose it.
 */
const INVALID_COMMENT_IMAGE_FORMAT = 'INVALID_COMMENT_IMAGE_FORMAT';

/**
 * The file is too many bytes.
 *
 * Kept apart from every other rejection because it is the one a person can act
 * on without understanding anything about the picture: the same image, saved
 * smaller or at a lower quality, goes through. Folding it into the resolution
 * code would tell someone to shrink a 200x200 photograph because the file
 * happened to be 11MB.
 */
const COMMENT_IMAGE_FILE_TOO_LARGE = 'COMMENT_IMAGE_FILE_TOO_LARGE';

/**
 * The file is a supported image whose resolution or animation is too large.
 *
 * Width, height, total decoded pixels, frame count and playing time all land
 * here: every one of them means the picture is fine and there is simply too much
 * of it, so a smaller or shorter copy of the very same file would be accepted.
 */
const COMMENT_IMAGE_DIMENSIONS_EXCEEDED = 'COMMENT_IMAGE_DIMENSIONS_EXCEEDED';

/** Every code in the contract, for callers that want to switch over them. */
const COMMENT_IMAGE_ERROR_CODES = Object.freeze({
  INVALID_COMMENT_IMAGE_FORMAT,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED
});

/**
 * The HTTP status each rejection is answered with.
 *
 * 413 for the byte limit is what that status is for, and it is the one case
 * where the transport itself has an opinion worth stating. The other two are
 * ordinary validation failures and stay 400, matching every other refused
 * payload in the API rather than inventing a second convention for images.
 */
const COMMENT_IMAGE_ERROR_STATUS = Object.freeze({
  INVALID_COMMENT_IMAGE_FORMAT: 400,
  COMMENT_IMAGE_FILE_TOO_LARGE: 413,
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED: 400
});

/**
 * What the reader is shown, one message per code.
 *
 * Held here so the composer never has to match on a message string to work out
 * which rejection it received — it matches the code and looks the wording up.
 * The three read as three different instructions on purpose: choose another
 * file, save it smaller, use a smaller picture.
 */
const COMMENT_IMAGE_ERROR_MESSAGES = Object.freeze({
  INVALID_COMMENT_IMAGE_FORMAT: 'Invalid image format',
  COMMENT_IMAGE_FILE_TOO_LARGE: 'Image must be 10MB or smaller',
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED: 'Image resolution is too large'
});

/**
 * ## The generic image codes, for uploads that are not comment images
 *
 * A post photo, a message photo, an avatar and a cover are all checked for being
 * *an image at all* — the header sniff, the whitelist, the decode — and none of
 * them is subject to the comment limits above. Answering one of them with a
 * `COMMENT_*` code would tell a client that a post upload broke a comment rule,
 * which is not true and not something it can act on.
 *
 * So the generic tier has its own codes. They mean the same *kinds* of thing and
 * are deliberately not the same strings: a client that matches `COMMENT_*` is
 * asking about comment images specifically, and must not be fed a post
 * rejection by accident.
 *
 * `IMAGE_FILE_TOO_LARGE` has no enforcer today — the generic policy sets no byte
 * cap, because none existed before the comment feature and inventing one would
 * be the same overreach in the other direction. It is defined so that a future
 * per-type policy has a code to use rather than borrowing the comment one.
 */
const INVALID_IMAGE_FORMAT = 'INVALID_IMAGE_FORMAT';
const IMAGE_FILE_TOO_LARGE = 'IMAGE_FILE_TOO_LARGE';
const IMAGE_DIMENSIONS_EXCEEDED = 'IMAGE_DIMENSIONS_EXCEEDED';

const IMAGE_ERROR_CODES = Object.freeze({
  INVALID_IMAGE_FORMAT,
  IMAGE_FILE_TOO_LARGE,
  IMAGE_DIMENSIONS_EXCEEDED
});

const IMAGE_ERROR_STATUS = Object.freeze({
  INVALID_IMAGE_FORMAT: 400,
  IMAGE_FILE_TOO_LARGE: 413,
  IMAGE_DIMENSIONS_EXCEEDED: 400
});

const IMAGE_ERROR_MESSAGES = Object.freeze({
  INVALID_IMAGE_FORMAT: 'That file is not a supported image',
  IMAGE_FILE_TOO_LARGE: 'That image file is too large',
  IMAGE_DIMENSIONS_EXCEEDED: 'That image resolution is too large'
});

/**
 * The durable upload type that gets the comment-image limits.
 *
 * One value, named here rather than spelled as a string at the point of
 * dispatch, so the set of types under this policy is visible in the policy
 * itself. It is matched against the `type` on the file record — written by the
 * server when the upload URL was issued — never against anything the uploader
 * sends.
 */
const COMMENT_IMAGE_UPLOAD_TYPE = 'comment-photo';

/** Every limit in one object, for logging a rejection's context. */
const COMMENT_IMAGE_LIMITS = Object.freeze({
  maxBytes: MAX_COMMENT_IMAGE_BYTES,
  maxWidth: MAX_COMMENT_IMAGE_WIDTH,
  maxHeight: MAX_COMMENT_IMAGE_HEIGHT,
  maxPixels: MAX_COMMENT_IMAGE_PIXELS,
  maxFrames: MAX_COMMENT_IMAGE_FRAMES,
  maxDurationMs: MAX_COMMENT_IMAGE_DURATION_MS
});


/* ===========================================================================
 * The registry: one policy per durable upload type
 * ===========================================================================
 *
 * ## Why "generic" was the wrong default
 *
 * For a while there were exactly two tiers: the comment-image policy, and a
 * generic one that every other upload fell into. The generic tier answered only
 * "is this an image at all" and set no byte, pixel, frame or duration limit —
 * deliberately, because the alternative at the time was letting the comment
 * limits leak onto post photos and avatars that nobody had chosen them for.
 *
 * That was the right fix for the wrong problem. "No limit" is not a policy; it
 * is the absence of one, and it left an avatar able to be a 300-megapixel
 * animation and a post photo able to be whatever `TUS_MAX_FILE_SIZE` allowed.
 * The real answer is that **every durable type names its own policy**, and the
 * generic shape survives only as the thing those policies have in common.
 *
 * ## Why the registry is keyed by the durable type
 *
 * `type` is written onto the file record by the API when it issues an upload
 * URL — a server-to-server call the uploader never touches — and the TUS
 * transfer is bound to that record by a signed token carrying its id. So the
 * type is the one piece of the upload that its uploader did not choose.
 *
 * Everything else on the wire is a claim: the filename, the `filetype` in TUS
 * metadata, the `Content-Type`, the extension. Selecting a policy from any of
 * them would let an uploader opt out of a limit by relabelling, and equally let
 * them impose a stricter limit on somebody else's upload type. Both directions
 * are tested.
 *
 * ## Failing closed
 *
 * `getUploadPolicy` returns `null` for a type it does not know. Callers turn
 * that into `UNSUPPORTED_UPLOAD_TYPE` rather than into "use the loose one" — a
 * typo like `post-phto` must not land in a wider policy than `post-photo`.
 */

/** The stable code for an upload type nothing in the registry claims. */
const UNSUPPORTED_UPLOAD_TYPE = 'UNSUPPORTED_UPLOAD_TYPE';

/**
 * Video rejections, one code per axis a caller can actually act on.
 *
 * They are separate for the same reason the image ones are: "the clip is too
 * long" and "the clip is 4K" are different instructions, and a client that can
 * only say "video rejected" is a client that cannot help whoever picked it. A
 * ten-second 8K clip and a two-hour 480p clip fail different checks and deserve
 * different advice.
 *
 * `VIDEO_FILE_TOO_LARGE` is answered with 413 and nothing else is — the byte
 * count is the one refusal the transport itself has an opinion about.
 */
const INVALID_VIDEO_FORMAT = 'INVALID_VIDEO_FORMAT';
const VIDEO_FILE_TOO_LARGE = 'VIDEO_FILE_TOO_LARGE';
const VIDEO_DURATION_EXCEEDED = 'VIDEO_DURATION_EXCEEDED';
const VIDEO_RESOLUTION_EXCEEDED = 'VIDEO_RESOLUTION_EXCEEDED';
const VIDEO_FRAME_RATE_EXCEEDED = 'VIDEO_FRAME_RATE_EXCEEDED';
const VIDEO_CODEC_NOT_SUPPORTED = 'VIDEO_CODEC_NOT_SUPPORTED';

const VIDEO_ERROR_CODES = Object.freeze({
  INVALID_VIDEO_FORMAT,
  VIDEO_FILE_TOO_LARGE,
  VIDEO_DURATION_EXCEEDED,
  VIDEO_RESOLUTION_EXCEEDED,
  VIDEO_FRAME_RATE_EXCEEDED,
  VIDEO_CODEC_NOT_SUPPORTED
});

const VIDEO_ERROR_STATUS = Object.freeze({
  INVALID_VIDEO_FORMAT: 400,
  VIDEO_FILE_TOO_LARGE: 413,
  VIDEO_DURATION_EXCEEDED: 400,
  VIDEO_RESOLUTION_EXCEEDED: 400,
  VIDEO_FRAME_RATE_EXCEEDED: 400,
  VIDEO_CODEC_NOT_SUPPORTED: 400
});

const VIDEO_ERROR_MESSAGES = Object.freeze({
  INVALID_VIDEO_FORMAT: 'That file is not a supported video',
  VIDEO_FILE_TOO_LARGE: 'That video file is too large',
  VIDEO_DURATION_EXCEEDED: 'That video is too long',
  VIDEO_RESOLUTION_EXCEEDED: 'That video resolution is too large',
  VIDEO_FRAME_RATE_EXCEEDED: 'That video frame rate is too high',
  VIDEO_CODEC_NOT_SUPPORTED: 'That video uses a format we cannot play'
});

/**
 * Every code the registry can raise, with the status that belongs to it.
 *
 * One table rather than three so a caller that has only a code — an HTTP filter,
 * a toast mapper — can answer without knowing which tier produced it.
 */
const UPLOAD_ERROR_STATUS = Object.freeze({
  ...COMMENT_IMAGE_ERROR_STATUS,
  ...IMAGE_ERROR_STATUS,
  ...VIDEO_ERROR_STATUS,
  UNSUPPORTED_UPLOAD_TYPE: 400
});

const UPLOAD_ERROR_MESSAGES = Object.freeze({
  ...COMMENT_IMAGE_ERROR_MESSAGES,
  ...IMAGE_ERROR_MESSAGES,
  ...VIDEO_ERROR_MESSAGES,
  UNSUPPORTED_UPLOAD_TYPE: 'That kind of upload is not supported'
});

/** Megabytes, spelled out where a limit is written, so the numbers read. */
const MB = 1024 * 1024;

/** Formats the image pipeline decodes and re-encodes, minus the animated one. */
const STILL_IMAGE_FORMATS = Object.freeze(['jpeg', 'png', 'webp', 'avif']);

/** The same list plus GIF, for the types that keep animation. */
const ANIMATED_IMAGE_FORMATS = Object.freeze(['jpeg', 'png', 'webp', 'gif', 'avif']);

const STILL_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/heic',
  'image/heif'
]);

const ANIMATED_IMAGE_MIME_TYPES = Object.freeze([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif'
]);

/**
 * The containers a video upload may arrive in.
 *
 * MP4 and MOV share the ISO-BMFF box structure; WebM is Matroska. All three are
 * what browsers and phones produce and what `FileVideoService` reads. AVI, WMV,
 * FLV, MKV and OGG are deliberately absent: `ffprobe` reads them and the picker
 * used to advertise them, but nothing in the product needs them and every
 * container accepted is another parser to stand behind.
 */
const VIDEO_CONTAINERS = Object.freeze(['mp4', 'mov', 'webm']);

/**
 * Video codecs the pipeline can actually turn into something playable.
 *
 * Not "whatever ffprobe can name". Each has a decoder in a stock FFmpeg build,
 * and the pipeline re-encodes anything not already browser-safe to H.264/AAC in
 * MP4 — `FileVideoService.isSupportHtml5` decides, `convert2Mp4` does the work.
 * So the guarantee is: it decodes here, and what a viewer plays is either H.264
 * or a stream the browser already accepted unchanged.
 *
 * AV1 is included because stock FFmpeg decodes it (libdav1d) and recent phones
 * and screen recorders emit it; it is transcoded rather than passed through.
 */
const VIDEO_CODECS = Object.freeze(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4']);

/**
 * Audio codecs allowed alongside the video stream.
 *
 * Audio is optional — a silent clip is a normal thing to upload — but a track
 * that is present has to be one the transcode can read. PCM and ALAC are here
 * because MOV files straight off a camera routinely carry them.
 */
const VIDEO_AUDIO_CODECS = Object.freeze([
  'aac',
  'mp3',
  'opus',
  'vorbis',
  'ac3',
  'eac3',
  'alac',
  'flac',
  'pcm_s16le',
  'pcm_s16be',
  'pcm_s24le',
  'pcm_u8'
]);

const VIDEO_MIME_TYPES = Object.freeze(['video/mp4', 'video/quicktime', 'video/webm']);

/** Extensions the picker advertises next to the MIME types, for stubborn OSes. */
const VIDEO_EXTENSIONS = Object.freeze(['.mp4', '.m4v', '.mov', '.webm']);

const humanBytes = (bytes) => {
  const mb = bytes / MB;
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
};

const humanDuration = (ms) => {
  const seconds = Math.round(ms / 1000);
  if (seconds >= 60 && seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? '1 minute' : `${minutes} minutes`;
  }
  return seconds === 1 ? '1 second' : `${seconds} seconds`;
};

/**
 * Build one image policy.
 *
 * Every axis is required rather than defaulted. A policy with an accidentally
 * absent limit compares as "greater than nothing" at every call site and
 * silently disables the check it belongs to, so the registry states all of them
 * and the contract test asserts each is finite and positive.
 */
function imagePolicy(spec) {
  const codes = Object.freeze(spec.codes || {
    format: INVALID_IMAGE_FORMAT,
    fileTooLarge: IMAGE_FILE_TOO_LARGE,
    dimensions: IMAGE_DIMENSIONS_EXCEEDED
  });
  const formats = spec.preserveAnimation ? ANIMATED_IMAGE_FORMATS : STILL_IMAGE_FORMATS;
  const mimeTypes = spec.preserveAnimation ? ANIMATED_IMAGE_MIME_TYPES : STILL_IMAGE_MIME_TYPES;

  const messages = spec.messages || {
    [codes.format]: 'That file is not a supported image',
    [codes.fileTooLarge]: `Image must be ${humanBytes(spec.maxBytes)} or smaller`,
    [codes.dimensions]: 'That image resolution is too large'
  };

  return Object.freeze({
    type: spec.type,
    mediaKind: 'image',
    publicUpload: spec.publicUpload !== false,
    allowedFormats: formats,
    allowedMimeTypes: mimeTypes,
    acceptAttribute: mimeTypes.join(','),
    maxBytes: spec.maxBytes,
    maxWidth: spec.maxWidth,
    maxHeight: spec.maxHeight,
    maxPixels: spec.maxPixels,
    maxFrames: spec.maxFrames,
    maxDurationMs: spec.maxDurationMs,
    preserveAnimation: !!spec.preserveAnimation,
    codes,
    statuses: Object.freeze({
      [codes.format]: UPLOAD_ERROR_STATUS[codes.format],
      [codes.fileTooLarge]: UPLOAD_ERROR_STATUS[codes.fileTooLarge],
      [codes.dimensions]: UPLOAD_ERROR_STATUS[codes.dimensions]
    }),
    messages: Object.freeze({ ...messages })
  });
}

/** Build one video policy. Same rule: every axis stated, none defaulted. */
function videoPolicy(spec) {
  const codes = Object.freeze({
    format: INVALID_VIDEO_FORMAT,
    fileTooLarge: VIDEO_FILE_TOO_LARGE,
    duration: VIDEO_DURATION_EXCEEDED,
    resolution: VIDEO_RESOLUTION_EXCEEDED,
    frameRate: VIDEO_FRAME_RATE_EXCEEDED,
    codec: VIDEO_CODEC_NOT_SUPPORTED
  });

  return Object.freeze({
    type: spec.type,
    mediaKind: 'video',
    publicUpload: spec.publicUpload !== false,
    allowedContainers: VIDEO_CONTAINERS,
    allowedVideoCodecs: VIDEO_CODECS,
    allowedAudioCodecs: VIDEO_AUDIO_CODECS,
    allowedMimeTypes: VIDEO_MIME_TYPES,
    acceptAttribute: [...VIDEO_MIME_TYPES, ...VIDEO_EXTENSIONS].join(','),
    maxBytes: spec.maxBytes,
    /**
     * Orientation-aware. The long edge may reach `maxWidth` and the short edge
     * `maxHeight`, whichever way round the clip was shot: a portrait 2160x3840
     * and a landscape 3840x2160 are the same amount of video, and a limit that
     * only understood landscape would refuse every phone recording.
     */
    maxWidth: spec.maxWidth,
    maxHeight: spec.maxHeight,
    maxDurationMs: spec.maxDurationMs,
    maxFrameRate: spec.maxFrameRate,
    maxVideoBitrate: spec.maxVideoBitrate,
    preserveAnimation: true,
    codes,
    statuses: Object.freeze({
      [codes.format]: VIDEO_ERROR_STATUS.INVALID_VIDEO_FORMAT,
      [codes.fileTooLarge]: VIDEO_ERROR_STATUS.VIDEO_FILE_TOO_LARGE,
      [codes.duration]: VIDEO_ERROR_STATUS.VIDEO_DURATION_EXCEEDED,
      [codes.resolution]: VIDEO_ERROR_STATUS.VIDEO_RESOLUTION_EXCEEDED,
      [codes.frameRate]: VIDEO_ERROR_STATUS.VIDEO_FRAME_RATE_EXCEEDED,
      [codes.codec]: VIDEO_ERROR_STATUS.VIDEO_CODEC_NOT_SUPPORTED
    }),
    messages: Object.freeze({
      [codes.format]: 'That file is not a supported video',
      [codes.fileTooLarge]: `Video must be ${humanBytes(spec.maxBytes)} or smaller`,
      [codes.duration]: `Video must be ${humanDuration(spec.maxDurationMs)} or shorter`,
      [codes.resolution]: 'That video resolution is too large',
      [codes.frameRate]: `Video must be ${spec.maxFrameRate}fps or lower`,
      [codes.codec]: 'That video uses a format we cannot play'
    })
  });
}

/**
 * Every durable upload type in the product, and what each one may be.
 *
 * ## How the numbers were chosen
 *
 * Each row is the smallest budget that comfortably covers what the surface is
 * for, and no limit that already existed was relaxed without saying so:
 *
 *  - **comment-photo** — unchanged. 10MB / 12000px / 40MP / 300 frames / 30s,
 *    exactly what shipped with the comment-image feature.
 *  - **message-photo** — the same shape as a comment image, because it is the
 *    same act: a picture dropped into a conversation, animation included. It
 *    had no limit of its own before this.
 *  - **post-photo** — the one published surface where a photographer's original
 *    is the point, so it gets the largest still budget: 20MB and 60MP. Frames
 *    are capped at 1 because nothing in the product renders an animated post
 *    image; the graphic composer publishes stills.
 *  - **post-thumbnail** — a custom post cover the creator picks at 4:3 or 3:4,
 *    displayed a few hundred pixels wide. 5MB / 4096px / 16MP is generous for
 *    that, and 5MB is what the picker already refused above.
 *  - **avatar** — the browser crops it to a square before sending, so what
 *    arrives is small by construction. The limit is for when it is not.
 *  - **cover** — a wide banner rendered at 1600x480. 8192px a side leaves room
 *    for a large original to be downscaled.
 *  - **setting-file** — admin-only branding images. Animation-capable, because
 *    an animated logo is a thing operators do.
 *  - **post-video** — 500MB matches `videoConfig.maxFileSize`, which the file
 *    server already carried. Ten minutes at 4K/60 is what one machine's
 *    transcode can absorb.
 *  - **post-teaser** — deliberately *not* relaxed to match post-video: the
 *    composer already refused above 200MB and 60 seconds, and a teaser longer
 *    than the thing it teases is not a limit worth loosening.
 *  - **message-video** — 200MB and five minutes. A conversation attachment, not
 *    a publication.
 */
const UPLOAD_POLICIES = Object.freeze({
  'comment-photo': imagePolicy({
    type: COMMENT_IMAGE_UPLOAD_TYPE,
    maxBytes: MAX_COMMENT_IMAGE_BYTES,
    maxWidth: MAX_COMMENT_IMAGE_WIDTH,
    maxHeight: MAX_COMMENT_IMAGE_HEIGHT,
    maxPixels: MAX_COMMENT_IMAGE_PIXELS,
    maxFrames: MAX_COMMENT_IMAGE_FRAMES,
    maxDurationMs: MAX_COMMENT_IMAGE_DURATION_MS,
    preserveAnimation: true,
    // The three COMMENT_* codes are kept, and kept only here. The comment
    // composer matches on them; answering a post upload with one would tell it
    // a comment rule was broken, which is neither true nor actionable.
    codes: {
      format: INVALID_COMMENT_IMAGE_FORMAT,
      fileTooLarge: COMMENT_IMAGE_FILE_TOO_LARGE,
      dimensions: COMMENT_IMAGE_DIMENSIONS_EXCEEDED
    },
    messages: COMMENT_IMAGE_ERROR_MESSAGES
  }),

  'message-photo': imagePolicy({
    type: 'message-photo',
    maxBytes: 10 * MB,
    maxWidth: 12000,
    maxHeight: 12000,
    maxPixels: 40000000,
    maxFrames: 300,
    maxDurationMs: 30000,
    preserveAnimation: true
  }),

  'post-photo': imagePolicy({
    type: 'post-photo',
    maxBytes: 20 * MB,
    maxWidth: 12000,
    maxHeight: 12000,
    maxPixels: 60000000,
    maxFrames: 1,
    // No animation to time, but stated rather than omitted so that no axis of
    // any policy is ever absent — an absent limit disables its check.
    maxDurationMs: 30000,
    preserveAnimation: false
  }),

  'post-thumbnail': imagePolicy({
    type: 'post-thumbnail',
    maxBytes: 5 * MB,
    maxWidth: 4096,
    maxHeight: 4096,
    maxPixels: 16000000,
    maxFrames: 1,
    maxDurationMs: 30000,
    preserveAnimation: false
  }),

  avatar: imagePolicy({
    type: 'avatar',
    maxBytes: 5 * MB,
    maxWidth: 4096,
    maxHeight: 4096,
    maxPixels: 16000000,
    maxFrames: 1,
    maxDurationMs: 30000,
    preserveAnimation: false
  }),

  cover: imagePolicy({
    type: 'cover',
    maxBytes: 10 * MB,
    maxWidth: 8192,
    maxHeight: 8192,
    maxPixels: 40000000,
    maxFrames: 1,
    maxDurationMs: 30000,
    preserveAnimation: false
  }),

  'setting-file': imagePolicy({
    type: 'setting-file',
    maxBytes: 10 * MB,
    maxWidth: 8192,
    maxHeight: 8192,
    maxPixels: 40000000,
    maxFrames: 300,
    maxDurationMs: 30000,
    preserveAnimation: true
  }),

  'post-video': videoPolicy({
    type: 'post-video',
    maxBytes: 500 * MB,
    maxWidth: 3840,
    maxHeight: 2160,
    maxDurationMs: 10 * 60 * 1000,
    maxFrameRate: 60,
    maxVideoBitrate: 100000000
  }),

  'post-teaser': videoPolicy({
    type: 'post-teaser',
    maxBytes: 200 * MB,
    maxWidth: 3840,
    maxHeight: 2160,
    maxDurationMs: 60 * 1000,
    maxFrameRate: 60,
    maxVideoBitrate: 100000000
  }),

  'message-video': videoPolicy({
    type: 'message-video',
    maxBytes: 200 * MB,
    maxWidth: 3840,
    maxHeight: 2160,
    maxDurationMs: 5 * 60 * 1000,
    maxFrameRate: 60,
    maxVideoBitrate: 100000000
  })
});

/** Every durable type the registry knows, for callers that enumerate them. */
const UPLOAD_POLICY_TYPES = Object.freeze(Object.keys(UPLOAD_POLICIES));

/**
 * The policy for a durable upload type, or `null` when there is not one.
 *
 * `null` is the fail-closed answer and callers must turn it into a refusal —
 * `UNSUPPORTED_UPLOAD_TYPE` — never into permission to fall back to something
 * looser. A typo (`post-phto`) and a type somebody forgot to register look
 * identical from here, and both are bugs that should surface at once rather
 * than upload quietly under whichever policy happened to be the default.
 *
 * The lookup trims and lowercases because the durable value is written by our
 * own code and a stray space is a deployment mistake rather than an attack. It
 * is deliberately no fuzzier than that.
 */
function getUploadPolicy(fileType) {
  if (typeof fileType !== 'string') return null;
  const key = fileType.trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(UPLOAD_POLICIES, key) ? UPLOAD_POLICIES[key] : null;
}

/**
 * Whether a client may ask for an upload URL for this type.
 *
 * Every registered type is public today, and the flag exists so that a
 * server-generated derivative can be added without anyone having to remember to
 * guard its endpoint: a policy marked `publicUpload: false` is refused by the
 * API before a record exists, while the type stays usable by internal pipelines
 * that write the record themselves.
 */
function isPublicUploadType(fileType) {
  const policy = getUploadPolicy(fileType);
  return !!policy && policy.publicUpload === true;
}

/* ===========================================================================
 * Adjustable limits: what an operator may change, and how far
 * ===========================================================================
 *
 * The registry above is the **default** policy. An operator can move some of
 * those numbers from Admin → Settings → Upload limits without a deploy, and this
 * section is the contract for that: which fields are adjustable, what a stored
 * override means, and the ceiling no override may pass.
 *
 * ## Why only some fields
 *
 * A limit is a number an operator can reasonably have an opinion about — "our
 * creators shoot 8K, raise the resolution cap". A *format list* is not: allowing
 * TIFF because someone typed it into a form would mean accepting a file the
 * pipeline cannot decode, and allowing a codec would mean accepting a video the
 * transcode cannot read. Same for magic-byte checks, cleanup, the durable-type
 * dispatch, concurrency and process timeouts: those are correctness and safety
 * machinery, not policy, and they stay in code.
 *
 * ## Why there is still a ceiling
 *
 * An override is applied by the API and carried to the file server on the
 * durable record, so a mistake in the settings collection — or anything that
 * could write to it — must not be able to ask the file server to decode a
 * 40-gigapixel image. Every override is clamped to {@link UPLOAD_HARD_CEILINGS}
 * on the way in *and* again where it is enforced. Belt and braces on purpose:
 * the two are different processes, and only one of them owns the memory that a
 * bad number would spend.
 *
 * ## Why an invalid override is ignored rather than fatal
 *
 * A setting can be missing (a database that predates this feature), the wrong
 * type (hand-edited), or nonsense (`0`, `-1`, `NaN`). None of those is a reason
 * to refuse every upload of that type — the code default is right there and is
 * known good. So a bad override falls back to the default, field by field, and
 * the admin form is where a bad value is *reported*, at the point somebody can
 * fix it.
 */

/**
 * The absolute ceilings. No override may exceed these, whoever sets them.
 *
 * They are not "the limits" — they are the point past which a number stops
 * being a policy choice and becomes a way to exhaust the machine.
 *
 * `maxPixels` deserves a note: the image validator opens a file for metadata
 * under libvips' own default ceiling of `0x3fff * 0x3fff` (~268MP). A pixel
 * budget above that could never be reached, because the metadata read would
 * throw first and report a resolution problem for a file that was inside the
 * configured budget. 200MP keeps the two consistent.
 */
const UPLOAD_HARD_CEILINGS = Object.freeze({
  image: Object.freeze({
    maxBytes: 100 * 1024 * 1024,
    maxWidth: 30000,
    maxHeight: 30000,
    maxPixels: 200000000,
    maxFrames: 2000,
    maxDurationMs: 120000
  }),
  video: Object.freeze({
    maxBytes: 2048 * 1024 * 1024,
    maxWidth: 7680,
    maxHeight: 4320,
    maxDurationMs: 60 * 60 * 1000,
    maxFrameRate: 240
  })
});

/**
 * The adjustable fields, in the units an operator thinks in.
 *
 * The policy stores bytes, pixels and milliseconds because that is what the
 * validators compare against. A form asking for "10485760" would be a form
 * nobody can fill in correctly, so each field carries the conversion and both
 * sides use it rather than each doing its own arithmetic.
 */
const UPLOAD_LIMIT_FIELDS = Object.freeze({
  image: Object.freeze([
    Object.freeze({
      field: 'maxBytes', settingSuffix: 'maxFileSizeMb', label: 'Max file size (MB)', unit: 'MB', factor: 1024 * 1024, step: 1
    }),
    Object.freeze({
      field: 'maxWidth', settingSuffix: 'maxWidthPx', label: 'Max width (px)', unit: 'px', factor: 1, step: 1
    }),
    Object.freeze({
      field: 'maxHeight', settingSuffix: 'maxHeightPx', label: 'Max height (px)', unit: 'px', factor: 1, step: 1
    }),
    Object.freeze({
      field: 'maxPixels', settingSuffix: 'maxPixelsMp', label: 'Max pixels (MP)', unit: 'MP', factor: 1000000, step: 0.1
    }),
    Object.freeze({
      field: 'maxFrames', settingSuffix: 'maxFrames', label: 'Max frames', unit: 'frames', factor: 1, step: 1
    }),
    Object.freeze({
      field: 'maxDurationMs', settingSuffix: 'maxAnimationSeconds', label: 'Max animation duration (seconds)', unit: 's', factor: 1000, step: 1
    })
  ]),
  video: Object.freeze([
    Object.freeze({
      field: 'maxBytes', settingSuffix: 'maxFileSizeMb', label: 'Max file size (MB)', unit: 'MB', factor: 1024 * 1024, step: 1
    }),
    Object.freeze({
      field: 'maxWidth', settingSuffix: 'maxWidthPx', label: 'Max width (px)', unit: 'px', factor: 1, step: 1
    }),
    Object.freeze({
      field: 'maxHeight', settingSuffix: 'maxHeightPx', label: 'Max height (px)', unit: 'px', factor: 1, step: 1
    }),
    Object.freeze({
      field: 'maxDurationMs', settingSuffix: 'maxDurationSeconds', label: 'Max duration (seconds)', unit: 's', factor: 1000, step: 1
    }),
    Object.freeze({
      field: 'maxFrameRate', settingSuffix: 'maxFrameRate', label: 'Max frame rate', unit: 'fps', factor: 1, step: 1
    })
  ])
});

/** The settings group the admin form renders these under. */
const UPLOAD_LIMIT_SETTING_GROUP = 'upload-limits';

/** The settings key for one adjustable field of one upload type. */
function uploadLimitSettingKey(type, settingSuffix) {
  return `upload.limits.${type}.${settingSuffix}`;
}

/** The adjustable fields for a type, or `[]` if it is not registered. */
function uploadLimitFieldsFor(type) {
  const policy = getUploadPolicy(type);
  if (!policy) return [];
  return UPLOAD_LIMIT_FIELDS[policy.mediaKind] || [];
}

/**
 * A stored setting value as a usable positive number, or `null`.
 *
 * Strings are accepted because a setting round-trips through JSON and a form,
 * and "20" is what an input gives back. Everything else — `null`, `''`, `NaN`,
 * `Infinity`, zero, negatives — is not a smaller limit, it is an absent one, and
 * returning `0` for any of them would silently disable the check it belongs to.
 */
function readPositiveNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * The policy actually in force for a type, given whatever settings are stored.
 *
 * `overrides` is keyed by settings key (`upload.limits.avatar.maxFileSizeMb`),
 * which is exactly the shape the settings cache hands out — so a caller passes
 * what it has rather than reshaping it first.
 *
 * Every field is resolved independently: one nonsensical value costs that one
 * limit its override and nothing else. The result is always a complete policy
 * with every axis a finite positive number, because each axis falls back to a
 * default that is already known good.
 */
function resolveEffectiveUploadPolicy(type, overrides) {
  const base = getUploadPolicy(type);
  if (!base) return null;
  if (!overrides || typeof overrides !== 'object') return base;

  const ceilings = UPLOAD_HARD_CEILINGS[base.mediaKind] || {};
  const fields = UPLOAD_LIMIT_FIELDS[base.mediaKind] || [];
  const applied = {};

  for (const spec of fields) {
    const raw = readPositiveNumber(overrides[uploadLimitSettingKey(base.type, spec.settingSuffix)]);
    if (raw === null) continue;

    const value = Math.round(raw * spec.factor);
    const ceiling = ceilings[spec.field];
    // Clamped rather than refused: this runs on the read path, where the only
    // alternatives are "use a safe number" and "break every upload of this
    // type". The admin form is where an over-ceiling value is reported.
    applied[spec.field] = ceiling ? Math.min(value, ceiling) : value;
  }

  if (Object.keys(applied).length === 0) return base;

  // A frozen policy, same shape as a default one, so nothing downstream has to
  // know whether it was overridden.
  return Object.freeze({ ...base, ...applied });
}

/**
 * What is wrong with a proposed override, in words an operator can act on.
 *
 * Returns `null` when the value is acceptable. Used by the API before it writes
 * a setting, so a rejected value never reaches storage and the previous one
 * stays exactly as it was.
 */
function validateUploadLimitSetting(key, value, siblings) {
  const parsed = /^upload\.limits\.(.+)\.([^.]+)$/.exec(key);
  if (!parsed) return null;

  const [, type, settingSuffix] = parsed;
  const policy = getUploadPolicy(type);
  if (!policy) return `"${type}" is not an upload type this system knows.`;

  const spec = (UPLOAD_LIMIT_FIELDS[policy.mediaKind] || [])
    .find((candidate) => candidate.settingSuffix === settingSuffix);
  if (!spec) return `"${settingSuffix}" is not an adjustable limit for ${type}.`;

  if (value === null || value === undefined || value === '') {
    return `${spec.label} is required. Leave the current value or enter a number.`;
  }

  const raw = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(raw)) return `${spec.label} must be a number.`;
  if (raw <= 0) return `${spec.label} must be greater than zero.`;

  const converted = Math.round(raw * spec.factor);
  const ceiling = (UPLOAD_HARD_CEILINGS[policy.mediaKind] || {})[spec.field];
  if (ceiling && converted > ceiling) {
    const allowed = ceiling / spec.factor;
    return `${spec.label} cannot be above ${allowed}${spec.unit} — that is the system's hard limit.`;
  }

  // Cross-field consistency. A pixel budget below a side limit makes that side
  // limit unreachable: a picture one pixel tall at the maximum width would
  // already be over budget, so the width the form advertises is a fiction.
  if (policy.mediaKind === 'image') {
    const proposed = resolveEffectiveUploadPolicy(type, {
      ...(siblings || {}),
      [key]: raw
    });
    if (proposed && proposed.maxPixels < proposed.maxWidth) {
      return 'Max pixels is too low for the max width: a 1px-tall image at the '
        + `full width would already exceed it. Raise max pixels above ${proposed.maxWidth}, `
        + 'or lower max width.';
    }
    if (proposed && proposed.maxPixels < proposed.maxHeight) {
      return 'Max pixels is too low for the max height: a 1px-wide image at the '
        + `full height would already exceed it. Raise max pixels above ${proposed.maxHeight}, `
        + 'or lower max height.';
    }
  }

  return null;
}

/** Every settings key this feature owns, for seeding and for reading them back. */
function allUploadLimitSettingKeys() {
  const keys = [];
  for (const type of UPLOAD_POLICY_TYPES) {
    for (const spec of uploadLimitFieldsFor(type)) {
      keys.push(uploadLimitSettingKey(type, spec.settingSuffix));
    }
  }
  return keys;
}

module.exports = {
  INVALID_IMAGE_FORMAT,
  IMAGE_FILE_TOO_LARGE,
  IMAGE_DIMENSIONS_EXCEEDED,
  IMAGE_ERROR_CODES,
  IMAGE_ERROR_STATUS,
  IMAGE_ERROR_MESSAGES,
  COMMENT_IMAGE_UPLOAD_TYPE,
  MAX_COMMENT_IMAGE_BYTES,
  MAX_COMMENT_IMAGE_WIDTH,
  MAX_COMMENT_IMAGE_HEIGHT,
  MAX_COMMENT_IMAGE_PIXELS,
  MAX_COMMENT_IMAGE_FRAMES,
  MAX_COMMENT_IMAGE_DURATION_MS,
  SUPPORTED_COMMENT_IMAGE_FORMATS,
  SUPPORTED_COMMENT_IMAGE_MIME_TYPES,
  INVALID_COMMENT_IMAGE_FORMAT,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED,
  COMMENT_IMAGE_ERROR_CODES,
  COMMENT_IMAGE_ERROR_STATUS,
  COMMENT_IMAGE_ERROR_MESSAGES,
  COMMENT_IMAGE_LIMITS,

  INVALID_VIDEO_FORMAT,
  VIDEO_FILE_TOO_LARGE,
  VIDEO_DURATION_EXCEEDED,
  VIDEO_RESOLUTION_EXCEEDED,
  VIDEO_FRAME_RATE_EXCEEDED,
  VIDEO_CODEC_NOT_SUPPORTED,
  VIDEO_ERROR_CODES,
  VIDEO_ERROR_STATUS,
  VIDEO_ERROR_MESSAGES,

  UNSUPPORTED_UPLOAD_TYPE,
  UPLOAD_ERROR_STATUS,
  UPLOAD_ERROR_MESSAGES,

  UPLOAD_POLICIES,
  UPLOAD_POLICY_TYPES,
  getUploadPolicy,
  isPublicUploadType,

  UPLOAD_HARD_CEILINGS,
  UPLOAD_LIMIT_FIELDS,
  UPLOAD_LIMIT_SETTING_GROUP,
  uploadLimitSettingKey,
  uploadLimitFieldsFor,
  allUploadLimitSettingKeys,
  resolveEffectiveUploadPolicy,
  validateUploadLimitSetting
};
