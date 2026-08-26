/**
 * In-memory stand-in for a MongoDB collection, supporting only what the seed migration uses.
 *
 * `updateOne` implements the one semantic the migration depends on: with `upsert` and a document
 * containing only `$setOnInsert`, an existing record is left completely alone.
 */
class FakeCollection {
  public docs: any[] = [];

  public indexes: Array<{ key: any; options: any }> = [];

  /** Records the order operations happened in, so "index before data" can be asserted. */
  public operations: string[] = [];

  async createIndex(key: any, options: any) {
    this.operations.push('createIndex');
    const name = options?.name;
    const existing = this.indexes.find((index) => index.options?.name === name);
    if (existing) {
      if (JSON.stringify(existing.key) !== JSON.stringify(key)) {
        throw new Error(`IndexKeySpecsConflict: ${name}`);
      }
      return name;
    }
    this.indexes.push({ key, options });
    return name;
  }

  async updateOne(filter: any, update: any, options: any = {}) {
    this.operations.push('updateOne');
    const existing = this.docs.find((doc) => doc.key === filter.key);

    if (existing) {
      if (update.$set) Object.assign(existing, update.$set);
      // $setOnInsert is deliberately ignored for an existing document.
      return { matchedCount: 1, upsertedCount: 0 };
    }

    if (!options.upsert) return { matchedCount: 0, upsertedCount: 0 };

    const uniqueIndex = this.indexes.find((index) => index.options?.unique && index.key?.key === 1);
    if (uniqueIndex && this.docs.some((doc) => doc.key === filter.key)) {
      const error: any = new Error('E11000 duplicate key');
      error.code = 11000;
      error.keyPattern = { key: 1 };
      throw error;
    }

    this.docs.push({ ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) });
    return { matchedCount: 0, upsertedCount: 1 };
  }

  async countDocuments(filter: any = {}) {
    if (filter.topicKey) return this.docs.filter((doc) => doc.topicKey === filter.topicKey).length;
    return this.docs.length;
  }

  async deleteOne(filter: any) {
    const index = this.docs.findIndex((doc) => doc.key === filter.key);
    if (index >= 0) this.docs.splice(index, 1);
    return { deletedCount: index >= 0 ? 1 : 0 };
  }
}

const categories = new FakeCollection();
const posts = new FakeCollection();

jest.mock('../../../../migrations/lib', () => ({
  COLLECTION: { CATEGORY: 'categories', POST: 'posts' },
  DB: {
    collection: (name: string) => (name === 'posts' ? posts : categories)
  }
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const migration = require('../../../../migrations/1787600000000-seed-post-categories');
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const seedData = require('../../../../migrations/data/post-categories');

// The migration functions are `async` and also call the migrate runner's `next` callback, so the
// returned promise is what to await here; `next` is supplied as a no-op.
const runUp = () => migration.up(() => undefined);
const runDown = () => migration.down(() => undefined);

describe('seed-post-categories migration', () => {
  beforeEach(() => {
    categories.docs = [];
    categories.indexes = [];
    categories.operations = [];
    posts.docs = [];
    posts.operations = [];
  });

  it('seeds the thirteen catalogue entries a fresh database needs', async () => {
    await runUp();

    expect(categories.docs).toHaveLength(13);
    expect(categories.docs.map((doc) => doc.key)).toEqual([
      'knowledge', 'games', 'anime', 'music', 'film', 'food', 'lifestyle',
      'sports', 'travel', 'parenting', 'animals', 'beauty', 'photography'
    ]);
    expect(categories.docs.every((doc) => doc.status === 'active')).toBe(true);
    expect(categories.docs.map((doc) => doc.ordering)).toEqual([
      10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130
    ]);
  });

  it('creates the unique key index before inserting anything', async () => {
    await runUp();

    const firstInsert = categories.operations.indexOf('updateOne');
    const lastIndex = categories.operations.lastIndexOf('createIndex');
    expect(lastIndex).toBeLessThan(firstInsert);
    expect(categories.indexes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        key: { key: 1 },
        options: expect.objectContaining({ name: 'idx_category_key_unique', unique: true })
      }),
      expect.objectContaining({
        key: { status: 1, ordering: 1, name: 1 },
        options: expect.objectContaining({ name: 'idx_category_status_ordering_name' })
      })
    ]));
  });

  it('creates no duplicates when run again', async () => {
    await runUp();
    await runUp();
    await runUp();

    expect(categories.docs).toHaveLength(13);
    expect(new Set(categories.docs.map((doc) => doc.key)).size).toBe(13);
  });

  it('leaves an admin rename, disable and reorder untouched on a re-run', async () => {
    await runUp();

    const games = categories.docs.find((doc) => doc.key === 'games');
    games.name = 'Gaming & Esports';
    games.status = 'inactive';
    games.ordering = 5;

    await runUp();

    expect(categories.docs.find((doc) => doc.key === 'games')).toMatchObject({
      name: 'Gaming & Esports',
      status: 'inactive',
      ordering: 5
    });
  });

  it('adds only what is missing when the catalogue is already partly seeded', async () => {
    categories.docs = [{ key: 'travel', name: 'Travel', status: 'active', ordering: 90 }];

    await runUp();

    expect(categories.docs).toHaveLength(13);
    expect(categories.docs.filter((doc) => doc.key === 'travel')).toHaveLength(1);
  });

  it('never reads or writes the posts collection', async () => {
    posts.docs = [{ _id: 'p1', topicKey: 'travel' }];

    await runUp();

    expect(posts.operations).toHaveLength(0);
    expect(posts.docs).toEqual([{ _id: 'p1', topicKey: 'travel' }]);
  });

  it('keeps every seeded key resolvable for the posts that already store one', async () => {
    posts.docs = [
      { topicKey: 'photography' }, { topicKey: 'travel' }, { topicKey: 'lifestyle' },
      { topicKey: 'film' }, { topicKey: 'food' }, { topicKey: 'games' }
    ];

    await runUp();

    const seededKeys = new Set(categories.docs.map((doc) => doc.key));
    const unresolvable = posts.docs.filter((post) => post.topicKey && !seededKeys.has(post.topicKey));
    expect(unresolvable).toEqual([]);
  });

  describe('down', () => {
    it('removes seeded categories that no post references', async () => {
      await runUp();

      await runDown();

      expect(categories.docs).toHaveLength(0);
    });

    it('keeps a category a post still points at, so no post is left with a dead key', async () => {
      await runUp();
      posts.docs = [{ topicKey: 'travel' }];

      await runDown();

      expect(categories.docs.map((doc) => doc.key)).toEqual(['travel']);
    });
  });

  it('matches the keys and labels the hard-coded catalogue used to expose', () => {
    // The former POST_TOPICS constant, reproduced here so a change to the seed that silently
    // renames a key — and orphans every post storing it — fails instead of shipping.
    expect(seedData.map(({ key, name }) => ({ key, name }))).toEqual([
      { key: 'knowledge', name: 'Knowledge' },
      { key: 'games', name: 'Games' },
      { key: 'anime', name: 'Anime' },
      { key: 'music', name: 'Music' },
      { key: 'film', name: 'Film and television' },
      { key: 'food', name: 'Gourmet' },
      { key: 'lifestyle', name: 'Life on Vlog' },
      { key: 'sports', name: 'Sports' },
      { key: 'travel', name: 'Travel' },
      { key: 'parenting', name: 'Parent-child' },
      { key: 'animals', name: 'Animals' },
      { key: 'beauty', name: 'Wearing beauty' },
      { key: 'photography', name: 'Photography' }
    ]);
  });
});
