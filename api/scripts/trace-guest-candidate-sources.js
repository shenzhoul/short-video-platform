/**
 * Where a guest session's posts actually come from, source by source.
 *
 * The feed's `debug` payload reports one label per post — whichever bucket
 * *first* claimed it during dedupe — so a post that three sources all found is
 * only ever attributed to one of them. That is enough to rank a feed and not
 * nearly enough to answer "did the diverse bucket contribute anything?", which
 * is the question this answers.
 *
 * It boots the real Nest container and calls the real
 * `RecommendationCandidateService.retrieve()`, wrapping each private source
 * method to record what it returned *before* dedupe. Nothing is stubbed and no
 * query is reimplemented — a trace that reimplements the thing it is tracing
 * proves nothing about the thing.
 *
 * Read-only. Usage:
 *   node scripts/trace-guest-candidate-sources.js
 *   node scripts/trace-guest-candidate-sources.js --viewer=<userId>
 */

require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');

const VIEWER = (process.argv.find((a) => a.startsWith('--viewer=')) || '--viewer=').split('=')[1];
const SOURCES = ['personalized', 'trending', 'fresh', 'social', 'diverse'];

async function main() {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { AppModule } = require('../dist/app.module');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { RecommendationCandidateService } = require('../dist/services/content/recommendation/recommendation-candidate.service');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { RecommendationScoringService } = require('../dist/services/content/recommendation/recommendation-scoring.service');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { RecommendationDiversityService } = require('../dist/services/content/recommendation/recommendation-diversity.service');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { RecommendationSessionService } = require('../dist/services/content/recommendation/recommendation-session.service');
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const { FEED_SESSION_POLICY, CANDIDATE_QUOTAS, GUEST_CANDIDATE_QUOTAS } = require('../dist/common/constants/recommendation');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const candidates = app.get(RecommendationCandidateService);
    const scoring = app.get(RecommendationScoringService);
    const diversity = app.get(RecommendationDiversityService);
    const sessions = app.get(RecommendationSessionService);

    // Record what each source returned before `retrieve` dedupes them.
    const raw = {};
    const rawIds = {};
    const proto = Object.getPrototypeOf(candidates);
    const originals = {};
    SOURCES.forEach((name) => {
      originals[name] = proto[name];
      proto[name] = async function wrapped(...args) {
        const result = await originals[name].apply(this, args);
        raw[name] = result.length;
        rawIds[name] = new Set(result.map((p) => p._id.toString()));
        return result;
      };
    });

    const isGuest = !VIEWER;
    const sessionSeed = sessions.newSessionSeed();
    const input = {
      feedType: 'home',
      isGuest,
      eligibility: { viewerId: VIEWER || undefined, excludedCreatorIds: [], excludedPostIds: [] },
      topicKey: null,
      poolSize: FEED_SESSION_POLICY.maxItems,
      sessionSeed,
      topCategoryAffinities: [],
      topHashtagAffinities: [],
      topCreatorAffinities: [],
      followingCreatorIds: []
    };

    const quotas = isGuest
      ? {
        trending: GUEST_CANDIDATE_QUOTAS.recentPopular,
        fresh: GUEST_CANDIDATE_QUOTAS.fresh,
        diverse: GUEST_CANDIDATE_QUOTAS.categoryDiverse,
        personalized: 0,
        social: 0
      }
      : CANDIDATE_QUOTAS.home;

    console.log(`subject: ${isGuest ? 'GUEST (no affinity)' : VIEWER}`);
    console.log(`pool target: ${FEED_SESSION_POLICY.maxItems}`);
    console.log(`quotas: ${SOURCES.map((s) => `${s} ${(quotas[s] * 100).toFixed(0)}%`).join(', ')}`);

    const pool = await candidates.retrieve(input);
    SOURCES.forEach((name) => { proto[name] = originals[name]; });

    // Score and re-rank exactly as `createSession` does, so the "final" column
    // is the order a session would really store.
    const [stats, priors] = await Promise.all([
      scoring.loadStats(pool.all.map((p) => p._id.toString())),
      scoring.loadPriors(pool.all.map((p) => p.topicKey))
    ]);
    const context = {
      feedType: 'home',
      sessionSeed,
      now: new Date(),
      topCategoryAffinities: [],
      topHashtagAffinities: [],
      topCreatorAffinities: [],
      formatPreferenceScore: 0
    };
    const scored = [];
    const scoredIds = new Set();
    Array.from(pool.bySource.entries()).forEach(([source, posts]) => {
      posts.forEach((post) => {
        const id = post._id.toString();
        if (scoredIds.has(id)) return;
        scoredIds.add(id);
        scored.push(scoring.score(post, source, context, stats, priors));
      });
    });
    const ranked = diversity.rerank(scored);

    const afterDedupe = {};
    Array.from(pool.bySource.entries()).forEach(([source, posts]) => { afterDedupe[source] = posts.length; });
    const finalBySource = {};
    ranked.forEach((c) => { finalBySource[c.source] = (finalBySource[c.source] || 0) + 1; });

    console.log('\n=== Candidates by source ===');
    console.log('  source         quota   target   raw (pre-dedupe)   after dedupe   in final order');
    SOURCES.forEach((name) => {
      const target = Math.round(FEED_SESSION_POLICY.maxItems * quotas[name]);
      console.log(
        `  ${name.padEnd(14)} ${String((quotas[name] * 100).toFixed(0) + '%').padStart(5)} `
        + `${String(target).padStart(7)} ${String(raw[name] ?? 0).padStart(18)} `
        + `${String(afterDedupe[name] ?? 0).padStart(14)} ${String(finalBySource[name] ?? 0).padStart(15)}`
      );
    });
    console.log(`  ${'TOTAL'.padEnd(14)} ${''.padStart(5)} ${''.padStart(7)} `
      + `${String(SOURCES.reduce((n, s) => n + (raw[s] || 0), 0)).padStart(18)} `
      + `${String(pool.all.length).padStart(14)} ${String(ranked.length).padStart(15)}`);

    console.log('\n=== Overlap: which sources also found each post ===');
    /*
     * The number that actually settles the question. A post labelled
     * `trending` that the diverse bucket *also* returned is a diverse
     * candidate; the label only records who got there first.
     */
    const multi = { };
    let diverseAlsoFound = 0;
    let freshAlsoFound = 0;
    pool.all.forEach((post) => {
      const id = post._id.toString();
      const found = SOURCES.filter((s) => rawIds[s]?.has(id));
      multi[found.length] = (multi[found.length] || 0) + 1;
      if (found.includes('diverse')) diverseAlsoFound += 1;
      if (found.includes('fresh')) freshAlsoFound += 1;
    });
    Object.keys(multi).sort().forEach((n) => {
      console.log(`  found by ${n} source(s): ${multi[n]} post(s)`);
    });
    console.log(`  posts the diverse bucket returned at all: ${diverseAlsoFound} of ${pool.all.length}`);
    console.log(`  posts the fresh bucket returned at all:   ${freshAlsoFound} of ${pool.all.length}`);

    console.log('\n=== Category distribution of the final order ===');
    const byCategory = new Map();
    ranked.forEach((c) => {
      const k = c.post.topicKey || '(none)';
      byCategory.set(k, (byCategory.get(k) || 0) + 1);
    });
    const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`  ${sorted.length} categories: ${sorted.map(([k, v]) => `${k}=${v}`).join(' ')}`);
    const top20 = new Map();
    ranked.slice(0, 20).forEach((c) => {
      const k = c.post.topicKey || '(none)';
      top20.set(k, (top20.get(k) || 0) + 1);
    });
    console.log(`  top 20 spans ${top20.size} categories: `
      + `${[...top20.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}`);

    console.log('\n=== Verdict ===');
    const diverseRaw = raw.diverse || 0;
    const diverseFinal = finalBySource.diverse || 0;
    if (diverseRaw === 0) {
      console.log('  C — the diverse source returned nothing. That is a defect.');
      process.exitCode = 1;
    } else if (diverseFinal === 0) {
      console.log(`  A — the diverse source returned ${diverseRaw} candidates, every one of which`);
      console.log('      another source had already claimed during dedupe, so none carry the');
      console.log('      label. The quota is a *candidate* quota, not an output quota.');
    } else {
      console.log(`  the diverse source contributed ${diverseRaw} candidates before dedupe and`);
      console.log(`      ${diverseFinal} posts still labelled diverse in the final order.`);
    }
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
