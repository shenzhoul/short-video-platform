import moment from 'moment';

export function formatDate(date: Date | string, format = 'DD/MM/YYYY HH:mm:ss') {
  return moment(date).format(format);
}

export function formatDateNoTime(date: Date | string, format = 'DD/MM/YYYY') {
  return moment(date).format(format);
}

export function getDiffDate(date: Date | string, type = 'years') {
  return moment().diff(moment(date), type as any);
}

export function formatDateFromNow(date: Date | string) {
  return moment(date).fromNow();
}

/**
 * Compact activity timestamp used in dense lists such as the notification panel.
 *
 * Shows the clock time for today, day and month within the current year, and
 * the full date beyond that — so the label stays short while still being
 * unambiguous the further back an item is.
 */
export function formatActivityTimestamp(date: Date | string) {
  const value = moment(date);
  if (!value.isValid()) return '';

  const now = moment();
  if (value.isSame(now, 'day')) return value.format('HH:mm');
  if (value.isSame(now, 'year')) return value.format('MM-DD');
  return value.format('YYYY-MM-DD');
}
