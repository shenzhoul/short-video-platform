import { Transform, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { PAGINATION_DEFAULTS } from 'src/common/constants';

/** Search verticals. `ALL` returns a combined payload for the Summary tab. */
export enum SearchResultType {
  ALL = 'all',
  POST = 'post',
  USER = 'user',
  TAG = 'tag'
}

export const SEARCH_QUERY_MAX_LENGTH = 100;

export class SearchRequestPayload {
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  q = '';

  @IsOptional()
  @IsEnum(SearchResultType)
  type: SearchResultType = SearchResultType.ALL;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Transform(({ value }) => {
    const parsed = parseInt(value, 10);
    if (!parsed || parsed < 0 || parsed > PAGINATION_DEFAULTS.MAX_LIMIT) {
      return PAGINATION_DEFAULTS.DEFAULT_LIMIT;
    }
    return parsed;
  })
  limit: number = PAGINATION_DEFAULTS.DEFAULT_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Transform(({ value }) => {
    const parsed = parseInt(value, 10);
    if (!parsed || parsed < 0) return 0;
    return parsed;
  })
  offset = 0;
}

export class SearchSuggestionRequestPayload {
  @IsOptional()
  @IsString()
  @MaxLength(SEARCH_QUERY_MAX_LENGTH)
  q = '';

  /**
   * Which suggestion source to draw from.
   *
   * `query` returns plain search phrases taken from post content — a different intent from `tag`,
   * which returns hashtags. Typing "div" should be able to offer "Amazing Diving Trip in Bali" as
   * well as `#diving`, so the search bar asks for all three independently.
   */
  @IsOptional()
  @IsEnum(['tag', 'user', 'query'])
  type: 'tag' | 'user' | 'query' = 'tag';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Transform(({ value }) => {
    const parsed = parseInt(value, 10);
    if (!parsed || parsed < 1 || parsed > 20) return 8;
    return parsed;
  })
  limit = 8;
}
