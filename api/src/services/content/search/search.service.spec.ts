// The service pulls in the payload barrel, which reaches `isomorphic-dompurify` — an ESM-only
// package Jest cannot transform. Nothing here exercises sanitisation of HTML, so it is stubbed.
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

// eslint-disable-next-line import/first
import { createSafeSearchRegex } from 'src/common/utils/search-sanitizer.util';
// eslint-disable-next-line import/first
import { SearchService } from './search.service';

type SeedPost = { title?: string; text?: string };

/** Mimics the `find().sort().limit().select().lean()` chain the service uses. */
function mockPostModel(posts: SeedPost[]) {
  const chain: any = {
    sort: () => chain,
    limit: () => chain,
    select: () => chain,
    lean: async () => posts
  };
  return { find: jest.fn(() => chain) };
}

function buildService(posts: SeedPost[]) {
  return new SearchService({} as any, mockPostModel(posts) as any, {} as any, {} as any);
}

/**
 * Reproduces what `userSearchPosts` does with a query: sanitise it, then use the whole thing as one
 * contiguous regex. A discovery entry is only useful if its query survives that round trip.
 */
function matchesPost(query: string, post: SeedPost) {
  const regex = createSafeSearchRegex(query);
  if (!regex) return false;
  return regex.test(post.title || '') || regex.test(post.text || '');
}

describe('SearchService discovery', () => {
  it('drops punctuation the search sanitiser cannot match, so every entry finds its own post', async () => {
    // The colon is the regression: the sanitiser strips it from the query but the stored title keeps
    // it, so "Title: Morning Workout Routine" could never match the post it was taken from.
    const post = {
      title: 'Title: Morning Workout Routine',
      text: 'My simple morning workout routine for staying active. #fitness #workout'
    };
    const service = buildService([post]);

    const { hotTopics } = await service.discovery();

    expect(hotTopics[0]).toEqual({
      text: 'Morning Workout Routine',
      query: 'Morning Workout Routine'
    });
    expect(matchesPost(hotTopics[0].query, post)).toBe(true);
  });

  it('keeps every hot topic and suggestion clickable back to a real post', async () => {
    const posts: SeedPost[] = [
      { title: 'Title: Morning Workout Routine', text: 'A simple routine for staying active.' },
      { title: 'Underwater Photography Tips', text: 'Tips for taking better underwater photos.' },
      { title: 'A Korean feng shui film', text: 'The ceiling of the national fortune, explained.' },
      { title: 'Easy Pasta Recipe for Beginner', text: 'Anyone can make this at home. #cooking' },
      { title: 'Best Travel Experience', text: 'One of the best trips I have ever taken.' },
      { title: 'My First Night Playing This', text: 'I finally tried this game last night.' },
      { title: 'Amazing Diving Trip in Bali', text: 'Today I went diving and discovered a reef.' }
    ];
    const service = buildService(posts);

    const { hotTopics, suggested } = await service.discovery();

    expect(hotTopics).toHaveLength(6);
    expect(suggested.length).toBeGreaterThan(1);
    for (const entry of [...hotTopics, ...suggested]) {
      expect(posts.some(post => matchesPost(entry.query, post))).toBe(true);
    }
  });

  it('never repeats a hot topic in the suggestion list', async () => {
    const posts: SeedPost[] = Array.from({ length: 12 }, (_, index) => ({
      title: `Distinct headline number ${index}`,
      text: `A separate description body ${index} worth reading.`
    }));
    const service = buildService(posts);

    const { hotTopics, suggested } = await service.discovery();
    const texts = [...hotTopics, ...suggested].map(entry => entry.text.toLowerCase());

    expect(new Set(texts).size).toBe(texts.length);
    expect(suggested).toHaveLength(6);
  });

  it('offers CJK titles now that the sanitiser preserves them', async () => {
    const post = { title: '为了找到一把刺杀总统的狙击枪', text: '' };
    const service = buildService([post]);

    const { hotTopics } = await service.discovery();

    expect(hotTopics).toHaveLength(1);
    expect(matchesPost(hotTopics[0].query, post)).toBe(true);
  });

  it('skips posts with no searchable text rather than offering a dead query', async () => {
    const service = buildService([{ title: '!!! ??? ...', text: '' }]);

    const { hotTopics } = await service.discovery();

    expect(hotTopics).toEqual([]);
  });
});

describe('SearchService querySuggestions', () => {
  const posts: SeedPost[] = [
    { title: 'Amazing Diving Trip in Bali', text: 'Today I went diving and found a reef.' },
    { title: 'Underwater Photography Tips', text: 'Tips for better underwater photos.' }
  ];

  it('returns plain phrases, not hashtags, and each one really matches a post', async () => {
    const service = buildService(posts);

    const results = await service.querySuggestions('div');

    expect(results.length).toBeGreaterThan(0);
    for (const entry of results) {
      expect(entry.text).not.toContain('#');
      expect(entry.text.toLowerCase()).toContain('div');
      expect(posts.some(post => matchesPost(entry.query, post))).toBe(true);
    }
    expect(results.map(entry => entry.text)).toContain('Amazing Diving Trip in Bali');
  });

  it('drops phrases that do not contain the typed text', async () => {
    // A post can match through its tags while none of its prose does; completing "div" with
    // "Underwater Photography Tips" would look broken even though the post is a legitimate hit.
    const service = buildService(posts);

    const results = await service.querySuggestions('div');

    expect(results.map(entry => entry.text)).not.toContain('Underwater Photography Tips');
  });

  it('matches CJK text instead of collapsing to an unfiltered search', async () => {
    const post = { title: '美食探店日记', text: '' };
    const service = buildService([post]);

    const results = await service.querySuggestions('美食');

    expect(results).toHaveLength(1);
    expect(matchesPost(results[0].query, post)).toBe(true);
  });

  it('returns nothing for a term that sanitises away', async () => {
    const service = buildService(posts);

    expect(await service.querySuggestions('???')).toEqual([]);
    expect(await service.querySuggestions('')).toEqual([]);
  });
});
