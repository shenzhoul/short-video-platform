/**
 * Regression tests for the one property the demo seeder must never lose:
 * running it twice creates nothing the second time.
 *
 * The bug this file exists for was real and shipped in the first version. The
 * reply block drew from the seeded generator *inside* an `if (row does not
 * exist)` branch. On the first run those draws happened; on the second they were
 * skipped, the generator's stream shifted by four values, and every subsequent
 * `random.chance(replyChance)` in the loop answered differently — so a re-run
 * added 26 replies while reporting every other kind of row as already present.
 *
 * The counters were still right afterwards, because `reconcile.js` recomputes
 * rather than increments. That is precisely what made it dangerous: nothing
 * looked wrong. Only counting the rows caught it.
 *
 * The rule these tests defend: **a seeded generator's stream may depend on the
 * seed and nothing else — never on what is already in the database.**
 */

/* eslint-disable @typescript-eslint/no-var-requires */
const { seedPostEngagement, seedFollows } = require('./seed-interactions');
const { createRandom } = require('./random');

/** Minimal in-memory stand-ins for the two collections the seeder writes. */
function createFakeDb() {
  const store: Record<string, Map<string, any>> = {
    reactions: new Map(),
    comments: new Map()
  };
  const collection = (name: string) => ({
    findOne: async ({ _id }: any) => store[name].get(String(_id)) || null,
    insertOne: async (doc: any) => {
      store[name].set(String(doc._id), doc);
      return { insertedId: doc._id };
    }
  });
  return {
    reactions: collection('reactions'),
    comments: collection('comments'),
    store
  };
}

/** A ledger that behaves like the real one: claim is idempotent per seed key. */
function createFakeLedger() {
  const rows = new Map<string, any>();
  let counter = 0;
  return {
    rows,
    claim: async (kind: string, seedKey: string) => {
      const key = `${kind}:${seedKey}`;
      if (rows.has(key)) return { refId: rows.get(key).refId, created: false };
      counter += 1;
      // Deterministic 24-hex ids, so the fake behaves like ObjectIds without
      // pulling the driver into a unit test.
      const refId = counter.toString(16).padStart(24, '0');
      rows.set(key, { refId, status: 'pending' });
      return { refId, created: true };
    },
    activate: async (kind: string, seedKey: string) => {
      const row = rows.get(`${kind}:${seedKey}`);
      if (row) row.status = 'active';
    }
  };
}

const config = {
  seed: {
    postWindowDays: 90,
    // Both ratios are non-zero so the mention and comment-like paths are
    // actually exercised. With them at zero the branches would be skipped and
    // the idempotency assertions below would prove nothing about them.
    social: {
      mentionRatio: 0.3,
      commentLikeRatio: 0.5
    },
    interactions: {
      followsPerAccount: [3, 11],
      sameThemeFollowBias: 0.55,
      likesPerPost: [0, 12],
      popularPostRatio: 0.18,
      commentsPerPost: [0, 5],
      replyChance: 0.28,
      sharesPerPost: [0, 3]
    }
  }
};

function buildFixture() {
  const themes = ['alpha', 'beta'];
  const accounts = themes.flatMap((themeKey, t) => [0, 1, 2].map((i) => ({
    username: `${themeKey}-user-${i}`,
    themeKey,
    commentPool: ['Nice one.', 'Love this.', 'How did you do that?', 'Saving this.', 'Great work.']
  })));
  const userIds = new Map(accounts.map((a, i) => [a.username, `user-${i}`]));

  const postIndex = accounts.flatMap((account, ai) => [0, 1, 2].map((p) => ({
    postId: `post-${ai}-${p}`,
    userId: userIds.get(account.username),
    username: account.username,
    themeKey: account.themeKey,
    publishedAt: new Date(Date.UTC(2026, 5, 1 + p, 12, 0, 0)),
    seedKey: `post:${account.username}:${p}`
  })));

  return { plan: { accounts, userIds }, postIndex };
}

const now = new Date(Date.UTC(2026, 8, 1, 12, 0, 0));

