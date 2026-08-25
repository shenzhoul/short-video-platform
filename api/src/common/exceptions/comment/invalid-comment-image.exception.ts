import {
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED,
  COMMENT_IMAGE_ERROR_STATUS,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  INVALID_COMMENT_IMAGE_FORMAT,
  MAX_COMMENT_IMAGE_BYTES
} from '@douyin-clone/upload-policy';
import { RuntimeException } from 'src/kernel';
import { __t } from 'src/utils/translation';

/**
 * ## One contract, three codes, three services
 *
 * A refused comment image can be refused by the composer, by this API when it
 * issues an upload URL, or by the file server when it reads the bytes. All three
 * answer with the same three codes, imported here from
 * `@douyin-clone/upload-policy` rather than retyped, because a client that
 * matches on a code needs that code to be identical wherever the rejection came
 * from.
 *
 * The three are kept apart because they are three different instructions:
 *
 *  - `INVALID_COMMENT_IMAGE_FORMAT` — not a picture; choose a different file.
 *  - `COMMENT_IMAGE_FILE_TOO_LARGE` — a fine picture, too many bytes; save it
 *    smaller. Never used for a resolution problem: a 30000x30000 PNG can be
 *    200KB, and "save it smaller" would be advice that does not apply.
 *  - `COMMENT_IMAGE_DIMENSIONS_EXCEEDED` — a fine picture with too much of it:
 *    width, height, total pixels, frame count or playing time. A smaller or
 *    shorter copy of the very same file would be accepted.
 */
export {
  INVALID_COMMENT_IMAGE_FORMAT,
  COMMENT_IMAGE_FILE_TOO_LARGE,
  COMMENT_IMAGE_DIMENSIONS_EXCEEDED,
  MAX_COMMENT_IMAGE_BYTES
};

/**
 * A comment image refused for its byte count.
 *
 * Answered with 413 rather than 400 — the one rejection in the set where the
 * transport itself has an opinion, and the status a caller would expect for a
 * payload that is simply too big.
 *
 * The API raises this from the size a request declares, before an upload URL
 * exists, so an oversized picture costs one small request instead of a transfer
 * that was always going to be thrown away. The declared size is a claim, which
 * is why the file server weighs the bytes that actually arrive as well.
 */
export class CommentImageFileTooLargeException extends RuntimeException {
  constructor(
    msg: string | object = __t('errors.comment_image_file_too_large'),
    error = COMMENT_IMAGE_FILE_TOO_LARGE
  ) {
    super(msg, error, COMMENT_IMAGE_ERROR_STATUS.COMMENT_IMAGE_FILE_TOO_LARGE);
  }
}

/**
 * A comment image refused for its resolution or animation rather than its size.
 *
 * The API rarely raises this itself — the file server rejects an oversized
 * upload before a record survives for a comment to name. It exists so the code
 * has one definition shared by both services, and for the case where an older
 * record predates the limits.
 */
export class CommentImageTooLargeException extends RuntimeException {
  constructor(
    msg: string | object = __t('errors.comment_image_dimensions_exceeded'),
    error = COMMENT_IMAGE_DIMENSIONS_EXCEEDED
  ) {
    super(msg, error, COMMENT_IMAGE_ERROR_STATUS.COMMENT_IMAGE_DIMENSIONS_EXCEEDED);
  }
}

/**
 * A comment image that cannot be attached because of what it is.
 *
 * Distinct from "not found" and from "already attached": those are about which
 * file was named, this one is about the file's own content or state. The client
 * shows a format error for it and keeps whatever image was already attached.
 */
export class InvalidCommentImageException extends RuntimeException {
  constructor(
    msg: string | object = __t('errors.comment_image_invalid_format'),
    error = INVALID_COMMENT_IMAGE_FORMAT
  ) {
    super(msg, error, COMMENT_IMAGE_ERROR_STATUS.INVALID_COMMENT_IMAGE_FORMAT);
  }
}
