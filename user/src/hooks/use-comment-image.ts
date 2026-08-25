'use client';

import type { CommentImageErrorCode } from '@douyin-clone/upload-policy';
import {
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED,
  COMMENT_IMAGE_ERROR_MESSAGES,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  INVALID_COMMENT_IMAGE_FORMAT,
  MAX_COMMENT_IMAGE_BYTES,
  MAX_COMMENT_IMAGE_DURATION_MS,
  MAX_COMMENT_IMAGE_FRAMES,
  MAX_COMMENT_IMAGE_HEIGHT,
  MAX_COMMENT_IMAGE_PIXELS,
  MAX_COMMENT_IMAGE_WIDTH,
  SUPPORTED_COMMENT_IMAGE_MIME_TYPES
} from '@douyin-clone/upload-policy';
import type { ImageMeasurement } from '@lib/image-probe';
import {
  detectImageFormat as probeImageFormat,
  DIMENSION_SCAN_BYTES,
  readGifAnimation as probeGifAnimation,
  readImageDimensions as probeImageDimensions
} from '@lib/image-probe';
import { discardCommentImage, uploadCommentImage } from '@services/comment.service';
import {
  useCallback, useEffect, useRef, useState
} from 'react';

/** What the composer is holding, and how far along it is. */
export interface PendingCommentImage {
  /** Local preview, revoked when the image is let go. */
  previewUrl: string;
  /** Present once the upload has produced a file record. */
  fileId: string | null;
  uploading: boolean;
  error: string | null;
  name: string;
}

/**
 * ## Where these numbers come from
 *
 * Every limit, format and error code below is imported from
 * `@douyin-clone/upload-policy` — the same module the file server and the API
 * import. There is no client copy to drift: a number changed in that package
 * changes all three at once.
 *
 * What the client does with them is still only a hint. The file server weighs
 * the bytes that actually arrive and is the only side whose answer counts. What
 * checking here buys is that an obviously wrong file never costs an upload,
 * never creates a record to clean up, and never raises a "replace the current
 * image?" dialog about a file that was always going to be refused.
 */
export const COMMENT_IMAGE_MAX_BYTES = MAX_COMMENT_IMAGE_BYTES;

export {
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  INVALID_COMMENT_IMAGE_FORMAT,
  MAX_COMMENT_IMAGE_BYTES,
  MAX_COMMENT_IMAGE_DURATION_MS,
  MAX_COMMENT_IMAGE_FRAMES,
  MAX_COMMENT_IMAGE_HEIGHT,
  MAX_COMMENT_IMAGE_PIXELS,
  MAX_COMMENT_IMAGE_WIDTH };

export type { CommentImageErrorCode };

/**
 * The raster formats the pipeline can actually decode and re-encode.
 *
 * SVG is absent: it is a scriptable document, not a picture, and the fact that a
 * rasteriser can draw it is not a reason to accept it.
 */
export const ACCEPTED_COMMENT_IMAGE_TYPES = [...SUPPORTED_COMMENT_IMAGE_MIME_TYPES];

/** What the file input advertises. A hint to the picker, never a check. */
export const COMMENT_IMAGE_ACCEPT_ATTRIBUTE = ACCEPTED_COMMENT_IMAGE_TYPES.join(',');

/**
 * One message per rejection code, never per rejection *reason*.
 *
 * Three codes, three messages, and each says something different to do: choose
 * another file, save it smaller, use a smaller picture. Nothing in the composer
 * inspects an error's text to work out what happened — the code decides, and the
 * text is looked up from it, so the wording can be reworded or translated on
 * either side of the wire without breaking the mapping.
 */
export const INVALID_IMAGE_MESSAGE = COMMENT_IMAGE_ERROR_MESSAGES.INVALID_COMMENT_IMAGE_FORMAT;
export const FILE_TOO_LARGE_MESSAGE = COMMENT_IMAGE_ERROR_MESSAGES.COMMENT_IMAGE_FILE_TOO_LARGE;
export const IMAGE_TOO_LARGE_MESSAGE = COMMENT_IMAGE_ERROR_MESSAGES.COMMENT_IMAGE_DIMENSIONS_EXCEEDED;

/** The message that belongs to a code, or `null` if it is not one of ours. */
export function messageForCommentImageError(code: string | null | undefined): string | null {
  if (!code) return null;
  return COMMENT_IMAGE_ERROR_MESSAGES[code as CommentImageErrorCode] || null;
}

