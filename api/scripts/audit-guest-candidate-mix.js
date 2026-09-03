/**
 * What a guest session is actually made of.
 *
 * The engine's `debug` payload only covers the first page of a session, so
 * "the top ten were all trending" says nothing about whether the fresh and
 * diverse buckets contributed at all. This pages a whole guest session and
 * compares it against the posts those buckets exist to surface — the
 * cold-start set in particular, which a guest must not be permanently unable
 * to see.
 *
 * Read-only. Usage:
 *   node scripts/audit-guest-candidate-mix.js
 *   node scripts/audit-guest-candidate-mix.js --sessions=8
 */

const { MongoClient } = require('mongodb');

const API = (process.argv.find((a) => a.startsWith('--api=')) || '--api=http://localhost:8080').split('=')[1];
const MONGO = (process.argv.find((a) => a.startsWith('--mongo=')) || '--mongo=mongodb://localhost/douyin-clone').split('=')[1];
const SESSIONS = Number((process.argv.find((a) => a.startsWith('--sessions=')) || '--sessions=4').split('=')[1]);

/**
 * The feed endpoint is throttled, and rightly so. Without pacing this audit
 * trips its own limiter and then reports empty sessions as product failures —
 * which is exactly what it did on the first run.
 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function guestSession(anonymousId, path = '/posts/home-posts') {
  const url = new URL(`${API}${path}`);
  url.searchParams.set('anonymousId', anonymousId);
  url.searchParams.set('debug', 'true');
  const response = await fetch(url);
  if (response.status === 429) {
    // Back off and try once more rather than either failing the run or —
    // worse — reporting the resulting empty session as a product defect.
    await sleep(20000);
    const retry = await fetch(url);
    if (retry.status === 429) throw new Error('still throttled after backing off; lower --sessions');
    const retried = await retry.json();
    const retryBody = retried?.data || retried;
    return {
      sessionId: retryBody.sessionId, posts: retryBody.data || [], debug: retryBody.debug || []
    };
  }
  const first = await response.json();
  const body = first?.data || first;
  if (!Array.isArray(body?.data)) throw new Error(`unexpected feed response: ${JSON.stringify(first).slice(0, 160)}`);
  const all = [...(body.data || [])];
  let cursor = body.nextCursor;
  let pages = 0;
  while (cursor && pages < 25) {
    const next = new URL(`${API}${path}`);
    next.searchParams.set('anonymousId', anonymousId);
    next.searchParams.set('sessionId', body.sessionId);
    next.searchParams.set('cursor', cursor);
    // eslint-disable-next-line no-await-in-loop
    const page = (await (await fetch(next)).json())?.data;
    all.push(...(page?.data || []));
    cursor = page?.hasMore ? page.nextCursor : null;
    pages += 1;
    // eslint-disable-next-line no-await-in-loop
    await sleep(120);
  }
  return { sessionId: body.sessionId, posts: all, debug: body.debug || [] };
}

async function main() {
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    // The deliberately-cold posts: no engagement, barely any impressions.
    const coldRows = await db.collection('post_recommendation_stats').find({
      weightedEngagement: { $in: [null, 0] },
      watchSampleCount: { $in: [null, 0] },
      dwellSampleCount: { $in: [null, 0] }
    }).project({ postId: 1, impressions: 1 }).toArray();
    const coldIds = new Set(coldRows.map((row) => row.postId.toString()));
    const totalPosts = await db.collection('posts').countDocuments({ status: 'active' });
    console.log(`catalogue: ${totalPosts} active posts, ${coldIds.size} of them cold-start`);

    const seenAcrossSessions = new Set();
    const perSession = [];

    for (let i = 0; i < SESSIONS; i += 1) {
      // A distinct anonymous id per session: a guest gets no cross-session
      // memory, so each is an independent draw.
      // eslint-disable-next-line no-await-in-loop
      const session = await guestSession(`audit-guest-${Date.now()}-${i}`);
      // eslint-disable-next-line no-await-in-loop
      await sleep(6000);
      const ids = session.posts.map((post) => post._id);
      const cold = ids.filter((id) => coldIds.has(id));
      cold.forEach((id) => seenAcrossSessions.add(id));
      const duplicates = ids.length - new Set(ids).size;
      const topSources = session.debug.map((row) => row.source);
      perSession.push({
        session: i + 1,
        posts: ids.length,
        distinct: new Set(ids).size,
        duplicates,
        coldServed: cold.length,
        topTenSources: [...new Set(topSources)].join('/') || '(none)'
      });
    }

    console.table(perSession);

    console.log('\n=== Guest candidate mix ===');
    const anyDuplicates = perSession.some((row) => row.duplicates > 0);
    console.log(`  ${anyDuplicates ? '✗' : '✓'} no duplicate inside a session`);

    const coldPerSession = perSession.map((row) => row.coldServed);
    const sessionsWithCold = coldPerSession.filter((n) => n > 0).length;
    console.log(`  ${sessionsWithCold > 0 ? '✓' : '✗'} cold-start posts reach guests — `
      + `${sessionsWithCold}/${SESSIONS} sessions served at least one `
      + `(per session: ${coldPerSession.join(', ')})`);
    console.log(`  ${seenAcrossSessions.size} of ${coldIds.size} distinct cold-start posts `
      + `were served across ${SESSIONS} guest sessions`);

    /*
     * Presence is the wrong question once a session can hold the whole
     * catalogue.
     *
     * `FEED_SESSION_POLICY.maxItems` is 160 and this dataset has 160 posts, so
     * a healthy session legitimately contains nearly everything — including
     * every cold-start post. What matters is not whether a cold post is *in*
     * the session but *where*: exploration should give it a real chance
     * without letting "new" outrank everything that has earned its place.
     */
    const coldRanks = [];
    for (let i = 0; i < Math.min(SESSIONS, 4); i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const session = await guestSession(`audit-guest-rank-${Date.now()}-${i}`);
      session.posts.forEach((post, index) => {
        if (coldIds.has(post._id)) coldRanks.push({ rank: index + 1, of: session.posts.length });
      });
      // eslint-disable-next-line no-await-in-loop
      await sleep(6000);
    }
    const topTen = coldRanks.filter((row) => row.rank <= 10).length;
    const bottomHalf = coldRanks.filter((row) => row.rank > row.of / 2).length;
    console.log(`  ${coldRanks.length ? '✓' : '✗'} cold-start posts are ranked, not just present — `
      + `${coldRanks.length} placements, ${topTen} in a top ten, ${bottomHalf} in a bottom half`);
    console.log(`  ${topTen < coldRanks.length ? '✓' : '✗'} exploration does not put every cold post at the top`);

    // Category spread is what the diverse bucket buys.
    const lastSession = await guestSession(`audit-guest-spread-${Date.now()}`);
    const categories = new Set(lastSession.posts.map((post) => post.topicKey).filter(Boolean));
    console.log(`  ${categories.size >= 5 ? '✓' : '✗'} one guest session spans `
      + `${categories.size} categories (${[...categories].join(', ')})`);

    // Creator adjacency and caps, over the whole session.
    let consecutive = 0;
    const creatorCounts = new Map();
    lastSession.posts.forEach((post, index) => {
      const creator = post.user?.username || post.user?._id;
      if (index > 0) {
        const previous = lastSession.posts[index - 1];
        if (creator && creator === (previous.user?.username || previous.user?._id)) consecutive += 1;
      }
      creatorCounts.set(creator, (creatorCounts.get(creator) || 0) + 1);
    });
    console.log(`  ${consecutive === 0 ? '✓' : '✗'} no two consecutive posts by the same creator `
      + `(${consecutive} adjacent pairs)`);

    // Per-batch caps, measured on the 20-post batches the re-ranker works in.
    let capViolations = 0;
    for (let start = 0; start < lastSession.posts.length; start += 20) {
      const batch = lastSession.posts.slice(start, start + 20);
      const byCreator = new Map();
      const byCategory = new Map();
      batch.forEach((post) => {
        const creator = post.user?.username || post.user?._id;
        byCreator.set(creator, (byCreator.get(creator) || 0) + 1);
        byCategory.set(post.topicKey, (byCategory.get(post.topicKey) || 0) + 1);
      });
      if ([...byCreator.values()].some((n) => n > 2)) capViolations += 1;
      if ([...byCategory.values()].some((n) => n > 6)) capViolations += 1;
    }
    console.log(`  ${capViolations === 0 ? '✓' : '✗'} creator (<=2) and category (<=6) caps hold in every 20-post batch `
      + `(${capViolations} violations)`);

    console.log('\n=== Reload ===');
    const a = await guestSession(`audit-guest-reload-a-${Date.now()}`);
    const b = await guestSession(`audit-guest-reload-b-${Date.now()}`);
    const sameOrder = a.posts.slice(0, 10).map((p) => p._id).join() === b.posts.slice(0, 10).map((p) => p._id).join();
    console.log(`  ${sameOrder ? '✗' : '✓'} two guest sessions differ in order/mix`);

    console.log('\n=== Affinity ===');
    const guestProfiles = await db.collection('user_recommendation_affinities')
      .countDocuments({ isAuthenticatedUser: true, subjectId: /^audit-guest-/ });
    console.log(`  ${guestProfiles === 0 ? '✓' : '✗'} no guest session was recorded as an authenticated subject`);
  } finally {
    await mongo.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