describe('demo seed interactions', () => {
  it('creates nothing on a second run over the same database', async () => {
    const { plan, postIndex } = buildFixture();
    const db = createFakeDb();
    const ledger = createFakeLedger();

    const first = await seedPostEngagement({
      plan, postIndex, db, ledger, config, now
    });
    expect(first.likes + first.comments + first.replies + first.shares).toBeGreaterThan(0);
    // The two paths added for notification coverage must actually have run.
    expect(first.commentLikes).toBeGreaterThan(0);
    const mentioned = [...db.store.comments.values()].filter((c: any) => c.mentionedUserIds?.length);
    expect(mentioned.length).toBeGreaterThan(0);

    const reactionsAfterFirst = db.store.reactions.size;
    const commentsAfterFirst = db.store.comments.size;

    const second = await seedPostEngagement({
      plan, postIndex, db, ledger, config, now
    });

    // The assertion that would have failed before the fix: replies came back 26.
    expect(second).toEqual({
      likes: 0, comments: 0, replies: 0, shares: 0, commentLikes: 0
    });
    expect(db.store.reactions.size).toBe(reactionsAfterFirst);
    expect(db.store.comments.size).toBe(commentsAfterFirst);
  });

  it('creates nothing on a second run of follows', async () => {
    const { plan } = buildFixture();
    const db = createFakeDb();
    const ledger = createFakeLedger();

    const first = await seedFollows({
      plan, db, ledger, config, now
    });
    expect(first).toBeGreaterThan(0);

    const second = await seedFollows({
      plan, db, ledger, config, now
    });
    expect(second).toBe(0);
  });

  it('produces an identical dataset from an empty database twice over', async () => {
    const run = async () => {
      const { plan, postIndex } = buildFixture();
      const db = createFakeDb();
      const ledger = createFakeLedger();
      await seedPostEngagement({
        plan, postIndex, db, ledger, config, now
      });
      // Compare the content, not the generated ids: what must be stable is who
      // interacted with what, when, and saying what.
      const shape = (rows: Map<string, any>) => [...rows.values()]
        .map((d) => JSON.stringify({
          content: d.content ?? null,
          action: d.action ?? null,
          objectType: d.objectType,
          createdBy: d.createdBy,
          createdAt: d.createdAt
        }))
        .sort();
      return { reactions: shape(db.store.reactions), comments: shape(db.store.comments) };
    };

    expect(await run()).toEqual(await run());
  });

  it('mentions the post author and puts the handle in the text', async () => {
    const { plan, postIndex } = buildFixture();
    const db = createFakeDb();
    const ledger = createFakeLedger();
    await seedPostEngagement({
      plan, postIndex, db, ledger, config, now
    });

    const authorByPost = new Map(postIndex.map((p) => [p.postId, p]));
    const mentions = [...db.store.comments.values()].filter((c: any) => c.mentionedUserIds?.length);
    expect(mentions.length).toBeGreaterThan(0);
    for (const comment of mentions) {
      const post = authorByPost.get(comment.objectId);
      expect(comment.mentionedUserIds[0]).toBe(post!.userId);
      // A mention notification points at a comment; the handle has to be
      // visible in that comment or the notification leads nowhere legible.
      expect(comment.content.startsWith(`@${post!.username} `)).toBe(true);
      // And never a self-mention: the commenter is not the author.
      expect(comment.createdBy).not.toBe(post!.userId);
    }
  });

  it('likes comments without letting the commenter like their own', async () => {
    const { plan, postIndex } = buildFixture();
    const db = createFakeDb();
    const ledger = createFakeLedger();
    await seedPostEngagement({
      plan, postIndex, db, ledger, config, now
    });

    const commentAuthor = new Map(
      [...db.store.comments.values()].map((c: any) => [String(c._id), c.createdBy])
    );
    const commentLikes = [...db.store.reactions.values()]
      .filter((r: any) => r.objectType === 'comment' && r.action === 'like');
    expect(commentLikes.length).toBeGreaterThan(0);
    for (const like of commentLikes) {
      expect(like.createdBy).not.toBe(commentAuthor.get(String(like.objectId)));
    }
  });

  it('never lets an account interact with its own post', async () => {
    const { plan, postIndex } = buildFixture();
    const db = createFakeDb();
    const ledger = createFakeLedger();
    await seedPostEngagement({
      plan, postIndex, db, ledger, config, now
    });

    const authorByPost = new Map(postIndex.map((p) => [p.postId, p.userId]));
    for (const reaction of db.store.reactions.values()) {
      if (reaction.objectType !== 'post') continue;
      expect(reaction.createdBy).not.toBe(authorByPost.get(reaction.objectId));
    }
  });

  it('never records an interaction before the post was published', async () => {
    const { plan, postIndex } = buildFixture();
    const db = createFakeDb();
    const ledger = createFakeLedger();
    await seedPostEngagement({
      plan, postIndex, db, ledger, config, now
    });

    const publishedAt = new Map(postIndex.map((p) => [p.postId, p.publishedAt.getTime()]));
    for (const reaction of db.store.reactions.values()) {
      if (reaction.objectType !== 'post') continue;
      expect(reaction.createdAt.getTime()).toBeGreaterThanOrEqual(publishedAt.get(reaction.objectId)!);
      expect(reaction.createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });
});

describe('demo seeded randomness', () => {
  it('is reproducible from the same seed and different across seeds', () => {
    const draw = (seed: string) => {
      const random = createRandom(seed);
      return [random.next(), random.int(0, 100), random.chance(0.5), random.pick([1, 2, 3, 4, 5])];
    };

    expect(draw('post:alpha:0')).toEqual(draw('post:alpha:0'));
    expect(draw('post:alpha:0')).not.toEqual(draw('post:alpha:1'));
  });

  it('shuffles without dropping or duplicating elements', () => {
    const source = Array.from({ length: 40 }, (_, i) => i);
    const shuffled = createRandom('shuffle').shuffle(source);
    expect(shuffled).toHaveLength(source.length);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(source);
  });

  it('samples distinct elements and never more than the pool holds', () => {
    const random = createRandom('sample');
    const sample = random.sample([1, 2, 3], 10);
    expect(new Set(sample).size).toBe(sample.length);
    expect(sample).toHaveLength(3);
  });
});
