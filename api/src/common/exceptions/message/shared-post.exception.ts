import { HttpStatus } from '@nestjs/common';
import { RuntimeException } from 'src/kernel';
import { __t } from 'src/utils/translation';

/** The post is gone, or its author is no longer visible. */
export class SharedPostDeletedException extends RuntimeException {
  constructor(msg: string | object = __t('errors.message_post_deleted'), error = 'POST_DELETED') {
    super(msg, error, HttpStatus.NOT_FOUND);
  }
}

/**
 * The post exists, but this pair may not exchange it.
 *
 * Separate from "deleted" because the fix is different: nothing the sharer does
 * will make a deleted post shareable, whereas this one depends on who they are
 * sharing it with.
 */
export class SharedPostNotAccessibleException extends RuntimeException {
  constructor(msg: string | object = __t('errors.message_post_not_accessible'), error = 'POST_NOT_ACCESSIBLE') {
    super(msg, error, HttpStatus.FORBIDDEN);
  }
}
