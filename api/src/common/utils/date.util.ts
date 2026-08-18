export function toDate(input: string | number | Date): Date | null {
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }

  if (typeof input === 'number') {
    const date = new Date(input);
    return isNaN(date.getTime()) ? null : date;
  }

  if (typeof input === 'string') {
    const timestamp = Number(input);
    if (!Number.isNaN(timestamp)) {
      const date = new Date(timestamp);
      return isNaN(date.getTime()) ? null : date;
    }

    const date = new Date(input);
    return isNaN(date.getTime()) ? null : date;
  }

  return null;
}