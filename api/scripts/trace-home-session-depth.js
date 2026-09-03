/**
 * Traces one Home session end to end, through the real Nest container.
 *
 * Answers, with numbers rather than inference:
 *   - how many candidates each stage of retrieval produced
 *   - whether seen-suppression was relaxed, and what it cost
 *   - how many the weighted sampler selected
 *   - how many post ids Redis actually holds for that session
 *   - what every page returns, with its cursor, and why paging ends
 *
 * Usage:
 *   node scripts/trace-home-session-depth.js [--viewer <email>] [--limit 20]
 */

/* eslint-disable no-console */
require('dotenv').config();
const path = require('path');

const distPath = (relative) => path.join(__dirname, '..', 'dist', relative);

async function main() {
  const args = process.argv.slice(2);
  const viewerEmail = args.includes('--viewer') ? args[args.indexOf('--viewer') + 1] : null;
  const pageLimit = args.includes('--limit') ? Number(args[args.indexOf('--limit') + 1]) : 20;

  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require(distPath('app.module'));
  const { RecommendationFeedService } = require(distPath('services/content/recommendation/recommendation-feed.service'));
  const { RecommendationCandidateService } = require(distPath('services/content/recommendation/recommendation-candidate.service'));
  const { RecommendationSelectionService } = require(distPath('services/content/recommendation/recommendation-selection.service'));
  const { RecommendationSessionService } = require(distPath('services/content/recommendation/recommendation-session.service'));
  const { SESSION_OUTPUT_POLICY, RECOMMENDATION_FEED_TYPES } = require(distPath('common/constants/recommendation'));
  const { REDIS_KEYS } = require(distPath('kernel/infras/redis/redis-keys'));

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });

  try {
    const feedService = app.get(RecommendationFeedService);
    const candidateService = app.get(RecommendationCandidateService);
    const selectionService = app.get(RecommendationSelectionService);
    const sessionService = app.get(RecommendationSessionService);
    const mongoose = app.get(require('@nestjs/mongoose').getConnectionToken());
    const redis = sessionService.redisClient || app.get('default_IORedisModuleConnectionToken');

    const trace = {};

    // Instrument retrieval and selection without changing them.
    const originalRetrieve = candidateService.retrieve.bind(candidateService);
    candidateService.retrieve = async (params) => {
      const result = await originalRetrieve(params);
      trace.retrievals = trace.retrievals || [];
      trace.retrievals.push({
        suppressedIds: (params.eligibility.excludedPostIds || []).length,
        excludedCreators: (params.eligibility.excludedCreatorIds || []).length,
        poolSize: params.poolSize,
        isGuest: params.isGuest,
        perSourceRaw: Object.fromEntries([...result.bySource.entries()].map(([source, posts]) => [source, posts.length])),
        afterDedupe: result.all.length
      });
      return result;
    };

    const originalSelect = selectionService.select.bind(selectionService);
    selectionService.select = (params) => {
      const result = originalSelect(params);
      trace.selection = {
        scoredIn: params.scored.length,
        limit: params.limit,
        recentHeroesOnCooldown: (params.recentHeroIds || []).length,
        selected: result.selected.length,
        hero: result.hero ? result.hero.post._id.toString() : null
      };
      return result;
    };

    let subject = {};
    if (viewerEmail) {
      const user = await mongoose.collection('users').findOne({ email: viewerEmail });
      if (!user) throw new Error(`no such account: ${viewerEmail}`);
      subject = { viewerId: user._id.toString() };
      const affinity = await mongoose.collection('user_recommendation_affinities')
        .findOne({ subjectId: user._id.toString() });
      trace.viewer = {
        email: viewerEmail,
        id: user._id.toString(),
        recentlySeenPostIds: (affinity?.recentlySeenPostIds || []).length
      };
    } else {
      subject = { anonymousId: `trace-${Date.now()}` };
      trace.viewer = { email: 'guest', id: subject.anonymousId, recentlySeenPostIds: 0 };
    }

    const activeTotal = await mongoose.collection('posts').countDocuments({ status: 'active', isCreatorDeleted: { $ne: true } });
    const ownPosts = subject.viewerId
      ? await mongoose.collection('posts').countDocuments({ userId: new (require('mongodb').ObjectId)(subject.viewerId), status: 'active' })
      : 0;

    console.log('=== Policy ===');
    console.log(`  candidatePoolLimit        ${SESSION_OUTPUT_POLICY.candidatePoolLimit}`);
    console.log(`  homeSessionItemLimit      ${SESSION_OUTPUT_POLICY.homeSessionItemLimit}`);
    console.log(`  forYouInitialSessionLimit ${SESSION_OUTPUT_POLICY.forYouInitialSessionLimit}`);
    console.log(`  page limit used here      ${pageLimit}`);

    console.log('\n=== Corpus ===');
    console.log(`  active, non-deleted-author posts  ${activeTotal}`);
    console.log(`  viewer                            ${trace.viewer.email} (${trace.viewer.id})`);
    console.log(`  the viewer's own posts (excluded) ${ownPosts}`);
    console.log(`  recentlySeenPostIds (suppressed)  ${trace.viewer.recentlySeenPostIds}`);

    // First page creates the session.
    const first = await feedService.getFeed({
      feedType: RECOMMENDATION_FEED_TYPES.HOME, subject, limit: pageLimit
    });

    console.log('\n=== Retrieval ===');
    trace.retrievals.forEach((row, index) => {
      console.log(`  attempt ${index + 1}: suppressing ${row.suppressedIds} seen id(s), `
        + `${row.excludedCreators} blocked creator(s), poolSize=${row.poolSize}, guestMix=${row.isGuest}`);
      console.log(`    per source (raw): ${JSON.stringify(row.perSourceRaw)}`);
      console.log(`    after dedupe:     ${row.afterDedupe}`);
    });
    if (trace.retrievals.length > 1) {
      console.log(`  >> seen-suppression was RELAXED: ${trace.retrievals[0].afterDedupe} -> ${trace.retrievals[1].afterDedupe}`);
    } else {
      console.log('  >> seen-suppression was not relaxed (it was not the constraint)');
    }

    console.log('\n=== Selection ===');
    console.log(`  scored candidates            ${trace.selection.scoredIn}`);
    console.log(`  session limit requested      ${trace.selection.limit}`);
    console.log(`  leads on cooldown for this subject ${trace.selection.recentHeroesOnCooldown}`);
    console.log(`  weighted-sampled into session ${trace.selection.selected}`);
    console.log(`  lead post                    ${trace.selection.hero}`);

    const storedIds = await redis.lrange(REDIS_KEYS.recoFeedSessionItems(first.sessionId), 0, -1);
    console.log('\n=== Redis session ===');
    console.log(`  sessionId    ${first.sessionId}`);
    console.log(`  stored items ${storedIds.length}`);
    const storedPostIds = storedIds.map((raw) => JSON.parse(raw).postId);
    console.log(`  distinct     ${new Set(storedPostIds).size}`);

    console.log('\n=== Paging to exhaustion ===');
    const seen = [];
    let page = first;
    let index = 1;
    console.log(`  page ${index}: ${page.data.length} posts, hasMore=${page.hasMore}, nextCursor=${page.nextCursor}`);
    page.data.forEach((post) => seen.push(post._id.toString()));

    while (page.hasMore && page.nextCursor && index < 30) {
      index += 1;
      // eslint-disable-next-line no-await-in-loop
      page = await feedService.getFeed({
        feedType: RECOMMENDATION_FEED_TYPES.HOME,
        subject,
        sessionId: first.sessionId,
        cursor: page.nextCursor,
        limit: pageLimit
      });
      console.log(`  page ${index}: ${page.data.length} posts, hasMore=${page.hasMore}, nextCursor=${page.nextCursor}`);
      page.data.forEach((post) => seen.push(post._id.toString()));
    }

    console.log('\n=== Result ===');
    console.log(`  pages                 ${index}`);
    console.log(`  rows returned         ${seen.length}`);
    console.log(`  distinct posts        ${new Set(seen).size}`);
    console.log(`  duplicates            ${seen.length - new Set(seen).size}`);
    console.log(`  stored in Redis       ${storedIds.length}`);
    console.log(`  matches session?      ${new Set(seen).size === storedIds.length ? 'YES' : 'NO'}`);
    const missing = storedPostIds.filter((id) => !seen.includes(id));
    console.log(`  session ids never served ${missing.length}${missing.length ? ` -> ${missing.slice(0, 5).join(',')}` : ''}`);
    console.log(`  end reason            ${page.hasMore ? 'stopped at the loop guard' : 'hasMore=false (session exhausted)'}`);
  } finally {
    await app.close();
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
