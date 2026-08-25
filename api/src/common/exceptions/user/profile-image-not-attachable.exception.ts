import { HttpException } from '@nestjs/common';
import { __t } from 'src/utils/translation';

/**
 * A profile image could not be claimed by its owner, so it was not applied.
 *
 * The file server reports how many records an ownership update matched. Zero
 * means the file is gone, was never created, or is not the record the request
 * named — and in every one of those cases the image carries no `refItem`.
 * `cleanup-unused-files.job.ts` decides what is abandoned purely from
 * `refItems`, so pointing a user document at such a file would publish an
 * avatar or cover that the sweeper deletes within hours, leaving the profile
 * showing a URL whose bytes are gone.
 *
 * Failing here instead keeps the previous image in place and asks the client to
 * upload again, which is recoverable. A silently broken profile is not.
 */
export class ProfileImageNotAttachableException extends HttpException {
  constructor() {
    super(__t('errors.profile_image_not_attachable'), 409);
  }
}