/**
 * ## The byte parsers moved, the composer's contract did not
 *
 * `detectImageFormat`, `readImageDimensions`, `readIsoBmffDimensions` and
 * `readGifAnimation` were written here and are not comment-specific: a post
 * photo, an avatar and a message picture are measured exactly the same way. They
 * now live in `@lib/image-probe` so every upload type's policy can use them, and
 * are re-exported unchanged so nothing that imported them from this hook has to
 * move.
 *
 * The one comment-specific thing about them was the frame cap `readGifAnimation`
 * stops counting at. That is a policy's number, not a parser's, so it is now an
 * argument — and this file passes the comment policy's.
 */
export type { ImageMeasurement } from '@lib/image-probe';
export {
  detectImageFormat,
  readImageDimensions,
  readIsoBmffDimensions
} from '@lib/image-probe';

/**
 * Whole-file walk budget for counting GIF frames.
 *
 * A GIF has to be walked to its end to know how many frames it holds, and the
 * walk is byte bookkeeping rather than decoding, so it is cheap. This is the
 * belt-and-braces cap: the file has already been refused above 10MB, and the
 * walk stops early the moment the frame count passes the limit, so neither the
 * file size nor the frame count can make it run long.
 */
const GIF_WALK_LIMIT_BYTES = MAX_COMMENT_IMAGE_BYTES;

/**
 * How many frames a GIF holds, and how long it plays, under the comment limits.
 *
 * The walk itself is in `@lib/image-probe`; this binds it to the comment
 * policy's frame cap so the existing single-argument signature keeps working.
 */
export function readGifAnimation(bytes: Uint8Array): { frames: number; durationMs: number } | null {
  return probeGifAnimation(bytes, MAX_COMMENT_IMAGE_FRAMES, GIF_WALK_LIMIT_BYTES);
}

/**
 * Which limit these measurements break, or `null` if they break none.
 *
 * Returns a code rather than a message so that the caller — and the test — is
 * checking the contract rather than a sentence. Width, height, pixels, frames
 * and duration all report the same code because they are all the same answer to
 * the person who picked the file: the picture is fine, there is too much of it.
 */
export function classifyOversizeImage(
  measurement: ImageMeasurement | null
): CommentImageErrorCode | null {
  if (!measurement) return null;
  const {
    width, height, frames, durationMs
  } = measurement;

  if (!width || !height || width < 0 || height < 0) return INVALID_COMMENT_IMAGE_FORMAT;
  if (width > MAX_COMMENT_IMAGE_WIDTH || height > MAX_COMMENT_IMAGE_HEIGHT) {
    return COMMENT_IMAGE_DIMENSIONS_EXCEEDED;
  }

  const countedFrames = frames && frames > 0 ? frames : 1;
  if (countedFrames > MAX_COMMENT_IMAGE_FRAMES) return COMMENT_IMAGE_DIMENSIONS_EXCEEDED;
  if (width * height * countedFrames > MAX_COMMENT_IMAGE_PIXELS) {
    return COMMENT_IMAGE_DIMENSIONS_EXCEEDED;
  }
  if (typeof durationMs === 'number' && durationMs > MAX_COMMENT_IMAGE_DURATION_MS) {
    return COMMENT_IMAGE_DIMENSIONS_EXCEEDED;
  }

  return null;
}

/** The same judgement, as the message a toast would show. */
export function describeOversizeImage(measurement: ImageMeasurement | null): string | null {
  return messageForCommentImageError(classifyOversizeImage(measurement));
}

/**
 * Everything that can be judged without reading the file.
 *
 * Split out from the byte check so the size and MIME rules stay synchronous and
 * cheap — a 40MB video is refused on its size alone, without a read.
 */
export function classifyPickedFile(file: File): CommentImageErrorCode | null {
  if (!file || !file.size) return INVALID_COMMENT_IMAGE_FORMAT;
  if (file.size > MAX_COMMENT_IMAGE_BYTES) return COMMENT_IMAGE_FILE_TOO_LARGE;
  // A whitelist, not `startsWith('image/')`: that would admit SVG, and SVG is
  // the one "image" type that is really a document.
  if (file.type && !ACCEPTED_COMMENT_IMAGE_TYPES.includes(file.type.toLowerCase())) {
    return INVALID_COMMENT_IMAGE_FORMAT;
  }
  return null;
}

