import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { createSafeSearchRegex, sanitizeSearchQuery } from 'src/common/utils/search-sanitizer.util';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { SearchRequestPayload, SearchResultType } from 'src/payloads';
import { STATUS } from 'src/kernel/constants';
import { Post, type PostDocument, TagSummary, type TagSummaryDocument } from 'src/schemas';
import { ContentService } from 'src/services/content/content.service';
import { UserSearchAndFilterService } from 'src/services/identity/user/user-search.service';

/** Number of items each vertical contributes to the combined `all` response. */
const SUMMARY_LIMITS = {
  post: 8,
  user: 5,
  tag: 5
};

/** Size of the "hot" band. Suggestions deliberately start below it to avoid duplicate lists. */
const HOT_TOPIC_LIMIT = 6;
const SUGGESTED_LIMIT = 6;
const RELATED_LIMIT = 10;
/** Below this many query-matched tags, related searches top up with popular ones. */
const RELATED_MIN_RESULTS = 3;

/** Minimum/maximum length of a readable phrase, and how many rows to over-fetch. */
const PHRASE_MIN_LENGTH = 4;
const PHRASE_MAX_LENGTH = 40;
const PHRASE_OVERFETCH = 6;
/** Autocomplete rows offered for plain search text. */
const QUERY_SUGGESTION_LIMIT = 6;

/**
 * Splits post text on every character `sanitizeSearchQuery` strips out.
 *
 * The sanitiser keeps letters, digits, marks, whitespace, hyphen and underscore, then the whole
 * remainder is used as one contiguous regex. So a phrase spanning a colon, comma or full stop can
 * never match the very post it was taken from: the query loses the punctuation, the stored text
 * keeps it. Only an unbroken run of searchable characters is safe to hand back as a query.
 *
 * Newlines are excluded deliberately — the sanitiser collapses them to a single space, so a phrase
 * spanning one stops matching for the same reason punctuation does.
 */
const UNSEARCHABLE_RUN = /[^\p{L}\p{N}\p{M}\-_ \t]+/u;
/** A run of whitespace is collapsed to a single space by the sanitiser, so it breaks a match too. */
const COLLAPSING_WHITESPACE = /\s{2,}|\t+/;

export interface TagSearchResult {
  tag: string;
  postCount: number;
  totalLikes: number;
  rank?: number;
}

/**
 * A phrase a person can search for.
 *
 * `text` is what the panel renders; `query` is what gets searched when it is clicked. They are the
 * same today, but keeping them separate means a label can later differ from its query without
 * changing the client.
 *
 * The single primitive behind hot topics, "You might be searching" and plain-text autocomplete —
 * those differ only in how the underlying posts are selected and ranked, not in what a suggestion
 * *is*, so they share this shape and the extraction rules that guarantee a click returns results.
 */
export interface SearchablePhrase {
  text: string;
  query: string;
}

@Injectable()
export class SearchService {
  constructor(
    @InjectModel(TagSummary.name)
    private readonly TagSummaryModel: Model<TagSummaryDocument>,
    @InjectModel(Post.name)
    private readonly PostModel: Model<PostDocument>,
    private readonly contentService: ContentService,
    private readonly userSearchService: UserSearchAndFilterService
  ) { }

