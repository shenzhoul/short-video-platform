#!/usr/bin/env node
/**
 * Phase 2 — `yarn demo:seed`
 *
 * Builds the demo dataset from media that `demo:fetch-media` already downloaded.
 *
 * **This script never touches a stock provider.** It has no API key, no provider
 * module loaded, and no URL to call. Everything it needs is in the manifest and
 * the media cache. If the manifest cannot cover the configured dataset, it says
 * so and stops rather than reaching for the network.
 *
 * What it does touch: the project's MongoDB (through the driver) and the file
 * server (through its real upload pipeline). Both must be running.
 *
 * Safe to run repeatedly. Every document it creates is claimed in a ledger
 * first, so a second run finds the dataset already present and creates nothing;
 * counters are recomputed from the rows rather than incremented, so running
 * twice cannot double them.
 */

const path = require('path');

const config = require('./demo.config');
const logger = require('./lib/logger');
const env = require('./lib/env');
const manifestLib = require('./lib/manifest');
const dbLib = require('./lib/db');
const { createLedger, KINDS } = require('./lib/ledger');
const { createFilePipeline } = require('./lib/file-pipeline');
const { buildPlan } = require('./lib/plan');
const { seedAccounts } = require('./lib/seed-accounts');
const { seedPosts } = require('./lib/seed-posts');
const { seedInteractions } = require('./lib/seed-interactions');
const { seedSocial } = require('./lib/seed-social');
const { createNotificationAdapter } = require('./lib/notification-adapter');
const { createMessageAdapter } = require('./lib/message-adapter');
const { resolveAccountPlan, assertCategoryCoverage } = require('./lib/account-plan');
const { reconcileAll } = require('./lib/reconcile');

/**
 * Everything that must be true before a single document is written.
 *
 * Collected rather than thrown one at a time: a run that reports all four
 * problems is worth four runs that each report one.
 */
async function preflight({ db, pipeline, plan }) {
  const problems = [];

  const health = await pipeline.ping();
  if (!health.ok) {
    problems.push(`${health.reason}. Start it with: cd file-server && yarn start:dev`);
  }

  // `topicKey` is validated against the live catalogue, exactly as
  // PostCrudService.resolveTopicKey does. A key that is not active would be
  // rejected by the product, so seeding one would produce data the app refuses.
  const wantedTopics = [...new Set(plan.accounts.map((a) => a.topicKey))];
  const liveTopics = await db.categories
    .find({ key: { $in: wantedTopics }, status: 'active' }, { projection: { key: 1 } })
    .toArray();
  const liveKeys = new Set(liveTopics.map((c) => c.key));
  for (const key of wantedTopics) {
    if (!liveKeys.has(key)) {
      problems.push(`category '${key}' is not active in the categories collection. Run the migrations, or change topicKey in demo/themes.js.`);
    }
  }

  // Coverage in the other direction: every category the product has active must
  // have a theme, or it ends up with no demo content and nothing says so.
  const allActive = await db.categories
    .find({ status: 'active' }, { projection: { key: 1 } })
    .toArray();
  const accountPlan = resolveAccountPlan(config, config.themes);
  if (!accountPlan.ok) {
    problems.push(...accountPlan.problems);
  } else {
    const coverage = assertCategoryCoverage(accountPlan.plan, allActive.map((c) => c.key));
    for (const key of coverage.uncovered) {
      problems.push(`active category '${key}' has no theme in demo/themes.js, so it would get no demo content.`);
    }
  }

  // A username or email colliding with a real account would make the seed look
  // like it worked while silently attaching demo content to somebody else.
  const usernames = plan.accounts.map((a) => a.username);
  const emails = plan.accounts.map((a) => a.email);
  const ledgerIds = new Set((await db.ledger.find(
    { namespace: config.seed.namespace, kind: KINDS.USER },
    { projection: { refId: 1 } }
  ).toArray()).map((r) => String(r.refId)));

  const collisions = await db.users.find(
    { $or: [{ username: { $in: usernames } }, { email: { $in: emails } }] },
    { projection: { username: 1, email: 1 } }
  ).toArray();
  for (const user of collisions) {
    if (!ledgerIds.has(String(user._id))) {
      problems.push(`a non-demo account already uses username '${user.username}' / email '${user.email}'. Rename the persona in demo/themes.js.`);
    }
  }

  return problems;
}

