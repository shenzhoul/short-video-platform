#!/usr/bin/env node
/**
 * `yarn demo:clean` — remove everything the demo seed created, and nothing else.
 *
 * ## The safety rule
 *
 * Deletion is driven **entirely** by the ledger. Every id removed here was
 * recorded by `demo:seed` at the moment it created the corresponding row. The
 * script never matches on a shape, a username prefix, a metadata flag or an
 * ownership relation — all of which can be true of data this tool did not
 * create, and all of which would eventually delete somebody's real content.
 *
 * The one consequence worth stating plainly: **a comment a real user left on a
 * demo post is not in the ledger, so it is not deleted.** That is deliberate. It
 * is their content. The post underneath it is removed and the orphaned comment
 * is reported in the summary so a human can decide, which is the correct place
 * for that decision.
 *
 * ## Order
 *
 * Interactions, then posts and media, then accounts, then files, then the ledger
 * rows themselves — each step leaving the database in a state the next step can
 * still be resumed from. The ledger is cleared last, so an interruption anywhere
 * means re-running finishes the job rather than stranding rows nothing can name.
 *
 * `--dry-run` prints the plan and changes nothing. It is the default posture for
 * anything destructive in this repo, and it is worth using the first time.
 */

const config = require('./demo.config');
const logger = require('./lib/logger');
const env = require('./lib/env');
const dbLib = require('./lib/db');
const { createLedger, KINDS } = require('./lib/ledger');
const { createFilePipeline } = require('./lib/file-pipeline');
const { reconcileTags } = require('./lib/reconcile');
const { guardClean } = require('./lib/production-guard');

const hasFlag = (name) => process.argv.slice(2).includes(name);

