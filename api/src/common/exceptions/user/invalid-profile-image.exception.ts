import { ForbiddenException, HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * A file was offered as an avatar or cover that may not be used as one.
 *
 * Each of these is checked against the record the file server wrote, never
 * against anything the request said about the file. Request metadata is chosen
 * by the uploader, and image processing normalises much of it away — the durable
 * `type` on the record is the only statement about what an upload *was for*.
 *
 * The refusals are separate because the remedies are: a file belonging to
 * somebody else is a permission problem, a post video offered as an avatar is a
 * client bug, and an image whose processing failed is a file to upload again.
 */

/** The file server has no record with that id. */
export class ProfileImageNotFoundException extends HttpException {
  constructor() {
    super(__t('errors.profile_image_not_found'), 404);
  }
}

/**
 * The file exists but was not uploaded as this kind of profile image.
 *
 * An `avatar` may only become an avatar and a `cover` only a cover: the two have
 * different limits and different processing, so accepting one for the other
 * publishes an image that was never validated for where it is being shown.
 */
export class ProfileImageWrongTypeException extends ForbiddenException {
  constructor() {
    super(__t('errors.profile_image_wrong_type'));
  }
}

/**
 * The file belongs to somebody else, or is already claimed by another profile.
 *
 * Both read the same way to the caller on purpose. Distinguishing "not yours"
 * from "already in use by user X" would confirm the existence and ownership of a
 * file id the caller is not entitled to know about.
 */
export class ProfileImageNotOwnedException extends ForbiddenException {
  constructor() {
    super(__t('errors.profile_image_not_owned'));
  }
}

/**
 * The upload has not finished processing, or processing failed.
 *
 * The record survives a failed decode, so this is the last place that can tell.
 * Attaching one publishes a profile pointing at an image that was never
 * produced — a broken picture for every viewer, and not something the profile
 * owner would be able to diagnose.
 */
export class ProfileImageNotReadyException extends HttpException {
  constructor() {
    super(__t('errors.profile_image_not_ready'), 409);
  }
}
