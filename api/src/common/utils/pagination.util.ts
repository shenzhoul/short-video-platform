import { ObjectId } from 'mongodb';
import { toDate } from 'src/common/utils/date.util';

/**
 * Helper method to parse different date formats into a Date object
 * Supports: ISO date strings, timestamp strings, and numbers
 *
 * @param dateInput - The date input in various formats
 * @returns Parsed Date object
 */
export function parseDateFromCursor(dateInput: string | number | Date): Date {
  const parsed = toDate(dateInput);

  if (parsed && !Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  // Fallback: attempt native Date parsing to maintain backward compatibility
  const fallback = new Date(dateInput);
  if (!Number.isNaN(fallback.getTime())) {
    return fallback;
  }

  // As a last resort, return the epoch to avoid crashing the query builder
  return new Date(0);
}

/**
 * Creates cursor-based pagination condition for MongoDB queries
 *
 * Implements compound cursor logic to prevent data loss with identical timestamps
 * using $or logic for reliable pagination.
 *
 * @param cursor - The cursor ID (last item's _id)
 * @param lastCreatedAt - The last item's createdAt timestamp
 * @param dateField - The date field to use for cursor pagination (default: 'createdAt')
 * @returns MongoDB query condition for cursor-based pagination
 */
export function createCursorCondition(cursor: string, lastCreatedAt: string | number | Date, dateField: string = 'createdAt') {
  const parsedDate = parseDateFromCursor(lastCreatedAt);

  return {
    $or: [
      // Primary: items created before cursor timestamp
      { [dateField]: { $lt: parsedDate } },
      // Tiebreaker: same timestamp but smaller _id (ensures deterministic order)
      {
        [dateField]: parsedDate,
        _id: { $lt: new ObjectId(cursor) }
      }
    ]
  };
}

/**
 * Applies cursor-based pagination to a MongoDB query
 *
 * @param query - The existing MongoDB query object
 * @param cursor - The cursor ID (last item's _id)
 * @param lastCreatedAt - The last item's timestamp
 * @param dateField - The date field to use for cursor pagination (default: 'createdAt')
 * @returns Updated query with cursor conditions
 */
export function applyCursorPagination(
  query: Record<string, any>,
  cursor: string,
  lastCreatedAt: string | number | Date,
  dateField: string = 'createdAt'
): Record<string, any> {
  const cursorCondition = createCursorCondition(cursor, lastCreatedAt, dateField);

  const updatedQuery: Record<string, any> = {
    ...query
  };

  const existingAndConditions = Array.isArray(updatedQuery.$and)
    ? [...updatedQuery.$and]
    : [];

  // Preserve any existing $or conditions by moving them into $and
  if (updatedQuery.$or) {
    existingAndConditions.push({ $or: updatedQuery.$or });
    delete updatedQuery.$or;
  }

  // Ensure cursor condition is appended
  existingAndConditions.push({ $or: cursorCondition.$or });

  if (existingAndConditions.length === 1) {
    // Only the cursor condition exists – use $or for simplicity
    updatedQuery.$or = existingAndConditions[0].$or;
  } else {
    updatedQuery.$and = existingAndConditions;
  }

  return updatedQuery;
}