/** The same judgement, as the message a toast would show. */
export function describeInvalidImage(file: File): string | null {
  if (!file) return 'No file selected.';
  return messageForCommentImageError(classifyPickedFile(file));
}

/**
 * The full check, including the file's actual first bytes.
 *
 * Fast feedback, still not the authority — the file server decodes the whole
 * picture and has the final say. What this buys is that an obviously wrong file
 * never costs an upload, never creates a record to clean up, and never raises a
 * "replace the current image?" dialog about a file that was never going to be
 * accepted.
 *
 * A read that fails resolves to `null` rather than an error. The browser could
 * not answer, so the question goes to the server instead of blocking a file
 * that may well be fine.
 */
export async function classifyPickedImageContent(file: File): Promise<CommentImageErrorCode | null> {
  const cheap = classifyPickedFile(file);
  if (cheap) return cheap;

  try {
    // One read covers both questions: the first bytes say what the file is, and
    // the same bytes say how big the picture is.
    const header = new Uint8Array(await file.slice(0, DIMENSION_SCAN_BYTES).arrayBuffer());
    const format = probeImageFormat(header);
    if (!format) return INVALID_COMMENT_IMAGE_FORMAT;

    const size = probeImageDimensions(header);
    if (!size) return null;

    // Only a GIF needs the rest of its bytes, and only to count frames — the
    // one thing its header does not state. Every other format has already
    // answered from the 64KB above.
    let animation: { frames: number; durationMs: number } | null = null;
    if (format === 'gif') {
      try {
        animation = readGifAnimation(new Uint8Array(await file.arrayBuffer()));
      } catch {
        animation = null;
      }
    }

    return classifyOversizeImage({
      width: size.width,
      height: size.height,
      frames: animation?.frames ?? null,
      durationMs: animation?.durationMs ?? null
    });
  } catch {
    return null;
  }
}

/** The same judgement, as the message a toast would show. */
export async function describeInvalidImageContent(file: File): Promise<string | null> {
  if (!file) return 'No file selected.';
  return messageForCommentImageError(await classifyPickedImageContent(file));
}

/** The stable code a failed upload carried, wherever the transport put it. */
export function readImageErrorCode(error: any): string | null {
  if (!error) return null;
  if (typeof error.code === 'string') return error.code;
  const body = error?.response?.data || error?.data || error;
  return body?.error || body?.message?.error || null;
}

/** Whether a failed request was the server refusing the file's format. */
export function isInvalidImageFormatError(error: any): boolean {
  return readImageErrorCode(error) === INVALID_COMMENT_IMAGE_FORMAT;
}

/** Whether it was the server refusing the file for its byte count. */
export function isFileTooLargeError(error: any): boolean {
  return readImageErrorCode(error) === COMMENT_IMAGE_FILE_TOO_LARGE;
}

/** Whether it was the server refusing the file's resolution or animation. */
export function isImageTooLargeError(error: any): boolean {
  return readImageErrorCode(error) === COMMENT_IMAGE_DIMENSIONS_EXCEEDED;
}

/**
 * The message to show for a failed upload.
 *
 * Four outcomes, four messages. Three of them are things the author can act on
 * and each says something different to do; anything else is infrastructure,
 * whose text is written for a developer rather than for them.
 *
 * Matched on the code alone. Never on the message — the server's wording is
 * free to change or be translated, and a client that reads sentences would
 * silently start showing the fallback the day it did.
 */
export function describeUploadFailure(error: any): string {
  return messageForCommentImageError(readImageErrorCode(error))
    || 'That image could not be uploaded. Please try again.';
}

/**
 * The one image a comment composer may be holding.
 *
 * ## Why the file is uploaded before the comment is sent
 *
 * The picture has to be processed — resized, converted, thumbnailed — before it
 * can be rendered, and doing that while the author waits on Send would make
 * posting a comment feel as slow as the upload. So the upload starts when the
 * image is chosen, and the comment carries only the resulting id.
 *
 * That trades one problem for another: a file can now exist that no comment ever
 * references. Three things cover it, in order of preference:
 *
 *  1. every path that lets an image go — delete, replace, cancel, reset —
 *     asks the server to discard it;
 *  2. the server refuses to discard a file that has since become part of a
 *     comment, so a late request cannot strip a posted picture;
 *  3. the unused-file sweeper collects anything unreferenced regardless, which
 *     is what makes a crashed browser, a closed tab or a dropped connection
 *     survivable rather than permanent litter.
 *
 * Point 3 is why none of the cleanup here is load-bearing, and why none of it is
 * allowed to block the user.
 */
