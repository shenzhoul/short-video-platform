import {
  Controller, Get, HttpCode, HttpStatus, Injectable, Query, UseGuards, UsePipes, ValidationPipe
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { POST_TOPICS } from 'src/common/constants';
import { CurrentUser } from 'src/common/decorators';
import { CustomThrottlerGuard, LoadUser } from 'src/common/guards';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { DataResponse } from 'src/kernel';
import { SearchRequestPayload, SearchSuggestionRequestPayload } from 'src/payloads';
import { SearchService } from 'src/services/content/search';

@Injectable()
@Controller('/search')
@ApiTags('Search')
export class SearchController {
  constructor(private readonly searchService: SearchService) { }

  /**
   * Public search. `LoadUser` is optional auth so results can carry the viewer's own like/follow
   * state when signed in, while still working for anonymous visitors.
   */
  @Get('/')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Search posts, users and hashtags' })
  @ApiQuery({ type: SearchRequestPayload })
  async search(
    @Query() query: SearchRequestPayload,
    @CurrentUser() user: AuthUserDto
  ): Promise<DataResponse<any>> {
    return DataResponse.ok(await this.searchService.search(query, user));
  }

  @Get('/suggestions')
  @UseGuards(LoadUser, CustomThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  @ApiOperation({ summary: 'Autocomplete hashtags or users while typing' })
  @ApiQuery({ type: SearchSuggestionRequestPayload })
  async suggestions(
    @Query() query: SearchSuggestionRequestPayload
  ): Promise<DataResponse<any>> {
    return DataResponse.ok(await this.searchService.suggestions(query.q, query.type, query.limit));
  }

  /**
   * Everything the search popup shows before a query is typed.
   *
   * `recent` carries the viewer's locally stored history so suggestions can be biased toward it
   * without the server keeping a search log.
   */
  @Get('/discovery')
  @UseGuards(CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hot topics and suggested searches for the search popup' })
  @ApiQuery({ name: 'recent', required: false, description: 'Comma separated recent search terms' })
  async discovery(
    @Query('recent') recent?: string
  ): Promise<DataResponse<any>> {
    const recentTerms = (recent || '')
      .split(',')
      .map(term => term.trim())
      .filter(Boolean)
      .slice(0, 5);

    return DataResponse.ok(await this.searchService.discovery(recentTerms));
  }

  @Get('/related')
  @UseGuards(CustomThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hashtags related to a search query' })
  @ApiQuery({ name: 'q', required: true })
  async related(@Query('q') q: string): Promise<DataResponse<any>> {
    return DataResponse.ok(await this.searchService.relatedSearches(q || ''));
  }

  /**
   * The canonical topic list, so the composer and the home category bar render exactly the keys the
   * API will accept rather than each maintaining their own copy.
   */
  @Get('/topics')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List the content topics a post can be filed under' })
  async topics(): Promise<DataResponse<typeof POST_TOPICS>> {
    return DataResponse.ok(POST_TOPICS);
  }
}
