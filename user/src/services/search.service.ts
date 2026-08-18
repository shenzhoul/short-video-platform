import { IPost } from '@interfaces/post';
import { IUser } from '@interfaces/user';

import { APIRequest } from './api-request';

export type SearchResultType = 'all' | 'post' | 'user' | 'tag';

export interface ITagSearchResult {
  tag: string;
  postCount: number;
  totalLikes: number;
  /** 1-based trending position, assigned by the scheduled trending job. */
  rank?: number;
}

/**
 * A phrase a person can search for: `text` is displayed, `query` is what gets searched.
 *
 * Deliberately not a hashtag — this is the shape behind hot topics, "You might be searching" and
 * plain-text autocomplete alike, which differ in how they are ranked, not in what they are.
 */
export interface IDiscoveryEntry {
  text: string;
  query: string;
}

/** Which suggestion source to draw from. `query` is plain text, not hashtags. */
export type SuggestionType = 'tag' | 'user' | 'query';

export interface ISearchDiscovery {
  hotTopics: IDiscoveryEntry[];
  suggested: IDiscoveryEntry[];
}

export interface IPostTopic {
  key: string;
  label: string;
}

export interface SearchPage<T> {
  data: T[];
  hasMore: boolean;
  total?: number;
}

export interface SearchAllResult {
  posts: SearchPage<IPost>;
  users: SearchPage<IUser>;
  tags: SearchPage<ITagSearchResult>;
}

interface SearchQuery {
  q: string;
  type?: SearchResultType;
  limit?: number;
  offset?: number;
}

export class SearchService extends APIRequest {
  search = (query: SearchQuery, headers?: Record<string, string>) => this.get(
    this.buildUrl('/search', query as Record<string, any>),
    headers
  );

  suggestions = (q: string, type: SuggestionType, limit?: number) => this.get(
    this.buildUrl('/search/suggestions', { q, type, ...(limit ? { limit } : {}) })
  );

  topics = (headers?: Record<string, string>) => this.get('/search/topics', headers);

  discovery = (recent: string[]) => this.get(
    this.buildUrl('/search/discovery', recent.length ? { recent: recent.join(',') } : undefined)
  );

  related = (q: string) => this.get(this.buildUrl('/search/related', { q }));
}

const searchServiceInstance = new SearchService();

export const searchAll = (q: string, headers?: Record<string, string>) => searchServiceInstance
  .search({ q, type: 'all' }, headers);

export const searchByType = (
  q: string,
  type: SearchResultType,
  limit: number,
  offset: number,
  headers?: Record<string, string>
) => searchServiceInstance.search({
  q, type, limit, offset
}, headers);

export const getSearchSuggestions = (
  q: string,
  type: SuggestionType,
  limit?: number
) => searchServiceInstance.suggestions(q, type, limit);

export const getPostTopics = (headers?: Record<string, string>) => searchServiceInstance.topics(headers);
export const getSearchDiscovery = (recent: string[] = []) => searchServiceInstance.discovery(recent);
export const getRelatedSearches = (q: string) => searchServiceInstance.related(q);