async function main() {
  logger.step('Demo seed');

  const connections = env.loadSeedConnections();
  logger.detail(`mongo: ${connections.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);
  logger.detail(`file server: ${connections.fileServerBaseUrl}`);

  // 1. The plan, entirely from local data.
  const manifest = manifestLib.load(config.MANIFEST_PATH);
  if (manifest.entries.length === 0) {
    throw new Error(`no media manifest at ${config.MANIFEST_PATH}. Run: yarn demo:fetch-media`);
  }
  const index = manifestLib.index(manifest, config.MEDIA_DIR);
  const planned = buildPlan({ config, themes: config.themes, index });
  if (!planned.ok) {
    logger.error('the media cache cannot cover the configured dataset:');
    for (const problem of planned.problems) logger.detail(`- ${problem}`);
    process.exitCode = 1;
    return;
  }
  const { plan } = planned;
  logger.ok(`planned ${plan.totals.accounts} accounts, ${plan.totals.posts} posts `
    + `(${plan.totals.photoPosts} photo, ${plan.totals.videoPosts} video)`);

  const db = await dbLib.connect(connections.mongoUri);
  const deployment = await dbLib.describeDeployment(db.db);
  logger.detail(`mongodb ${deployment.version}${deployment.isReplicaSet ? ` (replica set ${deployment.setName})` : ' (standalone — no transactions used)'}`);

  const pipeline = createFilePipeline({
    baseUrl: connections.fileServerBaseUrl,
    apiKey: connections.fileServerApiKey,
    internalApiKey: connections.internalApiKey
  });

  try {
    logger.step('Preflight');
    const problems = await preflight({ db, pipeline, plan });
    if (problems.length > 0) {
      for (const problem of problems) logger.error(problem);
      process.exitCode = 1;
      return;
    }
    logger.ok('file server reachable, categories present, no username collisions');

    const ledger = createLedger(db.ledger, config.seed.namespace);
    await ledger.ensureIndexes();

    logger.step('Accounts');
    const accountResult = await seedAccounts({
      plan, config, db, ledger, pipeline, mediaDir: config.MEDIA_DIR, path
    });
    plan.userIds = accountResult.userIds;
    logger.ok(`${accountResult.created.users} created, ${accountResult.created.reused} already present, `
      + `${accountResult.created.images} profile images uploaded`);

    logger.step('Posts');
    logger.detail('videos are transcoded on the file server queue; this is the slow part');
    const postResult = await seedPosts({
      plan, db, ledger, pipeline, mediaDir: config.MEDIA_DIR, path
    });
    logger.ok(`${postResult.stats.created} created (${postResult.stats.photos} photo, `
      + `${postResult.stats.videos} video), ${postResult.stats.reused} already present, `
      + `${postResult.stats.uploads} files uploaded`);

    logger.step('Interactions');
    const interactions = await seedInteractions({
      plan, postIndex: postResult.postIndex, db, ledger, config
    });
    logger.ok(`${interactions.follows} follows, ${interactions.likes} likes, `
      + `${interactions.comments} comments, ${interactions.replies} replies, ${interactions.shares} shares`);

    logger.step('Notifications, conversations and messages');
    const notifications = createNotificationAdapter({ db, ledger, KINDS });
    const messagesAdapter = createMessageAdapter({ db, ledger, KINDS });
    const social = await seedSocial({
      plan, db, ledger, notifications, messages: messagesAdapter, config
    });
    logger.ok(`notifications — ${social.notifications.follow} follow, `
      + `${social.notifications.postLike} post-like, ${social.notifications.commentLike} comment-like, `
      + `${social.notifications.postComment} comment, ${social.notifications.commentReply} reply, `
      + `${social.notifications.mention} mention (${social.markedRead} marked read)`);
    logger.ok(`messaging — ${social.conversations.conversations} conversations, `
      + `${social.conversations.messages} messages, ${social.conversations.systemNotices} system notices, `
      + `${social.conversations.sharedPosts} shared posts; showcase: `
      + `${social.showcase.pending} pending, ${social.showcase.restricted} restricted, `
      + `${social.showcase.blocked} blocked`);

    logger.step('Reconciling counters');
    const userIds = await ledger.idsOf(KINDS.USER);
    const postIds = await ledger.idsOf(KINDS.POST);
    const commentIds = await ledger.idsOf(KINDS.COMMENT);
    const conversationIds = await ledger.idsOf(KINDS.CONVERSATION);
    const tags = [...new Set(plan.accounts.flatMap(
      (a) => a.posts.flatMap((p) => (p.caption.match(/#[\w]+/g) || []).map((t) => t.slice(1).toLowerCase()))
    ))];
    const tagResult = await reconcileAll({
      db, userIds, postIds, commentIds, tags, conversationIds
    });
    logger.ok(`counters recomputed; ${tagResult.updated} tag summaries updated`);

    logger.step('Summary');
    const counts = await ledger.counts();
    for (const [kind, n] of Object.entries(counts).sort()) logger.detail(`${kind}: ${n}`);
    logger.info(`\nDemo accounts can sign in with any of the seeded emails and password: ${config.seed.password}`);
    logger.info('Remove everything this created with: yarn demo:clean');
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
