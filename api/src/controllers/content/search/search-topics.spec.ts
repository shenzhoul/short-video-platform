/**
 * The controller pulls in the search payloads, which pull in the HTML sanitizer, which loads
 * `isomorphic-dompurify` — an ESM package Jest cannot parse under this project's CommonJS
 * transform. Nothing here exercises sanitization, so it is stubbed out rather than transformed.
 */
jest.mock('isomorphic-dompurify', () => ({ sanitize: (value: string) => value }));

import { CategoryDto } from 'src/dtos/content/category';

import { SearchController } from './search.controller';

const category = (key: string, name: string, status = 'active') => CategoryDto.fromModel({
  _id: key, key, name, status, ordering: 10, description: ''
});

describe('GET /search/topics', () => {
  it('returns the unchanged { key, label } shape the web client has always consumed', async () => {
    const categoryService = {
      findActive: jest.fn().mockResolvedValue([
        category('knowledge', 'Knowledge'),
        category('film', 'Film and television')
      ])
    };
    const controller = new SearchController({} as any, categoryService as any);

    const response: any = await controller.topics();

    expect(response.data).toEqual([
      { key: 'knowledge', label: 'Knowledge' },
      { key: 'film', label: 'Film and television' }
    ]);
  });

  it('serves the catalogue from the database rather than a constant', async () => {
    const categoryService = { findActive: jest.fn().mockResolvedValue([]) };
    const controller = new SearchController({} as any, categoryService as any);

    await controller.topics();

    expect(categoryService.findActive).toHaveBeenCalledTimes(1);
  });

  it('exposes only active categories, because findActive is the single source', async () => {
    // `findActive` filters and orders in the query; the controller adds nothing, so a disabled
    // category can never reach the response by way of this route.
    const categoryService = {
      findActive: jest.fn().mockResolvedValue([category('travel', 'Travel')])
    };
    const controller = new SearchController({} as any, categoryService as any);

    const response: any = await controller.topics();

    expect(response.data).toEqual([{ key: 'travel', label: 'Travel' }]);
  });

  it('preserves the order the catalogue query produced', async () => {
    const categoryService = {
      findActive: jest.fn().mockResolvedValue([
        category('knowledge', 'Knowledge'),
        category('games', 'Games'),
        category('anime', 'Anime')
      ])
    };
    const controller = new SearchController({} as any, categoryService as any);

    const response: any = await controller.topics();

    expect(response.data.map((topic: any) => topic.key)).toEqual(['knowledge', 'games', 'anime']);
  });
});

describe('hard-coded topic catalogue', () => {
  it('is no longer exported from the content constants', () => {
    // Required at runtime rather than imported so the assertion survives the symbols being gone;
    // an import of a removed export would not compile, and this needs to fail loudly if one is
    // reintroduced and something starts reading it again.
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const constants = require('src/common/constants/content');

    expect(constants.POST_TOPICS).toBeUndefined();
    expect(constants.POST_TOPIC_KEYS).toBeUndefined();
  });

  it('leaves only the key format rules behind', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const constants = require('src/common/constants/content');

    expect(constants.POST_CATEGORY_STATUSES).toEqual(['active', 'inactive']);
    expect(constants.POST_CATEGORY_KEY_PATTERN.test('street-food')).toBe(true);
    expect(constants.POST_CATEGORY_KEY_PATTERN.test('Street Food')).toBe(false);
    expect(constants.POST_CATEGORY_KEY_PATTERN.test('-leading')).toBe(false);
    expect(constants.POST_CATEGORY_KEY_PATTERN.test('double--hyphen')).toBe(false);
  });
});
