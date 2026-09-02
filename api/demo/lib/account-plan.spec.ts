/**
 * The dataset's shape is configuration, and these tests hold it to that.
 *
 * Two things are being defended:
 *
 * 1. **Nothing downstream hardcodes a count.** The post mix, the orientation
 *    split and the account minimum live in `demo.config.js`; `resolveAccountPlan`
 *    is the only place they are turned into requirements. A test that asserted
 *    "9 videos" against a literal would keep passing after somebody changed the
 *    config, which is the opposite of useful — so the expectations here are
 *    computed from the config too, and the literals only appear in the test that
 *    checks the *shipped default* is what was asked for.
 *
 * 2. **Category coverage is structural.** One theme names one category and every
 *    theme carries at least one account, so coverage cannot be forgotten — and
 *    `assertCategoryCoverage` catches the other direction, where the product
 *    gains a category the themes do not mention.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { resolveAccountPlan, assertCategoryCoverage, postsPerAccount } = require('./account-plan');
const config = require('../demo.config');
const themes = require('../themes');

const buildTheme = (key: string, topicKey: string, accounts: number) => ({
  key,
  label: key,
  topicKey,
  accounts: Array.from({ length: accounts }, (_, i) => ({
    name: `Person ${key}${i}`, username: `${key}-${i}`, bio: 'bio'
  }))
});

describe('the shipped default dataset', () => {
  it('is 10 posts per account: 6 landscape video, 3 portrait video, 1 photo', () => {
    // The one place the required numbers are asserted literally, because this is
    // the requirement itself rather than a derived consequence of it.
    expect(config.counts.landscapeVideosPerAccount).toBe(6);
    expect(config.counts.portraitVideosPerAccount).toBe(3);
    expect(config.counts.photoPostsPerAccount).toBe(1);
    expect(postsPerAccount(config)).toBe(10);
  });

  it('is 90% video and 10% photo', () => {
    const videos = config.counts.landscapeVideosPerAccount + config.counts.portraitVideosPerAccount;
    expect(videos / postsPerAccount(config)).toBeCloseTo(0.9, 5);
    expect(config.counts.photoPostsPerAccount / postsPerAccount(config)).toBeCloseTo(0.1, 5);
  });

  it('has more landscape video than portrait', () => {
    expect(config.counts.landscapeVideosPerAccount)
      .toBeGreaterThan(config.counts.portraitVideosPerAccount);
  });

  it('resolves to at least the configured minimum number of accounts', () => {
    const result = resolveAccountPlan(config, themes);
    expect(result.ok).toBe(true);
    expect(result.plan.totalAccounts).toBeGreaterThanOrEqual(config.counts.minAccounts);
    expect(result.plan.totalPosts)
      .toBe(result.plan.totalAccounts * postsPerAccount(config));
  });

  it('gives every theme a distinct category and every account a distinct username', () => {
    const result = resolveAccountPlan(config, themes);
    expect(result.ok).toBe(true);
    expect(new Set(result.plan.categories).size).toBe(result.plan.categories.length);

    const usernames = themes.flatMap((t: any) => t.accounts.map((a: any) => a.username));
    expect(new Set(usernames).size).toBe(usernames.length);
  });

  it('names the primary demo account among the personas', () => {
    // The account the README publishes and a person signs in as. If a rename
    // ever drops it, the documented credential stops working.
    const usernames = themes.flatMap((t: any) => t.accounts.map((a: any) => a.username));
    expect(usernames).toContain(config.seed.social.primaryUsername);
  });

  it('has enough written captions for every post it will create', () => {
    const perAccount = {
      videos: config.counts.landscapeVideosPerAccount + config.counts.portraitVideosPerAccount,
      photos: config.counts.photoPostsPerAccount
    };
    for (const theme of themes) {
      const accounts = theme.accounts.length;
      // Repeating a caption would be visible in the feed, so the pools have to
      // cover the whole dataset rather than be topped up by reuse.
      expect(theme.videoCaptions.length).toBeGreaterThanOrEqual(accounts * perAccount.videos);
      expect(theme.photoCaptions.length).toBeGreaterThanOrEqual(accounts * perAccount.photos);
      expect(new Set(theme.videoCaptions).size).toBe(theme.videoCaptions.length);
      expect(new Set(theme.photoCaptions).size).toBe(theme.photoCaptions.length);
    }
  });

  it('asks for exactly the media the post mix implies', () => {
    const result = resolveAccountPlan(config, themes);
    const accounts = result.plan.totalAccounts;
    expect(result.plan.totals['post-video-landscape'])
      .toBe(accounts * config.counts.landscapeVideosPerAccount);
    expect(result.plan.totals['post-video-portrait'])
      .toBe(accounts * config.counts.portraitVideosPerAccount);
    expect(result.plan.totals['post-photo']).toBe(accounts * config.counts.photoPostsPerAccount);
    expect(result.plan.totals.cover).toBe(accounts);
    expect(result.plan.totals.avatar).toBe(accounts);
  });
});

describe('account plan resolution', () => {
  const smallConfig = {
    counts: {
      landscapeVideosPerAccount: 2, portraitVideosPerAccount: 1, photoPostsPerAccount: 1, minAccounts: 2
    }
  };

  it('scales the requirements with the number of accounts a theme hosts', () => {
    const result = resolveAccountPlan(smallConfig, [
      buildTheme('one', 'cat-a', 1),
      buildTheme('two', 'cat-b', 3)
    ]);

    expect(result.ok).toBe(true);
    const [first, second] = result.plan.themes;
    expect(first.requirements['post-video-landscape']).toBe(2);
    expect(second.requirements['post-video-landscape']).toBe(6);
    expect(second.requirements.cover).toBe(3);
    expect(result.plan.totalAccounts).toBe(4);
  });

  it('refuses two themes claiming the same category', () => {
    const result = resolveAccountPlan(smallConfig, [
      buildTheme('one', 'shared', 1),
      buildTheme('two', 'shared', 1)
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain("both claim category 'shared'");
  });

  it('refuses a theme with no accounts, because its category would be uncovered', () => {
    const result = resolveAccountPlan(smallConfig, [
      buildTheme('one', 'cat-a', 1),
      buildTheme('empty', 'cat-b', 0)
    ]);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('has no accounts');
  });

  it('refuses a duplicate username across themes', () => {
    const a = buildTheme('one', 'cat-a', 1);
    const b = buildTheme('two', 'cat-b', 1);
    b.accounts[0].username = a.accounts[0].username;

    const result = resolveAccountPlan(smallConfig, [a, b]);

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('is used by themes');
  });

  it('refuses a plan below the configured account minimum', () => {
    const result = resolveAccountPlan(
      { counts: { ...smallConfig.counts, minAccounts: 10 } },
      [buildTheme('one', 'cat-a', 1)]
    );

    expect(result.ok).toBe(false);
    expect(result.problems.join(' ')).toContain('minAccounts is 10');
  });
});

describe('category coverage', () => {
  const plan = resolveAccountPlan(
    { counts: { landscapeVideosPerAccount: 1, portraitVideosPerAccount: 1, photoPostsPerAccount: 1, minAccounts: 1 } },
    [buildTheme('one', 'food', 1), buildTheme('two', 'travel', 1)]
  ).plan;

  it('reports an active category no theme covers', () => {
    // The case that matters: the product gains a category and nobody adds a
    // theme, so it would silently have no demo content.
    const result = assertCategoryCoverage(plan, ['food', 'travel', 'music']);
    expect(result.uncovered).toEqual(['music']);
    expect(result.unknown).toEqual([]);
  });

  it('reports a theme naming a category that is not active', () => {
    const result = assertCategoryCoverage(plan, ['food']);
    expect(result.unknown).toEqual(['travel']);
  });

  it('is satisfied when the two sets match', () => {
    const result = assertCategoryCoverage(plan, ['travel', 'food']);
    expect(result.uncovered).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it('covers every category the shipped themes name, with no gaps', () => {
    const shipped = resolveAccountPlan(config, themes).plan;
    const result = assertCategoryCoverage(shipped, shipped.categories);
    expect(result.uncovered).toEqual([]);
    expect(result.unknown).toEqual([]);
  });
});
