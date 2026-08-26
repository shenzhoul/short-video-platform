import { IsIn, IsOptional, IsString } from 'class-validator';
import { POST_CATEGORY_STATUSES } from 'src/common/constants';
import { SearchRequest } from 'src/kernel/common';

/**
 * Admin category listing. Offset pagination only — the catalogue is a short, admin-curated list, so
 * there is no deep-pagination case for cursors to solve.
 */
export class CategorySearchRequest extends SearchRequest {
  @IsString()
  @IsOptional()
  @IsIn(POST_CATEGORY_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  sortBy = 'ordering';
}
