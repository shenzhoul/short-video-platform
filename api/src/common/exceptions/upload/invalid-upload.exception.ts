import {
  UNSUPPORTED_UPLOAD_TYPE,
  UPLOAD_ERROR_MESSAGES,
  UPLOAD_ERROR_STATUS,
  UploadPolicy
} from '@douyin-clone/upload-policy';
import { RuntimeException } from 'src/kernel';
import { __t } from 'src/utils/translation';

/**
 * ## One contract, many codes, three services
 *
 * A refused upload can be refused by the picker, by this API when it issues an
 * upload URL, or by the file server when it reads the bytes. All three answer
 * with the same codes, imported from `@douyin-clone/upload-policy` rather than
 * retyped, because a client that matches on a code needs that code to be
 * identical wherever the rejection came from.
 *
 * The codes are split by *what the person can do about it*, not by which check
 * happened to run:
 *
 *  - `INVALID_IMAGE_FORMAT` / `INVALID_VIDEO_FORMAT` — not the kind of file it
 *    claims to be; choose a different one.
 *  - `IMAGE_FILE_TOO_LARGE` / `VIDEO_FILE_TOO_LARGE` — a fine file, too many
 *    bytes; save it smaller. Never used for a resolution problem: a 30000x30000
 *    PNG can be 200KB, and "save it smaller" would be advice that does not
 *    apply.
 *  - `IMAGE_DIMENSIONS_EXCEEDED` — too much picture: width, height, pixels,
 *    frames or playing time.
 *  - `VIDEO_DURATION_EXCEEDED`, `VIDEO_RESOLUTION_EXCEEDED`,
 *    `VIDEO_FRAME_RATE_EXCEEDED`, `VIDEO_CODEC_NOT_SUPPORTED` — the video's own
 *    axes, each with its own remedy.
 *  - `UNSUPPORTED_UPLOAD_TYPE` — nothing in the registry claims this upload
 *    type. Not the uploader's mistake, and deliberately not reported as a format
 *    problem: the file may be perfectly good.
 *
 * The three `COMMENT_*` codes still exist and still belong to `comment-photo`
 * alone. The comment composer matches on them; answering a post upload with one
 * would tell it a comment rule was broken, which is neither true nor actionable.
 */

/**
 * The API was asked for an upload URL for a type no policy governs.
 *
 * Refused rather than issued, and the reason is worth stating plainly: without a
 * policy there is nothing for the file server to enforce, so issuing the URL
 * would mean accepting an unvalidated file. A typo in a client, a type somebody
 * forgot to register, and a hand-crafted request all land here — the first two
 * are bugs that should be loud, and the third is exactly what should be refused.
 */
export class UnsupportedUploadTypeException extends RuntimeException {
  constructor(msg: string | object = __t('errors.upload_type_unsupported')) {
    super(msg, UNSUPPORTED_UPLOAD_TYPE, UPLOAD_ERROR_STATUS[UNSUPPORTED_UPLOAD_TYPE] as any);
  }
}

/**
 * The translation key that carries each byte-limit refusal's wording.
 *
 * The shared policy's own message (`Image must be 20MB or smaller`) exists for
 * the file server and the browser, which have no translation layer. The API does
 * have one, and the comment feature already shipped a translated sentence that
 * says more than the policy's — so the key is looked up here and the policy's
 * message is the fallback rather than the other way round.
 *
 * Keyed by code, not by upload type: three clients speak three vocabularies and
 * each expects its own code, but "too many bytes" reads the same in all of them.
 */
const FILE_TOO_LARGE_MESSAGE_KEYS: Record<string, string> = {
  COMMENT_IMAGE_FILE_TOO_LARGE: 'errors.comment_image_file_too_large',
  IMAGE_FILE_TOO_LARGE: 'errors.upload_image_file_too_large',
  VIDEO_FILE_TOO_LARGE: 'errors.upload_video_file_too_large'
};

/** `20971520` as `20MB`, for a sentence a reader can act on. */
const describeBytes = (bytes: number): string => {
  const mb = bytes / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
};

/**
 * The declared size already breaks the policy's byte limit.
 *
 * Raised before an upload URL exists, so an oversized file costs one small
 * request instead of a transfer that was always going to be thrown away. The
 * declared size is a claim like any other, which is why the file server weighs
 * the bytes that actually arrive as well — this is a courtesy, never the
 * enforcement.
 *
 * The code comes from the policy rather than being fixed, so a comment image
 * gets `COMMENT_IMAGE_FILE_TOO_LARGE`, a post photo gets `IMAGE_FILE_TOO_LARGE`
 * and a video gets `VIDEO_FILE_TOO_LARGE` — three clients, three vocabularies,
 * one exception class.
 */
export class UploadFileTooLargeException extends RuntimeException {
  constructor(policy: UploadPolicy) {
    const code = policy.codes.fileTooLarge;
    const key = FILE_TOO_LARGE_MESSAGE_KEYS[code];
    const message = key
      ? __t(key, { limit: describeBytes(policy.maxBytes) })
      : (policy.messages[code] || UPLOAD_ERROR_MESSAGES[code]);

    super(message, code, (policy.statuses[code] || 413) as any);
  }
}