export function useCommentImage() {
  const [image, setImage] = useState<PendingCommentImage | null>(null);
  /** The upload in flight, so a replacement can ignore a stale result. */
  const uploadRef = useRef(0);

  /** Let go of a preview without touching the server. */
  const revoke = useCallback((url?: string | null) => {
    if (url && url.startsWith('blob:') && typeof URL !== 'undefined') {
      URL.revokeObjectURL(url);
    }
  }, []);

  /**
   * Ask the server to discard an uploaded file.
   *
   * Failures are swallowed on purpose. The user has already moved on, the
   * sweeper will collect it, and an error toast about a file they never knew
   * existed would be noise.
   */
  const discard = useCallback(async (fileId?: string | null) => {
    if (!fileId) return;
    await discardCommentImage(fileId).catch(() => null);
  }, []);

  /**
   * Take a file, upload it, and hold it as the pending image.
   *
   * Returns the resulting state so a caller mid-replacement can decide what to
   * do with it without racing this hook's own state.
   */
  const attach = useCallback(async (file: File): Promise<PendingCommentImage> => {
    const invalid = await describeInvalidImageContent(file);

    // Rejected outright rather than held as a broken attachment. Keeping it
    // would leave the composer showing something that can never be sent, and
    // would make the *next* pick look like a replacement of it.
    if (invalid) {
      return {
        previewUrl: '', fileId: null, uploading: false, error: invalid, name: file.name
      };
    }

    const previewUrl = URL.createObjectURL(file);
    const attempt = uploadRef.current + 1;
    uploadRef.current = attempt;

    setImage({
      previewUrl, fileId: null, uploading: true, error: null, name: file.name
    });

    try {
      const result: any = await uploadCommentImage(file);
      const fileId = result?.data?._id || result?.data?.id || result?._id;
      // A newer selection started while this was in flight; its result owns the
      // composer now, so this one is discarded rather than shown.
      if (uploadRef.current !== attempt) {
        revoke(previewUrl);
        await discard(fileId);
        return {
          previewUrl, fileId, uploading: false, error: null, name: file.name
        };
      }
      if (!fileId) throw new Error('Upload did not return a file.');

      const ready = {
        previewUrl, fileId, uploading: false, error: null, name: file.name
      };
      setImage(ready);
      return ready;
    } catch (error: any) {
      const failed = {
        previewUrl,
        fileId: null,
        uploading: false,
        error: describeUploadFailure(error),
        name: file.name
      };
      if (uploadRef.current === attempt) setImage(failed);
      return failed;
    }
  }, [discard, revoke]);

  /** Drop the pending image, cleaning up both the preview and the upload. */
  const remove = useCallback(async () => {
    // Invalidate any upload still running, so its result cannot resurrect the
    // image the user has just removed.
    uploadRef.current += 1;
    setImage((current) => {
      if (current) {
        revoke(current.previewUrl);
        void discard(current.fileId);
      }
      return null;
    });
  }, [discard, revoke]);

  /**
   * Forget the image without deleting it — for a comment that was just posted.
   *
   * The file now belongs to that comment, so discarding it would be exactly the
   * late cleanup the server exists to refuse.
   */
  const release = useCallback(() => {
    uploadRef.current += 1;
    setImage((current) => {
      if (current) revoke(current.previewUrl);
      return null;
    });
  }, [revoke]);

  /** Swap in an already-uploaded candidate, discarding what was there. */
  const replaceWith = useCallback((next: PendingCommentImage) => {
    setImage((current) => {
      if (current) {
        revoke(current.previewUrl);
        void discard(current.fileId);
      }
      return next;
    });
  }, [discard, revoke]);

  /**
   * Best-effort cleanup when the composer goes away.
   *
   * Runs on unmount, which covers closing the post detail or navigating away.
   * It deliberately does not try to cover a crashed tab or a lost connection —
   * nothing running in the page can — and the sweeper is what makes those cases
   * safe rather than permanent.
   */
  const imageRef = useRef<PendingCommentImage | null>(null);
  imageRef.current = image;
  useEffect(() => () => {
    const pending = imageRef.current;
    if (!pending) return;
    revoke(pending.previewUrl);
    void discard(pending.fileId);
  }, [discard, revoke]);

  return {
    image,
    attach,
    remove,
    release,
    replaceWith,
    discard,
    revoke
  };
}
