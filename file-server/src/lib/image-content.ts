/**
 * What a file *is*, decided from its bytes.
 *
 * ## Why this exists next to `file-type.ts`
 *
 * Everything in `file-type.ts` reads a claim: the MIME the browser attached, or
 * the extension somebody typed. Both are chosen by whoever uploads, so neither
 * can decide whether a file is safe to treat as an image. Renaming `clip.mp4` to
 * `clip.png` changes both of them at once.
 *
 * This module reads the leading bytes instead. Those are written by the encoder
 * that produced the file and cannot be edited without producing a different
 * file, which is what makes them worth trusting.
 *
 * The sniff is a whitelist, not a blacklist: an unrecognised header is rejected.
 * Listing what is allowed fails closed when a new container appears; listing
 * what is forbidden fails open, and the thing it lets through is exactly the
 * format nobody thought about.
 */

import {
  MAX_COMMENT_IMAGE_BYTES,
  MAX_COMMENT_IMAGE_DURATION_MS,
  MAX_COMMENT_IMAGE_FRAMES,
  MAX_COMMENT_IMAGE_HEIGHT,
  MAX_COMMENT_IMAGE_PIXELS,
  MAX_COMMENT_IMAGE_WIDTH,
  SUPPORTED_COMMENT_IMAGE_FORMATS,
  SUPPORTED_COMMENT_IMAGE_MIME_TYPES,
  SupportedCommentImageFormat
} from '@douyin-clone/upload-policy';

/**
 * ## Where the numbers come from
 *
 * Every limit and every format below is re-exported from
 * `@douyin-clone/upload-policy`, which the API and the web composer import from
 * as well. That package is the single definition; this module holds the part
 * that can only exist on a server — reading bytes and asking a decoder — and
 * passes the policy through unchanged so nothing here can quietly disagree with
 * what the client was told.
 *
 * The re-export is deliberate rather than an alias-only import: the file server
 * has its own vocabulary for these (`ALLOWED_IMAGE_FORMATS`), and callers
 * already use it. Renaming every call site to the package's name would be churn
 * without a reader.
 */
export {
  MAX_COMMENT_IMAGE_BYTES,
  MAX_COMMENT_IMAGE_WIDTH,
  MAX_COMMENT_IMAGE_HEIGHT,
  MAX_COMMENT_IMAGE_PIXELS,
  MAX_COMMENT_IMAGE_FRAMES,
  MAX_COMMENT_IMAGE_DURATION_MS
};

/**
 * The raster formats a comment image may be.
 *
 * Every one of these is verified decodable by the installed Sharp/libvips and
 * re-encoded to WebP by the processing pipeline, so what a reader eventually
 * downloads is WebP regardless of what was uploaded.
 *
 * The list itself lives in the shared policy package, because the composer's
 * `accept` attribute and the API's error text have to name exactly the same
 * formats this decoder will take.
 */
export const ALLOWED_IMAGE_FORMATS = SUPPORTED_COMMENT_IMAGE_FORMATS;

export type AllowedImageFormat = SupportedCommentImageFormat;

/**
 * Sharp reports the whole HEIF family — AVIF included — as `heif`.
 *
 * Mapped rather than added to the whitelist so the list stays a list of formats
 * a caller would recognise, and so a plain HEIC lands under the same name.
 */
const SHARP_FORMAT_ALIASES: Record<string, AllowedImageFormat> = {
  heif: 'avif',
  heic: 'avif',
  jpg: 'jpeg'
};

/** The MIME types that go with the whitelist, for callers that report one. */
export const ALLOWED_IMAGE_MIME_TYPES = SUPPORTED_COMMENT_IMAGE_MIME_TYPES;

/** Longest header this needs to see. AVIF's brand sits at offset 8..16. */
export const IMAGE_SNIFF_BYTES = 32;

/**
 * The ceiling used purely to read a header.
 *
 * Sharp's own default. Reading metadata does not decode pixels, so opening a
 * file under this ceiling is cheap and bounded — and it is what lets a rejection
 * report the real dimensions instead of "too big, cannot say how".
 *
 * Every path that actually decodes uses {@link MAX_COMMENT_IMAGE_PIXELS}
 * instead. This is not a way around the budget; it is how the budget gets an
 * accurate number to refuse.
 */
export const IMAGE_METADATA_INSPECTION_CEILING = 0x3fff * 0x3fff;

const startsWith = (buffer: Buffer, bytes: number[], offset = 0): boolean => {
  if (buffer.length < offset + bytes.length) return false;
  return bytes.every((byte, index) => buffer[offset + index] === byte);
};

/**
 * The format these bytes actually are, or `null` for anything else.
 *
 * Only the header is examined, which is enough to identify a container and is
 * all that can be done cheaply. Whether the rest of the file is intact is a
 * question for the decoder — see `assertDecodableImage`, which runs both.
 */
export function detectImageFormat(buffer: Buffer): AllowedImageFormat | null {
  if (!buffer || buffer.length < 12) return null;

  // JPEG: SOI marker.
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';

  // PNG: signature chosen by the format to survive text-mode transfers.
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';

  // GIF: "GIF87a" or "GIF89a".
  if (startsWith(buffer, [0x47, 0x49, 0x46, 0x38])) return 'gif';

  // WebP: a RIFF container whose form type is "WEBP".
  if (startsWith(buffer, [0x52, 0x49, 0x46, 0x46]) && startsWith(buffer, [0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp';
  }

  // AVIF/HEIC: an ISO-BMFF box whose brand says which. The same box shape
  // carries MP4, so the brand is what separates a picture from a video and it
  // is checked rather than assumed.
  if (startsWith(buffer, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buffer.subarray(8, 12).toString('latin1').toLowerCase();
    if (['avif', 'avis', 'heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) {
      return 'avif';
    }
    return null;
  }

  return null;
}

/**
 * Normalise what Sharp reports into the whitelist's vocabulary.
 *
 * Returns `null` for a format that decodes but is not allowed — SVG being the
 * one that matters, since it decodes perfectly well.
 */
export function normaliseDecodedFormat(format?: string | null): AllowedImageFormat | null {
  if (!format) return null;
  const lower = format.toLowerCase();
  const mapped = SHARP_FORMAT_ALIASES[lower] || lower;
  return (ALLOWED_IMAGE_FORMATS as readonly string[]).includes(mapped)
    ? mapped as AllowedImageFormat
    : null;
}

/** The MIME type that belongs to a detected format, for storing on the record. */
export function mimeTypeForFormat(format: AllowedImageFormat): string {
  return format === 'jpeg' ? 'image/jpeg' : `image/${format}`;
}