async function main() {
  let dryRun = hasFlag('--dry-run');
  const purge = hasFlag('--purge');
  const confirmProduction = hasFlag('--confirm-production');

  const connections = env.loadSeedConnections();

  /*
   * Decided before the step banner is printed, because the banner has to state
   * what is actually about to happen. On a production target with no explicit
   * confirmation this downgrades the run to a dry run rather than refusing it:
   * the mistyped command then prints the deletion plan, which is both harmless
   * and the thing the operator wanted to see anyway.
   */
  const guard = guardClean(connections.mongoUri, { dryRun, confirmProduction });
  if (!guard.allowed) {
    logger.error(guard.message);
    process.exitCode = 1;
    return;
  }
  if (guard.forceDryRun) dryRun = true;
  if (guard.message) logger.info(guard.message);

  logger.step(`Demo clean${dryRun ? ' (dry run — nothing will be deleted)' : ''}`);
  const db = await dbLib.connect(connections.mongoUri);
  const pipeline = createFilePipeline({
    baseUrl: connections.fileServerBaseUrl,
    apiKey: connections.fileServerApiKey,
    internalApiKey: connections.internalApiKey
  });

  try {
    const ledger = createLedger(db.ledger, config.seed.namespace);
    const counts = await ledger.counts();
    const total = Object.values(counts).reduce((n, v) => n + v, 0);

    if (total === 0) {
      logger.info('Nothing to clean: the demo ledger is empty.');
      return;
    }

    logger.step('The ledger records');
    for (const [kind, n] of Object.entries(counts).sort()) logger.detail(`${kind}: ${n}`);

    const userIds = await ledger.idsOf(KINDS.USER);
    const postIds = await ledger.idsOf(KINDS.POST);
    const commentIds = await ledger.idsOf(KINDS.COMMENT);
    const reactionIds = await ledger.idsOf(KINDS.REACTION);
    const postMediaIds = await ledger.idsOf(KINDS.POST_MEDIA);
    const authIds = await ledger.idsOf(KINDS.AUTH);
    const notificationIds = await ledger.idsOf(KINDS.NOTIFICATION);
    const messageIds = await ledger.idsOf(KINDS.MESSAGE);
    const participantIds = await ledger.idsOf(KINDS.CONVERSATION_PARTICIPANT);
    const conversationIds = await ledger.idsOf(KINDS.CONVERSATION);
    const relationshipIds = await ledger.idsOf(KINDS.RELATIONSHIP);
    const categoryIds = await ledger.idsOf(KINDS.CATEGORY);
    const recommendationEventIds = await ledger.idsOf(KINDS.RECOMMENDATION_EVENT);
    const fileIds = (await ledger.all(KINDS.FILE)).map((row) => String(row.refId));

    // The tags the demo posts carried, read before the posts are deleted —
    // afterwards there is nothing left to read them from.
    const tagRows = await db.posts.find(
      { _id: { $in: postIds } }, { projection: { tags: 1 } }
    ).toArray();
    const tags = [...new Set(tagRows.flatMap((p) => p.tags || []))];

    // Content this tool did NOT create, sitting on posts it did. Reported, never
    // deleted: a real person's comment is theirs.
    const foreignComments = await db.comments.countDocuments({
      objectId: { $in: postIds },
      objectType: 'post',
      _id: { $nin: commentIds }
    });
    const foreignReactions = await db.reactions.countDocuments({
      objectId: { $in: postIds },
      objectType: 'post',
      _id: { $nin: reactionIds }
    });

    // A category this tool created may only be removed if nothing outside the
    // demo dataset points at it. A real post filed under a demo-created category
    // makes that category real data now, whoever created it.
    const categoryConflicts = [];
    if (categoryIds.length > 0) {
      const rows = await db.categories.find(
        { _id: { $in: categoryIds } }, { projection: { key: 1 } }
      ).toArray();
      for (const category of rows) {
        const foreignPosts = await db.posts.countDocuments({
          topicKey: category.key, _id: { $nin: postIds }
        });
        if (foreignPosts > 0) categoryConflicts.push({ key: category.key, posts: foreignPosts });
      }
    }

    if (dryRun) {
      logger.step('Would delete');
      logger.detail(`${notificationIds.length} notifications`);
      logger.detail(`${messageIds.length} messages, ${participantIds.length} participant rows, ${conversationIds.length} conversations`);
      logger.detail(`${relationshipIds.length} block/restrict rows`);
      logger.detail(`${reactionIds.length} reactions, ${commentIds.length} comments`);
      logger.detail(`${recommendationEventIds.length} recommendation events, plus the stats and affinities they built`);
      logger.detail(`${postMediaIds.length} post_media rows, ${postIds.length} posts`);
      logger.detail(`${userIds.length} users, ${authIds.length} auth records`);
      logger.detail(`${categoryIds.length - categoryConflicts.length} of ${categoryIds.length} seed-created categories`);
      logger.detail(`${fileIds.length} files (via the file server API)`);
      logger.detail(`then rebuild ${tags.length} tag summaries`);
      if (foreignComments || foreignReactions) {
        logger.warn(`${foreignComments} comment(s) and ${foreignReactions} reaction(s) on demo posts were NOT created by the seed and would be left in place`);
      }
      for (const conflict of categoryConflicts) {
        logger.warn(`category '${conflict.key}' was created by the seed but ${conflict.posts} non-demo post(s) now use it — it would be KEPT`);
      }
      logger.info('\nRe-run without --dry-run to apply.');
      return;
    }

    // Notifications and messages first: they point at posts, comments and users,
    // so removing them first means no interruption can leave one referring to a
    // row that is already gone.
    logger.step('Deleting notifications and messages');
    const notifications = await deleteByIds(db.collection('notifications'), notificationIds);
    const messages = await deleteByIds(db.collection('messages'), messageIds);
    const participants = await deleteByIds(db.collection('conversation_participants'), participantIds);
    const conversations = await deleteByIds(db.collection('conversations'), conversationIds);
    const relationships = await deleteByIds(db.collection('user_relationships'), relationshipIds);
    logger.ok(`${notifications} notifications, ${messages} messages, ${participants} participant rows, `
      + `${conversations} conversations, ${relationships} block/restrict rows`);

    logger.step('Deleting interactions');
    const reactions = await deleteByIds(db.reactions, reactionIds);
    const comments = await deleteByIds(db.comments, commentIds);
    logger.ok(`${reactions} reactions, ${comments} comments`);

    /*
     * Recommendation histories. The raw events are ledger-tracked and deleted
     * by id like everything else; the stats and affinities they built are not
     * separately claimed, because they are *derived* rows rather than rows the
     * seed owns — a `post_recommendation_stats` document is one counter per
     * post that real traffic also writes to.
     *
     * They are removed by scope instead: stats for demo posts, and affinities
     * whose subject is a demo account. Both are safe because a demo post and a
     * demo account are about to cease existing, so a counter about them is
     * meaningless — and neither query can touch a real user's row.
     */
    logger.step('Deleting recommendation histories');
    const recommendationEvents = await deleteByIds(db.recommendationEvents, recommendationEventIds);
    const recommendationStats = postIds.length
      ? (await db.postRecommendationStats.deleteMany({ postId: { $in: postIds } })).deletedCount
      : 0;
    const affinities = userIds.length
      ? (await db.userRecommendationAffinities.deleteMany({
        subjectId: { $in: userIds.map((id) => id.toString()) }
      })).deletedCount
      : 0;
    logger.ok(`${recommendationEvents} events, ${recommendationStats} post stat rows, ${affinities} affinity profiles`);

    logger.step('Deleting posts');
    const media = await deleteByIds(db.postMedia, postMediaIds);
    const posts = await deleteByIds(db.posts, postIds);
    logger.ok(`${posts} posts, ${media} post_media rows`);

    logger.step('Deleting accounts');
    const auths = await deleteByIds(db.auth, authIds);
    const users = await deleteByIds(db.users, userIds);
    logger.ok(`${users} users, ${auths} auth records`);

    // Files last, and through the file server's own API — this feature never
    // writes to a database it does not own. Deleting after the rows that
    // referenced them means a failure here leaves unreferenced files, which the
    // file server's unused-file sweeper collects, rather than rows pointing at
    // deleted bytes.
    logger.step('Deleting files');
    const health = await pipeline.ping();
    let filesDeleted = 0;
    let filesLeftBehind = [];
    if (!health.ok) {
      logger.warn(`${health.reason}`);
      logger.warn(`${fileIds.length} file(s) left in place; their ledger rows are kept so a later run can finish the job.`);
    } else {
      const result = await pipeline.deleteFiles(fileIds);
      filesDeleted = result.deleted;

      /*
       * Checked, not assumed.
       *
       * `batch-delete` reports how many records it processed, and the file
       * server removes the bytes and the record together -- so the honest test
       * that the storage is clean is that none of these ids can still be found.
       * Reporting the count alone would have said "336 files removed" whether or
       * not a single byte left the disk.
       */
      const surviving = result.remaining || [];
      for (const failure of result.errors || []) {
        logger.warn(`file ${failure.fileId}: ${failure.error}`);
      }
      if (surviving.length > 0) {
        logger.warn(`${surviving.length} file(s) still present on the file server after the delete: `
          + `${surviving.slice(0, 5).join(', ')}${surviving.length > 5 ? ', …' : ''}`);
        logger.warn('their ledger rows are kept, so a later demo:clean can finish removing them.');
        filesLeftBehind = surviving;
      } else {
        logger.ok(`${filesDeleted} files removed from the file server — verified: `
          + `0 of ${fileIds.length} still resolvable, so their stored bytes are gone too`);
      }
    }

    // Categories last, and only the ones the seed created that nothing else uses.
    if (categoryIds.length > 0) {
      logger.step('Deleting seed-created categories');
      const conflictKeys = new Set(categoryConflicts.map((c) => c.key));
      const removable = (await db.categories.find(
        { _id: { $in: categoryIds } }, { projection: { key: 1 } }
      ).toArray()).filter((c) => !conflictKeys.has(c.key)).map((c) => c._id);
      const removed = await deleteByIds(db.categories, removable);
      logger.ok(`${removed} categories removed`);
      for (const conflict of categoryConflicts) {
        logger.warn(`category '${conflict.key}' KEPT — ${conflict.posts} non-demo post(s) reference it`);
      }
    }

    logger.step('Rebuilding tag summaries');
    const tagResult = await reconcileTags(db, tags);
    logger.ok(`${tagResult.updated} updated, ${tagResult.removed} removed`);

    logger.step('Clearing the ledger');
    for (const kind of [
      KINDS.NOTIFICATION,
      KINDS.MESSAGE,
      KINDS.CONVERSATION_PARTICIPANT,
      KINDS.CONVERSATION,
      KINDS.RELATIONSHIP,
      KINDS.RECOMMENDATION_EVENT,
      KINDS.REACTION,
      KINDS.COMMENT,
      KINDS.POST_MEDIA,
      KINDS.POST,
      KINDS.AUTH,
      KINDS.USER
    ]) {
      await ledger.removeKind(kind);
    }
    // A category kept because real data references it keeps its ledger row too,
    // so a later run still knows the seed created it and can retry.
    if (categoryConflicts.length === 0) await ledger.removeKind(KINDS.CATEGORY);
    /*
     * File rows survive a file server that was down, so the deletion can be
     * retried. They also survive a delete that reported success while the file
     * was still resolvable afterwards -- dropping the row there would strand
     * the bytes with nothing left pointing at them, which is the one state
     * nothing can clean up.
     */
    if (health.ok && filesLeftBehind.length === 0) {
      await ledger.removeKind(KINDS.FILE);
      logger.ok('ledger cleared');
    } else if (health.ok) {
      logger.warn(`ledger cleared except ${filesLeftBehind.length} file row(s), kept so the next `
        + 'demo:clean retries removing bytes that survived this one.');
    } else {
      logger.ok('ledger cleared (file rows kept: the file server was unreachable)');
    }

    if (purge && health.ok) {
      await db.ledger.drop().catch(() => {});
      logger.ok('demo_seed_ledger collection dropped (--purge)');
    }

    if (foreignComments || foreignReactions) {
      logger.step('Left in place, on purpose');
      logger.warn(`${foreignComments} comment(s) and ${foreignReactions} reaction(s) on demo posts were not created by this tool.`);
      logger.detail('They belong to whoever wrote them. Review them by hand if you want them gone.');
    }

    logger.info('\nDemo data removed. The media cache in demo/media is untouched — yarn demo:seed rebuilds from it without re-downloading.');
  } finally {
    await db.close();
  }
}

async function deleteByIds(collection, ids) {
  if (ids.length === 0) return 0;
  let deleted = 0;
  // Chunked so a very large dataset does not build one enormous $in.
  for (let i = 0; i < ids.length; i += 500) {
    const result = await collection.deleteMany({ _id: { $in: ids.slice(i, i + 500) } });
    deleted += result.deletedCount;
  }
  return deleted;
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
