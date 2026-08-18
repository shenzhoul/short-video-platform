import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable
} from '@nestjs/common';
import { PAGINATION_DEFAULTS } from '../constants/shared';

/**
 * Pagination Guard
 *
 * Validates pagination parameters to ensure proper usage:
 * 1. Limit cannot exceed MAX_LIMIT
 * 2. Offset cannot exceed MAX_OFFSET without cursor-based pagination
 * 3. When offset > MAX_OFFSET, cursor and lastCreatedAt must be provided
 *
 * This guard helps prevent deep pagination performance issues and guides
 * users toward more efficient cursor-based pagination for large datasets.
 */
@Injectable()
export class PaginationGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const { query } = request;

    // Validate limit
    const limit = query.limit ? parseInt(query.limit, 10) : PAGINATION_DEFAULTS.DEFAULT_LIMIT;
    if (limit > PAGINATION_DEFAULTS.MAX_LIMIT) {
      throw new BadRequestException(
        `Limit cannot exceed ${PAGINATION_DEFAULTS.MAX_LIMIT}. Current limit: ${limit}`
      );
    }

    // Validate offset and cursor-based pagination requirements
    const offset = query.offset ? parseInt(query.offset, 10) : 0;
    if (offset > PAGINATION_DEFAULTS.MAX_OFFSET) {
      const { cursor } = query;
      const { lastCreatedAt } = query;

      if (!cursor || !lastCreatedAt) {
        throw new BadRequestException(
          `Offset cannot exceed ${PAGINATION_DEFAULTS.MAX_OFFSET}. For pagination beyond this limit, use cursor-based pagination with 'cursor' and 'lastCreatedAt' parameters. Current offset: ${offset}`
        );
      }
    }

    return true;
  }
}
