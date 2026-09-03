/**
 * Indexes for the Home/For You recommendation engine.
 *
 * `autoIndex` (Mongoose) would eventually create most of these on a fresh
 * database, but per rules/api.md this repo ships index creation explicitly
 * through migrations rather than assuming boot reconciled them — and two of
 * these (`idx_status_isCreatorDeleted_recoShuffleKey`,
 * `idx_status_isCreatorDeleted_topicKey_createdAt_desc`) are new query
 * patterns on the existing, large `posts` collection where an unindexed
 * window during a slow background `autoIndex` build is worth avoiding.
 *
 * Every index name and option here matches the corresponding `@Schema`/
 * `.index()` declaration exactly, so a database that already has these
 * (created by `autoIndex` before this migration ever ran) sees `createIndex`
 * as a no-op rather than a conflict.
 */
const { DB, COLLECTION } = require('./lib');

module.exports.up = async function up(next) {
  try {
    const posts = DB.collection(COLLECTION.POST);
    await posts.createIndex(
      { status: 1, isCreatorDeleted: 1, recoShuffleKey: 1 },
      { name: 'idx_status_isCreatorDeleted_recoShuffleKey' }
    );
    await posts.createIndex(
      { status: 1, isCreatorDeleted: 1, topicKey: 1, createdAt: -1 },
      { name: 'idx_status_isCreatorDeleted_topicKey_createdAt_desc' }
    );

    const stats = DB.collection(COLLECTION.POST_RECOMMENDATION_STAT);
    await stats.createIndex({ postId: 1 }, { name: 'uq_post_recommendation_stat_post', unique: true });
    await stats.createIndex({ topicKey: 1, impressions: 1 }, { name: 'idx_post_recommendation_stat_topic' });
    await stats.createIndex({ creatorId: 1, impressions: 1 }, { name: 'idx_post_recommendation_stat_creator' });

    const affinities = DB.collection(COLLECTION.USER_RECOMMENDATION_AFFINITY);
    await affinities.createIndex({ subjectId: 1 }, { name: 'uq_user_recommendation_affinity_subject', unique: true });

    const events = DB.collection(COLLECTION.RECOMMENDATION_EVENT);
    await events.createIndex({ expiresAt: 1 }, { name: 'ttl_recommendation_event', expireAfterSeconds: 0 });
    await events.createIndex({ sessionId: 1, postId: 1, eventType: 1 }, { name: 'idx_recommendation_event_session_post' });
    await events.createIndex(
      { dedupeKey: 1 },
      {
        name: 'uq_recommendation_event_dedupe',
        unique: true,
        partialFilterExpression: { dedupeKey: { $type: 'string' } }
      }
    );

    const priors = DB.collection(COLLECTION.RECOMMENDATION_CATEGORY_PRIOR);
    await priors.createIndex({ key: 1 }, { name: 'uq_recommendation_category_prior_key', unique: true });

    console.log('  Recommendation engine indexes ensured on posts, post_recommendation_stats, user_recommendation_affinities, recommendation_events, recommendation_category_priors');
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports.down = function down(next) {
  // Deliberately empty: dropping these indexes would only reintroduce the
  // full-collection-scan behavior they exist to prevent, with no compensating
  // benefit — there is no prior schema state to restore.
  next();
};
