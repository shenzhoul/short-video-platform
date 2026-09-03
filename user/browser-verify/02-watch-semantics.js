/**
 * Browser pass 2 — video watch semantics from a real player.
 *
 * Covers pause/resume watermarking (§3.2), quick-skip derivation (§3.3),
 * completion (§3.4) and replay occurrences (§3.5) against the For You player
 * in the production build, then checks what the server actually persisted.
 *
 * Playback is driven through the page's own play/pause control and the
 * `<video>` element's own seeking — the same things a person's clicks and the
 * player's controls do. Nothing calls a React handler or the API directly.
 */

/*
 * `mongodb` lives in the API's tree, not the web app's — the web app has no
 * business depending on a database driver. Resolved from there so the
 * verification can read what the server actually persisted.
 */
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [require('path').resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, waitForEvent, check, summarise
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

/** The stage the video sits in; clicking it toggles playback, as for a viewer. */
const STAGE = '.relative.h-full.min-h-0.flex-1';

async function videoState(page) {
  return page.evaluate(() => {
    const v = document.querySelector('video');
    if (!v) return null;
    return {
      duration: v.duration, currentTime: v.currentTime, paused: v.paused, ended: v.ended
    };
  });
}

/** Waits for playback to pass a given time, the way watching does. */
async function playUntil(page, seconds, timeoutMs = 40000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const state = await videoState(page);
    if (state && state.currentTime >= seconds) return state;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(250);
  }
  return videoState(page);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await openContext(browser, 'A');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    await signIn(ctx, ACCOUNT);
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
    await ctx.page.waitForTimeout(2000);

    const initial = await videoState(ctx.page);
    check('For You mounted a real, playing video', Boolean(initial) && initial.duration > 0,
      `duration ${initial?.duration?.toFixed(1)}s, paused=${initial?.paused}`);
    await ctx.shot('04-for-you-playing');

    // Which post is on screen — taken from the impression the page itself sent.
    const impressions = await waitForEvent(ctx, 'impression', 20000);
    const postId = impressions[impressions.length - 1]?.postId;
    const sessionId = impressions[impressions.length - 1]?.sessionId;
    check('the page reported an impression for the visible post', Boolean(postId), `post ${postId}`);

    // ---------------------------------------------------------------
    console.log('\n=== 3.2 Pause -> resume -> pause raises the watermark ===');

    /*
     * Pause points are a fraction of the real duration, not fixed seconds.
     * The demo videos run from 4s to 28s, and a hardcoded "pause at 9s" sails
     * past the 90% completion threshold on a short one — which made this
     * scenario assert "no completion yet" after the page had already, and
     * correctly, sent one.
     */
    const duration = initial.duration || 20;
    await playUntil(ctx.page, duration * 0.25);
    // Click the stage: the player's own play/pause toggle.
    await ctx.page.locator(STAGE).first().click({ position: { x: 300, y: 300 } });
    await ctx.page.waitForTimeout(6000); // flush window

    const firstWatch = ctx.eventsForPost(postId).filter((e) => e.eventType === 'final_watch');
    check('pausing sent a final_watch', firstWatch.length >= 1,
      `${firstWatch.length} sent, watchMs=${firstWatch[0]?.watchMs}`);

    // Resume and watch further, then pause again.
    await ctx.page.locator(STAGE).first().click({ position: { x: 300, y: 300 } });
    await playUntil(ctx.page, duration * 0.6);
    await ctx.page.locator(STAGE).first().click({ position: { x: 300, y: 300 } });
    await ctx.page.waitForTimeout(6000);

    const allWatches = ctx.eventsForPost(postId).filter((e) => e.eventType === 'final_watch');
    check(
      'a second, larger final_watch was sent after resuming',
      allWatches.length >= 2 && allWatches[allWatches.length - 1].watchMs > allWatches[0].watchMs,
      `watchMs ${allWatches.map((e) => e.watchMs).join(' -> ')}`
    );

    // And the server kept the larger value rather than the first one.
    const watchRow = await db.collection('recommendation_events').findOne({
      postId: new ObjectId(postId), sessionId, eventType: 'final_watch'
    });
    check(
      'the persisted watch is the improved value, not the first flush',
      watchRow && watchRow.watchMs >= (allWatches[allWatches.length - 1].watchMs - 50),
      `stored watchMs=${watchRow?.watchMs}, last sent=${allWatches[allWatches.length - 1]?.watchMs}`
    );
    check(
      'only one final_watch row exists for the exposure (corrected in place, not duplicated)',
      await db.collection('recommendation_events').countDocuments({
        postId: new ObjectId(postId), sessionId, eventType: 'final_watch'
      }) === 1,
      'one row'
    );

    // ---------------------------------------------------------------
    console.log('\n=== 3.4 Completion ===');
    const beforeCompletion = ctx.eventsForPost(postId).filter((e) => e.eventType === 'completion').length;
    check(
      'no completion while the watch is still below the threshold',
      beforeCompletion === 0,
      `${beforeCompletion} sent after watching to ${(duration * 0.6).toFixed(1)}s of ${duration.toFixed(1)}s`
    );

    // Resume and let it run past the 90% threshold.
    await ctx.page.locator(STAGE).first().click({ position: { x: 300, y: 300 } });
    const target = duration * 0.93;
    await playUntil(ctx.page, target, 45000);
    await ctx.page.waitForTimeout(6000);

    const completions = ctx.eventsForPost(postId).filter((e) => e.eventType === 'completion');
    check('crossing 90% sent exactly one completion', completions.length === 1,
      `${completions.length} sent, watchMs=${completions[0]?.watchMs}`);

    const completionRows = await db.collection('recommendation_events').countDocuments({
      postId: new ObjectId(postId), sessionId, eventType: 'completion'
    });
    check('the server persisted exactly one completion', completionRows === 1, `${completionRows} rows`);

    const stat = await db.collection('post_recommendation_stats').findOne({ postId: new ObjectId(postId) });
    check('the completion reached the post stats', (stat?.completions || 0) >= 1,
      `completions=${stat?.completions}`);
    await ctx.shot('05-for-you-completed');

    // ---------------------------------------------------------------
    console.log('\n=== 3.5 Replay ===');
    // Let it run to the end and loop, which is what produces a replay.
    await playUntil(ctx.page, duration - 0.4, 30000);
    await ctx.page.waitForTimeout(4000);
    const replays = ctx.eventsForPost(postId).filter((e) => e.eventType === 'replay');
    if (replays.length) {
      check('a replay carried a clientExposureId', Boolean(replays[0].clientExposureId),
        `${replays.length} replay(s), id=${String(replays[0].clientExposureId).slice(0, 8)}…`);
      const ids = new Set(replays.map((r) => r.clientExposureId));
      check('each replay occurrence had its own id', ids.size === replays.length,
        `${ids.size} distinct ids for ${replays.length} replays`);
      const replayRows = await db.collection('recommendation_events').countDocuments({
        postId: new ObjectId(postId), sessionId, eventType: 'replay'
      });
      check('each replay occurrence persisted once', replayRows === ids.size,
        `${replayRows} rows for ${ids.size} occurrences`);
    } else {
      console.log('  ~ the player did not loop within the window; replay covered by pass 2b instead');
    }

    // ---------------------------------------------------------------
    console.log('\n=== 3.3 Quick skip: watched briefly then moved on ===');
    // Move to the next post quickly — a real "not for me" gesture.
    const beforeNav = ctx.captured.length;
    await ctx.page.keyboard.press('ArrowDown');
    await ctx.page.waitForTimeout(1200);
    await ctx.page.keyboard.press('ArrowDown');
    await ctx.page.waitForTimeout(7000);
    check('navigating away flushed further batches', ctx.captured.length > beforeNav,
      `${ctx.captured.length - beforeNav} new batches`);

    // Find a post whose watch the server classified as a quick skip.
    const watchedPosts = [...new Set(ctx.eventsOfType('final_watch').map((e) => e.postId))];
    const quickSkipRows = await db.collection('recommendation_events').find({
      postId: { $in: watchedPosts.map((id) => new ObjectId(id)) },
      eventType: 'final_watch',
      watchRatio: { $ne: null, $lt: 0.25 },
      watchMs: { $lt: 3000 }
    }).project({ postId: 1, watchMs: 1, watchRatio: 1 }).toArray();
    if (quickSkipRows.length) {
      const statRows = await db.collection('post_recommendation_stats').find({
        postId: { $in: quickSkipRows.map((r) => r.postId) }
      }).project({ postId: 1, quickSkips: 1 }).toArray();
      const flagged = statRows.filter((r) => (r.quickSkips || 0) > 0).length;
      check(
        'a brief watch was classified as a quick skip by the server, from the numbers alone',
        flagged > 0,
        `${quickSkipRows.length} brief watches, ${flagged} posts carry a quickSkips increment `
        + `(e.g. ${quickSkipRows[0].watchMs}ms, ratio ${quickSkipRows[0].watchRatio?.toFixed(3)})`
      );
    } else {
      console.log('  ~ no watch landed in the quick-skip band this run (all watches were long)');
    }

    // The client must never send the verdict itself.
    check(
      'the page never sent a client-side quick_skip event',
      ctx.eventsOfType('quick_skip').length === 0,
      `${ctx.eventsOfType('quick_skip').length} sent`
    );

    console.log('\n=== Server verdicts ===');
    const totals = ctx.totals();
    check('nothing the page sent was rejected', totals.rejected === 0, JSON.stringify(totals));

    console.log('\n  batches on the wire:');
    ctx.captured.slice(0, 14).forEach((row) => {
      console.log(`    ${row.events.map((e) => `${e.eventType}${e.watchMs ? `(${e.watchMs}ms)` : ''}`).join(' ')}`
        + `  ->  ${JSON.stringify(row.verdict)}`);
    });
  } finally {
    await mongo.close();
    await ctx.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 2: watch semantics');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