  /**
   * Shortens a phrase for display without breaking it as a query.
   *
   * Cuts on a word boundary, which keeps the result a literal prefix of the original run — still a
   * substring of the post, so the regex built from it still matches.
   */
  private truncateAtWord(value: string): string {
    if (value.length <= PHRASE_MAX_LENGTH) return value;

    const cut = value.slice(0, PHRASE_MAX_LENGTH);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace >= PHRASE_MIN_LENGTH ? cut.slice(0, lastSpace) : cut).trim();
  }

  /**
   * Turns one field of a post into searchable phrases, best first.
   *
   * Hashtags and mentions are stripped because they read as data, not language — these panels exist
   * to be clicked as searches, and `#underwaterphotography` is not what a person types. What is left
   * is split on everything the search sanitiser would remove, so every phrase returned is guaranteed
   * to still match the post it came from. Longest run first, since that is the headline rather than
   * a stray fragment: "Title: Morning Workout Routine" yields "Morning Workout Routine", not "Title".
   */
  private toSearchablePhrases(source?: string): string[] {
    if (!source) return [];

    return source
      .replace(/#[\wÀ-ſЀ-ӿ一-鿿]+/g, ' ')
      .replace(/@[\w.]+/g, ' ')
      .split(UNSEARCHABLE_RUN)
      .flatMap(part => part.split(COLLAPSING_WHITESPACE))
      .map(part => part.trim())
      .filter(part => part.length >= PHRASE_MIN_LENGTH)
      .sort((a, b) => b.length - a.length)
      .map(part => this.truncateAtWord(part));
  }

  /**
   * The phrases one post can contribute, in preference order.
   *
   * Title first: it is the shortest, most deliberate sentence a creator writes, so it reads as a
   * natural search phrase without any language processing. The description is mined second, which
   * also lets a small catalogue fill several panels — one post can headline hot topics with its
   * title and still supply a distinct phrase elsewhere.
   */
  private toPhraseCandidates(post: { title?: string; text?: string }): string[] {
    return [
      this.toSearchablePhrases(post.title)[0],
      this.toSearchablePhrases(post.text)[0]
    ].filter(Boolean) as string[];
  }

  /**
   * Whether a phrase says the same thing as one already listed.
   *
   * Exact matching is not enough: a title and its own description overlap heavily, and showing both
   * "Morning Workout Routine" and "My simple morning workout routine for" reads as a duplicate even
   * though the strings differ. Containment either way catches that.
   */
  private isDuplicatePhrase(text: string, seen: string[]): boolean {
    const key = text.toLowerCase();
    return seen.some(other => other.includes(key) || key.includes(other));
  }

  /**
   * Collects searchable phrases from posts, skipping anything already listed.
   *
   * `perPost` trades breadth for volume: hot topics take one phrase per post so the ranking spans
   * distinct content, while the suggestion lists may take a second phrase from the same post because
   * they have a smaller pool left to draw from.
   *
   * `mustContain` is what makes this usable for autocomplete: a post can match a search through its
   * tags while none of its prose contains the typed text, and offering "Underwater photography tips"
   * as a completion of "div" looks broken even though the post is a legitimate hit.
   */
  private collectPhrases(
    posts: Array<{ title?: string; text?: string }>,
    seen: string[],
    limit: number,
    { perPost = 1, mustContain = '' }: { perPost?: number; mustContain?: string } = {}
  ): SearchablePhrase[] {
    const entries: SearchablePhrase[] = [];
    const needle = mustContain.trim().toLowerCase();

    for (const post of posts) {
      let taken = 0;
      for (const text of this.toPhraseCandidates(post)) {
        if (entries.length >= limit) return entries;
        if (taken >= perPost) break;
        if (needle && !text.toLowerCase().includes(needle)) continue;
        if (this.isDuplicatePhrase(text, seen)) continue;
        seen.push(text.toLowerCase());
        taken += 1;
        // `query` is kept separate from `text` so a label can later differ from what it searches.
        // Today they match, and that is what guarantees the click returns the originating post.
        entries.push({ text, query: text });
      }
    }

    return entries;
  }

  /** Posts a visitor may see, matched against free text the same way post search matches it. */
  private freeTextPostFilter(searchRegex: RegExp) {
    return {
      ...this.visiblePostFilter,
      $or: [
        { title: { $regex: searchRegex } },
        { text: { $regex: searchRegex } },
        { tags: { $regex: searchRegex } }
      ]
    };
  }

  /**
   * Splits a raw query into a free-text term and an optional exact hashtag.
   *
   * A leading `#` states the intent plainly, so it is honoured as an exact tag match rather than
   * being folded into free-text search where prose mentions would dilute the results.
   */
  private parseQuery(rawQuery: string) {
    const query = (rawQuery || '').trim();
    if (!query.startsWith('#')) return { query, tag: null as string | null };

    const tag = query.slice(1).trim().toLowerCase();
    return { query, tag: tag || null };
  }

  async searchPosts(request: SearchRequestPayload, user?: AuthUserDto) {
    const { query, tag } = this.parseQuery(request.q);
    // A bare "#" carries no term to search on.
    if (tag === null && !query) return this.emptyPage();
    // A term that sanitises away to nothing — "???" or an emoji — must return nothing. The post
    // query builder skips its filter when the regex comes back null, which would otherwise turn an
    // unsearchable query into "every post on the site".
    if (!tag && !createSafeSearchRegex(query)) return this.emptyPage();

    return this.contentService.userSearchPosts({
      ...(tag ? { tag } : { q: query }),
      limit: request.limit,
      offset: request.offset,
      sortBy: 'createdAt',
      sort: 'desc'
    } as any, user as any);
  }

  async searchUsers(request: SearchRequestPayload) {
    const { query, tag } = this.parseQuery(request.q);
    // Hashtag intent is about content, not accounts.
    if (tag !== null) return this.emptyPage();
    // Same guard as posts: an unsearchable term must not fall through to "every active account".
    if (query && !createSafeSearchRegex(query)) return this.emptyPage();

    return this.userSearchService.publicSearch({
      q: query,
      limit: request.limit,
      offset: request.offset
    } as any);
  }

  async searchTags(request: SearchRequestPayload) {
    const { query, tag } = this.parseQuery(request.q);
    const term = tag ?? query;
    if (!term) return this.emptyPage();

    const searchRegex = createSafeSearchRegex(term);
    if (!searchRegex) return this.emptyPage();

    const limit = Number(request.limit) || SUMMARY_LIMITS.tag;
    const offset = Number(request.offset) || 0;
    const filter = { tag: { $regex: searchRegex } };

    const [rows, total] = await Promise.all([
      this.TagSummaryModel
        .find(filter)
        .sort({ grandTotalUsage: -1, lastUsageDate: -1 })
        .skip(offset)
        .limit(limit + 1)
        .lean(),
      this.TagSummaryModel.countDocuments(filter)
    ]);

    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: items.map<TagSearchResult>(row => ({
        tag: row.tag,
        postCount: row.grandTotalUsage || 0,
        totalLikes: row.grandTotalLikes || 0
      })),
      hasMore,
      total
    };
  }

  /** Combined payload backing the Summary tab. */
  async searchAll(request: SearchRequestPayload, user?: AuthUserDto) {
    const [posts, users, tags] = await Promise.all([
      this.searchPosts({ ...request, limit: SUMMARY_LIMITS.post, offset: 0 }),
      this.searchUsers({ ...request, limit: SUMMARY_LIMITS.user, offset: 0 }),
      this.searchTags({ ...request, limit: SUMMARY_LIMITS.tag, offset: 0 })
    ]);

    return { posts, users, tags };
  }

  async search(request: SearchRequestPayload, user?: AuthUserDto) {
    switch (request.type) {
      case SearchResultType.POST:
        return this.searchPosts(request, user);
      case SearchResultType.USER:
        return this.searchUsers(request);
      case SearchResultType.TAG:
        return this.searchTags(request);
      default:
        return this.searchAll(request, user);
    }
  }

  /**
   * Plain-text autocomplete: what a person might be typing, as words rather than hashtags.
   *
   * The third suggestion source alongside hashtags and accounts, and the one the search bar was
   * missing — typing "div" could only ever offer `#diving`, which is a different intent from
   * searching for "Amazing Diving Trip in Bali".
   *
   * Shares the phrase primitive with hot topics and differs only in selection: posts are matched by
   * the typed text using the same fields and regex semantics as post search, and every returned
   * phrase must contain that text. So a click always runs a query that this very search would have
   * matched — the suggestion cannot lead to an empty page.
   *
   * Hot topics are not excluded here. The panel shows discovery *or* autocomplete, never both, so
   * there is no duplication on screen; suppressing the best match because it is popular would only
   * make the more relevant suggestion disappear.
   */
  async querySuggestions(term: string, limit = QUERY_SUGGESTION_LIMIT): Promise<SearchablePhrase[]> {
    const keyword = (term || '').trim();
    const searchRegex = keyword ? createSafeSearchRegex(keyword) : null;
    if (!searchRegex) return [];

    const posts = await this.PostModel
      .find(this.freeTextPostFilter(searchRegex))
      .sort({ totalLike: -1, totalView: -1, createdAt: -1 })
      .limit(limit * PHRASE_OVERFETCH)
      .select({ title: 1, text: 1 })
      .lean();

    // Containment is checked against the *sanitised* term, since that is what the phrases were built
    // from — comparing against the raw input would reject everything the moment it held punctuation.
    // Two phrases per post: a title and a description can both be reasonable completions, and the
    // matching set is often small.
    return this.collectPhrases(posts as any[], [], limit, {
      perPost: 2,
      mustContain: sanitizeSearchQuery(keyword)
    });
  }

  /**
   * Autocomplete for the search bar and for `#`/`@` triggers in the post composer.
   *
   * Prefix-anchored so it can use the indexes on `TagSummary.tag` and `User.username` rather than
   * scanning, which is what keeps it cheap enough to call on every keystroke.
   */
  async suggestions(term: string, type: 'tag' | 'user' | 'query', limit = 8) {
    const keyword = (term || '').trim().replace(/^[#@]/, '');

    if (type === 'query') return this.querySuggestions(keyword, limit);

    // An empty keyword is a real state, not a no-op: the composer opens this dropdown the moment a
    // bare `#` or `@` is typed, and expects a starting list to pick from. Both branches fall back to
    // their most popular entries rather than returning nothing.
    const searchRegex = keyword ? createSafeSearchRegex(keyword) : null;
    if (keyword && !searchRegex) return [];
    const prefixFilter = searchRegex
      ? { $regex: new RegExp(`^${searchRegex.source}`, 'i') }
      : null;

    if (type === 'tag') {
      const rows = await this.TagSummaryModel
        .find(prefixFilter ? { tag: prefixFilter } : {})
        .sort({ grandTotalUsage: -1 })
        .limit(limit)
        .lean();
      return rows.map<TagSearchResult>(row => ({
        tag: row.tag,
        postCount: row.grandTotalUsage || 0,
        totalLikes: row.grandTotalLikes || 0
      }));
    }

    // publicSearch already skips its keyword filter when `q` is empty, returning active users
    // ordered by follower count — exactly the "who might I mention" list.
    const result = await this.userSearchService.publicSearch({ q: keyword, limit } as any);
    return result.data as Partial<UserDto>[];
  }

  private toTagResult(row: Pick<TagSummaryDocument, 'tag' | 'grandTotalUsage' | 'grandTotalLikes' | 'popularityRank'>): TagSearchResult {
    return {
      tag: row.tag,
      postCount: row.grandTotalUsage || 0,
      totalLikes: row.grandTotalLikes || 0,
      rank: row.popularityRank || 0
    };
  }

  /** Live posts, restricted to what a visitor is allowed to see. */
  private get visiblePostFilter() {
    return { status: STATUS.ACTIVE, isCreatorDeleted: { $ne: true } };
  }

  /**
   * Everything the search popup shows before a query is typed.
   *
   * Built as one pass so the two lists share a single dedupe set — computing them independently
   * meant Hot Topics had to be derived twice and the exclusion between them was easy to get wrong.
   *
   * Both lists are phrases rather than hashtags. `#underwaterphotography` is data; "Underwater
   * Photography Tips" is what a person would type, and these panels exist to be clicked as searches.
   * Every entry is derived from a real, visible post and is punctuation-free, so clicking it is
   * guaranteed to return at least the post it came from. Topic labels are deliberately *not* used as
   * filler: "Knowledge" is readable but nothing guarantees a post matches it as free text, and a
   * suggestion that leads to an empty result page is worse than a shorter list.
   */
  async discovery(recentTerms: string[] = []): Promise<{
    hotTopics: SearchablePhrase[];
    suggested: SearchablePhrase[];
  }> {
    // Shared across both lists, so "You might be searching" can never repeat a hot topic.
    const seen: string[] = [];

    const popular = await this.PostModel
      .find(this.visiblePostFilter)
      .sort({ totalLike: -1, totalView: -1, createdAt: -1 })
      .limit(HOT_TOPIC_LIMIT * PHRASE_OVERFETCH)
      .select({ title: 1, text: 1 })
      .lean();
    const hotTopics = this.collectPhrases(popular as any[], seen, HOT_TOPIC_LIMIT);

    const suggested = await this.suggestedSearches(recentTerms, seen);
    return { hotTopics, suggested };
  }

  /**
   * "You might be searching": phrases from content related to the viewer's recent searches.
   *
   * Selected differently from Hot Topics on purpose — it starts from what the viewer has been
   * looking for, then tops up from the newest posts rather than the most engaging ones, so the two
   * panels stay distinct even when they draw from the same small catalogue. Two phrases per post are
   * allowed here because the popular posts have already been consumed by the time this runs.
   */
  private async suggestedSearches(recentTerms: string[], seen: string[]): Promise<SearchablePhrase[]> {
    const entries: SearchablePhrase[] = [];
    const remaining = () => SUGGESTED_LIMIT - entries.length;

    for (const term of recentTerms.slice(0, 3)) {
      if (remaining() <= 0) break;
      const searchRegex = createSafeSearchRegex(term.replace(/^#/, ''));
      if (!searchRegex) continue;

      const matches = await this.PostModel
        .find(this.freeTextPostFilter(searchRegex))
        .sort({ totalLike: -1, createdAt: -1 })
        .limit(SUGGESTED_LIMIT)
        .select({ title: 1, text: 1 })
        .lean();

      entries.push(...this.collectPhrases(matches as any[], seen, remaining(), { perPost: 2 }));
    }

    if (remaining() > 0) {
      const recent = await this.PostModel
        .find(this.visiblePostFilter)
        .sort({ createdAt: -1 })
        .limit(SUGGESTED_LIMIT * PHRASE_OVERFETCH)
        .select({ title: 1, text: 1 })
        .lean();
      entries.push(...this.collectPhrases(recent as any[], seen, remaining(), { perPost: 2 }));
    }

    return entries;
  }

  /**
   * "Related searches" for a results page: tags that actually contain the query.
   *
   * Must stay tied to the query — falling back to global trending here would suggest "#football"
   * next to a search for diving. Only tops up with popular tags if nothing matches at all.
   */
  async relatedSearches(rawQuery: string, limit = RELATED_LIMIT): Promise<TagSearchResult[]> {
    const { query, tag } = this.parseQuery(rawQuery);
    const term = (tag ?? query).trim();
    if (!term) return [];

    const searchRegex = createSafeSearchRegex(term);
    if (!searchRegex) return [];

    const matches = await this.TagSummaryModel
      .find({ tag: { $regex: searchRegex } })
      .sort({ trendingScore: -1, grandTotalUsage: -1 })
      .limit(limit)
      .lean();

    if (matches.length >= RELATED_MIN_RESULTS) {
      return matches.map(row => this.toTagResult(row as any));
    }

    const seenTags = matches.map((row: any) => row.tag);
    const filler = await this.TagSummaryModel
      .find(seenTags.length ? { tag: { $nin: seenTags } } : {})
      .sort({ trendingScore: -1 })
      .limit(limit - matches.length)
      .lean();

    return [...matches, ...filler].map(row => this.toTagResult(row as any));
  }

  private emptyPage() {
    return { data: [], hasMore: false, total: 0 };
  }
}
