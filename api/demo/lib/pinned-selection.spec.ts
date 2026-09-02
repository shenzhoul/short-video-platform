/**
 * Which posts the dataset pins, and why it must not ask the database.
 *
 * Pin state is a property of the plan. The seeder writes what the plan says and
 * nothing else looks at what is already pinned — the same rule that
 * `ringAndChordPartnersOf` exists to enforce for showcase threads, after
 * choosing partners from stored state made a second `demo:seed` grow the
 * dataset.
 *
 * The plan is built from `demo/media/manifest.json`, so these tests build one
 * and compare two runs of the real `buildPlan` rather than re-implementing the
 * selection here — a re-implementation would agree with itself no matter what
 * the seeder did.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const config = require('../demo.config');
const { buildPlan } = require('./plan');

/**
 * The manifest index the plan consumes, built in memory.
 *
 * `manifest.index()` reads the media cache off disk, so calling it here would
 * make this test depend on a 2GB download. `buildPlan` only ever asks the index
 * for slots, so this provides exactly that shape -- enough entries for every
 * theme and account the configuration asks for.
 */
function buildIndex() {
  const bySlot = new Map<string, any[]>();
  const push = (theme: string, purpose: string, entry: any) => {
    const key = `${theme}:${purpose}`;
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key)!.push(entry);
  };

  const entry = (purpose: string, theme: string, index: number, extra: any = {}) => ({
    purpose,
    theme,
    kind: purpose.includes('video') ? 'video' : 'image',
    sourceMediaId: `${purpose}-${theme}-${index}`,
    localFile: `${purpose}/${theme}-${index}.bin`,
    checksum: `sum-${purpose}-${theme}-${index}`,
    width: 1080,
    height: 1920,
    orientation: 'portrait',
    aspectRatio: 0.5625,
    ...extra
  });

  for (const theme of config.themes) {
    const accounts = theme.accounts.length;
    for (let i = 0; i < accounts * config.counts.photoPostsPerAccount; i += 1) {
      push(theme.key, 'post-photo', entry('post-photo', theme.key, i));
    }
    for (let i = 0; i < accounts * config.counts.landscapeVideosPerAccount; i += 1) {
      push(theme.key, 'post-video-landscape', entry('post-video-landscape', theme.key, i, {
        width: 1920,
        height: 1080,
        orientation: 'landscape',
        aspectRatio: 1.7777,
        thumbnail: { localFile: `poster/${theme.key}-l-${i}.jpg` }
      }));
    }
    for (let i = 0; i < accounts * config.counts.portraitVideosPerAccount; i += 1) {
      push(theme.key, 'post-video-portrait', entry('post-video-portrait', theme.key, i, {
        thumbnail: { localFile: `poster/${theme.key}-p-${i}.jpg` }
      }));
    }
    for (let i = 0; i < accounts; i += 1) {
      push(theme.key, 'cover', entry('cover', theme.key, i, {
        width: 1600, height: 900, orientation: 'landscape', aspectRatio: 1.7777
      }));
    }
    for (const persona of theme.accounts) {
      push(theme.key, 'avatar', {
        ...entry('avatar', theme.key, 0, {
          width: 512, height: 512, orientation: 'square', aspectRatio: 1
        }),
        sourceMediaId: persona.username,
        localFile: `avatar/${persona.username}.png`,
        checksum: `sum-avatar-${persona.username}`
      });
    }
  }

  const all = [...bySlot.values()].flat();
  return {
    live: all,
    hasSource: () => false,
    hasChecksum: (sum: string) => all.some((e) => e.checksum === sum),
    forSlot: (theme: string, purpose: string) => bySlot.get(`${theme}:${purpose}`) || [],
    countFor: (theme: string, purpose: string) => (bySlot.get(`${theme}:${purpose}`) || []).length
  };
}

const plan = () => {
  const result = buildPlan({ config, themes: config.themes, index: buildIndex() });
  if (!result.ok) throw new Error(`plan failed: ${result.problems.join(' | ')}`);
  return result.plan;
};

const pinnedOf = (account: any) => account.posts.filter((p: any) => p.isPinned);

describe('pinned post selection', () => {
  it('pins at least one post for every account', () => {
    for (const account of plan().accounts) {
      expect(pinnedOf(account).length).toBeGreaterThanOrEqual(config.counts.pinnedPostsPerAccount);
    }
  });

  it('gives the primary account a pinned photo and a pinned video', () => {
    const account = plan().accounts.find(
      (a: any) => a.username === config.seed.social.primaryUsername
    );
    const pinned = pinnedOf(account);

    // This is the account a person signs in as to look at the dataset, so both
    // kinds have to be visible there rather than "somewhere in the 16".
    expect(pinned.some((p: any) => p.kind === 'photo')).toBe(true);
    expect(pinned.some((p: any) => p.kind === 'video')).toBe(true);
  });

  it('pins two posts on some accounts, so ordering between pins is exercised', () => {
    expect(plan().accounts.some((a: any) => pinnedOf(a).length >= 2)).toBe(true);
  });

  it('covers both photos and videos across the dataset', () => {
    const pinned = plan().accounts.flatMap(pinnedOf);

    expect(pinned.some((p: any) => p.kind === 'photo')).toBe(true);
    expect(pinned.some((p: any) => p.kind === 'video')).toBe(true);
  });

  it('gives every pinned post a pinnedAt, and no unpinned post one', () => {
    for (const account of plan().accounts) {
      for (const post of account.posts) {
        if (post.isPinned) expect(post.pinnedAt).toBeInstanceOf(Date);
        else expect(post.pinnedAt).toBeNull();
      }
    }
  });

  it('gives an account\'s pins distinct timestamps, so their order is defined', () => {
    for (const account of plan().accounts) {
      const pins = pinnedOf(account).map((p: any) => p.pinnedAt.getTime());
      // `account.posts` is in publish order, so the pinned ones come out of it
      // in no particular order -- which is fine, because the API sorts by
      // `pinnedAt`. What matters is that no two share a timestamp: if they did,
      // the order between them would be whatever Mongo happened to return.
      expect(new Set(pins).size).toBe(pins.length);
    }
  });

  it('pins after the posts they promote, so the dates read as a real history', () => {
    for (const account of plan().accounts) {
      for (const post of pinnedOf(account)) {
        expect(post.pinnedAt.getTime()).toBeGreaterThan(new Date(post.publishedAt).getTime());
      }
    }
  });

  it('chooses the same posts on a second build, from the plan alone', () => {
    const first = plan();
    const second = plan();

    const fingerprint = (p: any) => p.accounts.map(
      (a: any) => `${a.username}:${pinnedOf(a).map((post: any) => post.seedKey).join(',')}`
    );

    // The property that stops a second `demo:seed` changing the dataset: the
    // selection is a function of the plan and of nothing else.
    expect(fingerprint(second)).toEqual(fingerprint(first));
  });

  it('never pins a post belonging to another account', () => {
    for (const account of plan().accounts) {
      for (const post of pinnedOf(account)) {
        expect(post.seedKey.startsWith(`post:${account.username}:`)).toBe(true);
      }
    }
  });
});
