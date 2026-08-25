import { MESSAGE_SYSTEM_EVENTS } from 'src/common/constants/community';
import { __t } from 'src/utils/translation';

/**
 * The wording for a system notice, in the reader's language.
 *
 * One place branches on the event, so adding a notice means adding a line here
 * rather than teaching every renderer a new enum value. An unrecognised event
 * resolves to an empty string: the client skips a notice it has no wording for,
 * which is better than putting `mutual_follow` in front of somebody.
 */
export function resolveSystemNoticeText(systemEvent: string | null): string {
  if (systemEvent === MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW) {
    return __t('messages.mutual_follow_notice');
  }
  return '';
}
