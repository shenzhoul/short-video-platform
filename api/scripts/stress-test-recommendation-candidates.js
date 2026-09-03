/**
 * Recommendation-engine candidate-retrieval stress test.
 *
 * Seeds 5,000 synthetic posts (plus recommendation stats) into a dedicated
 * **throwaway** database — never the demo/dev database this repo otherwise
 * uses — builds the same indexes the app ships (mirrors
 * `1788000000000-recommendation-engine-indexes.js` and the base `posts`
 * indexes it already had), runs `explain()` against the exact query shapes
 * `RecommendationCandidateService` issues, and reports examined/returned
 * document counts, the index used, and latency. The throwaway database is
 * always dropped on exit, success or failure.
 *
 * Usage:
 *   yarn build && node scripts/stress-test-recommendation-candidates.js
 *
 * What this does NOT do: it does not spin up the full Nest application or
 * call `RecommendationCandidateService` directly (that would need the whole
 * DI graph, Redis, etc., for a query-plan question the raw driver already
 * answers). It reproduces each source's exact filter/sort/limit shape by
 * hand, cross-checked against `recommendation-candidate.service.ts`.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { performance } = require('perf_hooks');

const BASE_URI = process.env.MONGO_URI || 'mongodb://localhost/douyin-clone';
const STRESS_DB_NAME = 'douyin-clone-reco-stress-test';
const STRESS_URI = BASE_URI.replace(/\/[^/?]+(\?|$)/, `/${STRESS_DB_NAME}$1`);

const POST_COUNT = 5000;
const CATEGORY_KEYS = [
  'knowledge', 'games', 'anime', 'music', 'film', 'food', 'lifestyle',
  'sports', 'travel', 'parenting', 'animals', 'beauty', 'photography'
];
const CREATOR_COUNT = 60;

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function buildPosts(creatorIds) {
  const now = Date.now();
  const posts = [];
  for (let i = 0; i < POST_COUNT; i += 1) {
    // Mixed ages: from just-now to 90 days old, weighted toward recent.
    const ageMs = Math.random() < 0.3
      ? Math.random() * 6 * 60 * 60 * 1000 // 30% within the last 6h — "fresh" candidates
      : Math.random() * 90 * 24 * 60 * 60 * 1000;
    const createdAt = new Date(now - ageMs);
    // Mixed popularity: most low, a long tail of high performers.
    const popularityRoll = Math.random();
    const totalLike = popularityRoll > 0.98 ? Math.floor(Math.random() * 200000) : Math.floor(Math.random() * 500);
    posts.push({
      _id: new mongoose.Types.ObjectId(),
      type: Math.random() < 0.85 ? 'video' : 'photo',
      mediaTypes: [Math.random() < 0.85 ? 'video' : 'photo'],
      userId: randomChoice(creatorIds),
      title: `stress-post-${i}`,
      text: `stress test post ${i}`,
      tags: [`tag-${i % 40}`],
      topicKey: randomChoice(CATEGORY_KEYS),
      orientation: Math.random() < 0.6 ? 'portrait' : 'landscape',
      status: 'active',
      totalLike,
      totalComment: Math.floor(totalLike / 5),
      totalShare: Math.floor(totalLike / 20),
      totalView: totalLike * 3,
      createdAt,
      updatedAt: createdAt,
      isCreatorDeleted: false,
      isPinned: false,
      pinnedAt: null,
      recoShuffleKey: Math.random()
    });
  }
  return posts;
}

function buildStats(posts) {
  // ~70% of posts have been scored at least once; the rest are true
  // cold-start (no stats row at all), which is the realistic shape —
  // `PostRecommendationStat` rows are created lazily by event ingestion.
  const rows = [];
  posts.forEach((post) => {
    if (Math.random() > 0.7) return;
    const impressions = Math.random() < 0.5
      ? Math.floor(Math.random() * 20) // stage 0
      : Math.random() < 0.7
        ? 20 + Math.floor(Math.random() * 80) // stage 1
        : 100 + Math.floor(Math.random() * 5000); // stage 2
    const weightedEngagement = Math.max(0, Math.floor(impressions * (0.01 + Math.random() * 0.05)));
    rows.push({
      postId: post._id,
      creatorId: post.userId,
      topicKey: post.topicKey,
      impressions,
      watchRatioSum: Math.random() * impressions,
      watchSampleCount: impressions,
      completions: Math.floor(impressions * Math.random() * 0.3),
      replays: Math.floor(impressions * Math.random() * 0.05),
      quickSkips: Math.floor(impressions * Math.random() * 0.2),
      dwellMsSum: 0,
      dwellSampleCount: 0,
      detailOpens: Math.floor(impressions * Math.random() * 0.1),
      weightedEngagement,
      lastImpressionAt: new Date(),
      updatedAt: new Date()
    });
  });
  return rows;
}

async function ensureIndexes(db) {
  const posts = db.collection('posts');
  await posts.createIndex({ status: 1, isCreatorDeleted: 1, createdAt: -1, _id: -1 }, { name: 'idx_status_isCreatorDeleted_createdAt_id_desc' });
  await posts.createIndex({ status: 1, isCreatorDeleted: 1, recoShuffleKey: 1 }, { name: 'idx_status_isCreatorDeleted_recoShuffleKey' });
  await posts.createIndex({ status: 1, isCreatorDeleted: 1, topicKey: 1, createdAt: -1 }, { name: 'idx_status_isCreatorDeleted_topicKey_createdAt_desc' });
  await posts.createIndex({ userId: 1, status: 1, isPinned: -1, pinnedAt: -1, createdAt: -1, _id: -1 }, { name: 'idx_userId_status_pinned_createdAt_id_desc' });
  await posts.createIndex({ tags: 1 }, { name: 'idx_tags' });

  const stats = db.collection('post_recommendation_stats');
  await stats.createIndex({ postId: 1 }, { name: 'uq_post_recommendation_stat_post', unique: true });
  await stats.createIndex({ topicKey: 1, impressions: 1 }, { name: 'idx_post_recommendation_stat_topic' });
  await stats.createIndex({ creatorId: 1, impressions: 1 }, { name: 'idx_post_recommendation_stat_creator' });
}

async function timedExplain(label, cursorFactory) {
  const cursor = cursorFactory();
  const start = performance.now();
  const explanation = await cursor.explain('executionStats');
  const elapsedMs = performance.now() - start;
  const stats = explanation.executionStats;
  const winningPlan = explanation.queryPlanner.winningPlan;
  const indexUsed = JSON.stringify(winningPlan).match(/"indexName":"([^"]+)"/);
  console.log(`\n--- ${label} ---`);
  console.log(`  examined documents: ${stats.totalDocsExamined}`);
  console.log(`  returned documents: ${stats.nReturned}`);
  console.log(`  index used:         ${indexUsed ? indexUsed[1] : '(COLLSCAN — no index)'}`);
  console.log(`  latency:            ${elapsedMs.toFixed(2)} ms (explain overhead included)`);
  return {
    label, examined: stats.totalDocsExamined, returned: stats.nReturned, index: indexUsed ? indexUsed[1] : 'COLLSCAN', elapsedMs
  };
}

async function main() {
  console.log(`Connecting to throwaway database: ${STRESS_DB_NAME}`);
  await mongoose.connect(STRESS_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const results = [];
  try {
    const creatorIds = Array.from({ length: CREATOR_COUNT }, () => new mongoose.Types.ObjectId());
    console.log(`Seeding ${POST_COUNT} posts across ${CATEGORY_KEYS.length} categories and ${CREATOR_COUNT} creators...`);
    const posts = buildPosts(creatorIds);
    await db.collection('posts').insertMany(posts, { ordered: false });

    const statRows = buildStats(posts);
    if (statRows.length) await db.collection('post_recommendation_stats').insertMany(statRows, { ordered: false });
    console.log(`Seeded ${statRows.length} post_recommendation_stats rows (${posts.length - statRows.length} posts are true cold-start with no row at all).`);

    console.log('Building indexes (mirrors the shipped migration)...');
    await ensureIndexes(db);

    // 1. Trending source: eligibility + a 14-day recency window, sorted newest first.
    results.push(await timedExplain(
      'trending source (status+isCreatorDeleted+createdAt window, limit 60)',
      () => db.collection('posts').find({
        status: 'active',
        isCreatorDeleted: { $ne: true },
        createdAt: { $gte: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000) }
      }).sort({ createdAt: -1 }).limit(60)
    ));

    // 2. Fresh-time source: 72h window.
    results.push(await timedExplain(
      'fresh source, time window (72h, limit 40)',
      () => db.collection('posts').find({
        status: 'active',
        isCreatorDeleted: { $ne: true },
        createdAt: { $gte: new Date(Date.now() - 72 * 60 * 60 * 1000) }
      }).sort({ createdAt: -1 }).limit(40)
    ));

    // 3. Fresh/diverse source: shuffle-key range scan (the $sample replacement).
    const anchor = Math.random();
    results.push(await timedExplain(
      `shuffle-key sample (anchor=${anchor.toFixed(4)}, limit 90)`,
      () => db.collection('posts').find({
        status: 'active',
        isCreatorDeleted: { $ne: true },
        recoShuffleKey: { $gte: anchor }
      }).sort({ recoShuffleKey: 1 }).limit(90)
    ));

    // 4. Category-scoped (Home category tab / personalized-by-category), limit larger for oversampling.
    const sampleCategory = randomChoice(CATEGORY_KEYS);
    results.push(await timedExplain(
      `category-scoped query (topicKey="${sampleCategory}", limit 80)`,
      () => db.collection('posts').find({
        status: 'active',
        isCreatorDeleted: { $ne: true },
        topicKey: sampleCategory
      }).sort({ createdAt: -1 }).limit(80)
    ));

    // 5. Personalized-by-creator ($in over a handful of top-affinity creator ids).
    const someCreators = creatorIds.slice(0, 8);
    results.push(await timedExplain(
      'personalized-by-creator ($in over 8 creator ids, limit 40)',
      () => db.collection('posts').find({
        status: 'active',
        isCreatorDeleted: { $ne: true },
        userId: { $in: someCreators }
      }).sort({ createdAt: -1 }).limit(40)
    ));

    // 6. Stat batch-load for a candidate page (the $in the scorer issues once per page, never per-post).
    const pageOfIds = posts.slice(0, 160).map((p) => p._id);
    results.push(await timedExplain(
      'batched stat load for a 160-post candidate page ($in)',
      () => db.collection('post_recommendation_stats').find({ postId: { $in: pageOfIds } })
    ));

    console.log('\n=== Summary ===');
    console.table(results.map((r) => ({
      query: r.label, examined: r.examined, returned: r.returned, index: r.index, latencyMs: Number(r.elapsedMs.toFixed(2))
    })));

    const collscans = results.filter((r) => r.index === 'COLLSCAN');
    if (collscans.length) {
      console.error(`\nFAIL: ${collscans.length} quer(ies) fell back to a collection scan: ${collscans.map((r) => r.label).join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log('\nPASS: every query used an index — no full collection scan against the 5,000-post pool.');
    }

    const overRetrieval = results.filter((r) => r.examined > r.returned * 5 && r.returned > 0);
    if (overRetrieval.length) {
      console.warn(`\nNote: ${overRetrieval.length} quer(ies) examined notably more documents than returned (index scan breadth, not a collection scan) — see the table above.`);
    }
  } finally {
    console.log(`\nDropping throwaway database ${STRESS_DB_NAME}...`);
    await mongoose.connection.db.dropDatabase();
    await mongoose.disconnect();
    console.log('Cleanup complete. The demo/dev database was never touched.');
  }
}

main().catch((error) => {
  console.error('Stress test failed:', error);
  process.exitCode = 1;
});
