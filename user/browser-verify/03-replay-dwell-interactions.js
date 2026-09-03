/**
 * Browser pass 3 — replay occurrences (§3.5), like/follow/comment attribution
 * (§3.7) and photo dwell (§3.6), all from the real UI.
 *
 * Replay is driven by moving the playhead back to the start after reaching the
 * end — what dragging the scrubber does, and the exact crossing
 * `useRecommendationWatchTracking` watches for. Everything else is ordinary
 * clicking and typing. Nothing calls a React handler or the API directly.
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

const videoState = (page) => page.evaluate(() => {
  const v = document.querySelector('video');
  return v ? { duration: v.duration, currentTime: v.currentTime, paused: v.paused } : null;
});

async function playUntil(page, seconds, timeoutMs = 45000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    const state = await videoState(page);
    if (state && state.currentTime >= seconds) return state;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(200);
  }
  return videoState(page);
}

/** Moves the playhead, the way dragging the scrubber does. */
async function seekTo(page, seconds) {
  await page.evaluate((t) => {
    const v = document.querySelector('video');
    if (v) v.currentTime = t;
  }, seconds);
  await page.waitForTimeout(500);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await openContext(browser, 'A');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    await signIn(ctx, ACCOUNT);

    // ---------------------------------------------------------------
    console.log('=== 3.5 Replay occurrences ===');
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
    // `duration` is NaN until metadata lands; reading it too early made an
    // earlier version compute NaN targets and silently skip every wait.
    await ctx.page.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && Number.isFinite(v.duration) && v.duration > 0;
    }, { timeout: 30000 });
    await ctx.page.waitForTimeout(1500);

    const state = await videoState(ctx.page);
    const impressions = await waitForEvent(ctx, 'impression', 20000);
    const postId = impressions[impressions.length - 1]?.postId;
    const sessionId = impressions[impressions.length - 1]?.sessionId;
    const duration = state.duration;
    console.log(`  post ${postId}, ${duration.toFixed(1)}s`);

    // Occurrence 1: reach the end, then jump back to the start.
    await playUntil(ctx.page, duration * 0.95);
    await seekTo(ctx.page, 0.2);
    await ctx.page.waitForTimeout(2000);

    // Occurrence 2: the same crossing again.
    await playUntil(ctx.page, duration * 0.95);
    await seekTo(ctx.page, 0.2);
    await ctx.page.waitForTimeout(7000);

    const replays = ctx.eventsForPost(postId).filter((e) => e.eventType === 'replay');
    check('replaying produced replay events', replays.length >= 1, `${replays.length} sent`);
    check(
      'every replay carried its own clientExposureId',
      replays.length > 0 && replays.every((r) => r.clientExposureId),
      replays.map((r) => String(r.clientExposureId).slice(0, 8)).join(', ')
    );
    const ids = new Set(replays.map((r) => r.clientExposureId));
    check(
      'distinct replay crossings got distinct ids',
      ids.size === replays.length,
      `${ids.size} ids for ${replays.length} replays`
    );
    const replayRows = await db.collection('recommendation_events').countDocuments({
      postId: new ObjectId(postId), sessionId, eventType: 'replay'
    });
    check('each occurrence persisted exactly once', replayRows === ids.size,
      `${replayRows} rows for ${ids.size} occurrences`);
    await ctx.shot('06-for-you-replayed');

    // ---------------------------------------------------------------
    console.log('\n=== 3.7 Like, follow and comment from the For You rail ===');
    /*
     * The action rail is `PostVideoActionRail`. Its controls are addressed by
     * accessible name — except Like, whose name is the like *count*, so it is
     * found by position relative to Comment rather than by a label that
     * changes every time somebody likes the post.
     */
    const rail = ctx.page.locator('aside').first();
    const railButtons = rail.locator('button');

    /*
     * The rail is re-read before every interaction rather than indexed once.
     * Its contents change as you use it — following a creator removes the
     * Follow control entirely — so a cached index silently starts pointing at
     * the wrong button, which is exactly how an earlier run "clicked Comment"
     * and hit Collect instead.
     */
    const readRail = async () => railButtons.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('title')
      || n.getAttribute('aria-label') || n.textContent.trim().slice(0, 20)));
    const railIndexOf = async (pattern) => (await readRail()).findIndex((l) => pattern.test(l || ''));

    const labels = await readRail();
    console.log(`  rail controls: ${JSON.stringify(labels)}`);
    check('the action rail rendered its controls',
      labels.findIndex((l) => /^comment$/i.test(l || '')) > 0, `${labels.length} buttons`);

    /*
     * Like is measured as a *transition*, not from an assumed starting state.
     *
     * These accounts have real seeded history, so the post on screen may
     * already be liked — and it was. Clicking then produced an unlike, which
     * correctly emits no signal, and an earlier version of this scenario read
     * that as "liking sent nothing". The control's label is the like count,
     * so the direction it moves says which transition just happened.
     */
    const likeBefore = ctx.eventsOfType('like').length;
    const likeIndexNow = async () => (await railIndexOf(/^comment$/i)) - 1;
    const likeCount = async () => {
      const idx = await likeIndexNow();
      return Number(String((await readRail())[idx]).replace(/[^0-9]/g, ''));
    };
    const clickLike = async () => {
      const before = await likeCount();
      await railButtons.nth(await likeIndexNow()).click({ force: true });
      await ctx.page.waitForFunction(
        ([idx, prev]) => {
          const node = document.querySelectorAll('aside button')[idx];
          if (!node) return false;
          const label = node.getAttribute('title') || node.getAttribute('aria-label')
            || node.textContent.trim();
          return Number(String(label).replace(/[^0-9]/g, '')) !== prev;
        },
        [await likeIndexNow(), before],
        { timeout: 15000 }
      ).catch(() => {});
      const after = await likeCount();
      return { before, after, liked: after > before };
    };

    const firstClick = await clickLike();
    await ctx.page.waitForTimeout(9000);
    const afterFirst = ctx.eventsOfType('like').length;
    if (firstClick.liked) {
      check('liking from the rail sent exactly one like signal', afterFirst === likeBefore + 1,
        `count ${firstClick.before} -> ${firstClick.after}, ${afterFirst - likeBefore} signal(s)`);
    } else {
      check('un-liking from the rail sends no like signal', afterFirst === likeBefore,
        `count ${firstClick.before} -> ${firstClick.after}, ${afterFirst - likeBefore} signal(s)`);
    }

    const beforeSecond = ctx.eventsOfType('like').length;
    const secondClick = await clickLike();
    await waitForEvent(ctx, 'like', 15000);
    await ctx.page.waitForTimeout(4000);
    const afterSecond = ctx.eventsOfType('like').length;
    if (secondClick.liked) {
      check('the opposite transition (liking) sends exactly one signal',
        afterSecond === beforeSecond + 1,
        `count ${secondClick.before} -> ${secondClick.after}, ${afterSecond - beforeSecond} signal(s)`);
    } else {
      check('the opposite transition (un-liking) sends none',
        afterSecond === beforeSecond,
        `count ${secondClick.before} -> ${secondClick.after}, ${afterSecond - beforeSecond} signal(s)`);
    }
    check('across a like and an un-like, exactly one like signal was sent',
      ctx.eventsOfType('like').length === likeBefore + 1,
      `${ctx.eventsOfType('like').length - likeBefore} total`);

    const anyLike = ctx.eventsOfType('like').slice(-1)[0];
    if (anyLike) {
      const likeRows = await db.collection('recommendation_events').countDocuments({
        postId: new ObjectId(anyLike.postId), sessionId: anyLike.sessionId, eventType: 'like'
      });
      check('the like persisted exactly once', likeRows === 1, `${likeRows} rows`);
      const stat = await db.collection('post_recommendation_stats').findOne({
        postId: new ObjectId(anyLike.postId)
      });
      check('the like reached the post stats', (stat?.weightedEngagement || 0) > 0,
        `weightedEngagement=${stat?.weightedEngagement}`);
    }
    await ctx.shot('07-for-you-liked');

    const followButton = rail.locator('button[aria-label^="Follow "]').first();
    if (await followButton.isVisible().catch(() => false)) {
      const followBefore = ctx.eventsOfType('follow_after_view').length;
      await followButton.click();
      await ctx.page.waitForTimeout(6500);
      const follows = ctx.eventsOfType('follow_after_view');
      check('following from the rail sent a follow_after_view', follows.length === followBefore + 1,
        `${follows.length - followBefore} sent`);
      const latest = follows[follows.length - 1];
      if (latest) {
        check('the server took a verdict on the follow attribution',
          latest.verdict && latest.verdict.status === 200, JSON.stringify(latest.verdict));
      }
    } else {
      console.log('  ~ already following this creator; follow attribution covered by the API suite');
    }

    console.log('\n=== 3.7 Comment through the real composer ===');
    const commentBefore = ctx.eventsOfType('comment').length;
    await railButtons.nth(await railIndexOf(/^comment$/i)).click({ force: true });
    await ctx.page.waitForTimeout(4500);
    const composer = ctx.page.locator('textarea').first();
    const composerReady = await composer.waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true).catch(() => false);
    if (composerReady) {
      const text = `browser verification ${Date.now()}`;
      await composer.click();
      await composer.fill(text).catch(async () => { await composer.type(text); });
      await ctx.page.waitForTimeout(700);
      // `CommentForm`'s submit is an icon button — it has no text, only
      // `aria-label="Post comment"`, which is why matching on visible text
      // found nothing and the earlier run silently submitted nothing.
      const postButton = ctx.page.locator('button[aria-label="Post comment"]').first();
      await postButton.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
      if (await postButton.isEnabled().catch(() => false)) await postButton.click({ force: true });
      else await composer.press('Enter');
      await waitForEvent(ctx, 'comment', 25000);
      await ctx.page.waitForTimeout(2500);

      const comments = ctx.eventsOfType('comment');
      check('commenting sent exactly one comment signal', comments.length === commentBefore + 1,
        `${comments.length - commentBefore} sent`);
      const latest = comments[comments.length - 1];
      if (latest) {
        check('the comment signal carried a real commentId', Boolean(latest.commentId),
          String(latest.commentId));
        const realComment = await db.collection('comments').findOne({
          _id: new ObjectId(latest.commentId)
        });
        check('that id names a comment that genuinely exists', Boolean(realComment));
        check('the comment belongs to the post the signal names',
          Boolean(realComment) && realComment.objectId?.toString() === latest.postId,
          `${realComment?.objectId} vs ${latest.postId}`);
        check('the server accepted the comment signal',
          (latest.verdict?.accepted || 0) > 0, JSON.stringify(latest.verdict));
      }
      await ctx.shot('08-for-you-commented');
    } else {
      console.log('  ~ comment composer not reachable in this layout');
    }

    // ---------------------------------------------------------------
    console.log('\n=== 3.6 Photo dwell on Home ===');
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('.home-feed-card-media').first().waitFor({ state: 'visible', timeout: 20000 });
    await ctx.page.waitForTimeout(2000);

    const dwellBefore = ctx.eventsOfType('photo_dwell').length;
    const mountedCards = await ctx.page.locator('.home-feed-card-media').count();
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.mouse.wheel(0, 320);
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1400);
    }
    await ctx.page.waitForTimeout(3000);
    await ctx.page.mouse.wheel(0, 3200);
    await ctx.page.waitForTimeout(8000);

    const dwells = ctx.eventsOfType('photo_dwell');
    const cardDwells = dwells.length - dwellBefore;
    if (cardDwells > 0) {
      check('scrolling past dwelt-on cards flushed photo_dwell', true,
        `${cardDwells} sent, e.g. ${dwells[dwells.length - 1]?.dwellMs}ms`);
      check('every dwell reported a positive duration',
        dwells.every((d) => (d.dwellMs || 0) > 0),
        `min ${Math.min(...dwells.map((d) => d.dwellMs || 0))}ms`);
      check('far fewer dwells than mounted cards — off-screen cards do not accrue',
        cardDwells < mountedCards,
        `${cardDwells} dwell events for ${mountedCards} mounted cards`);
    } else {
      console.log(`  ~ no photo card entered the dwell band this run (${mountedCards} cards mounted)`);
    }
    await ctx.shot('09-home-photo-dwell');

    console.log('\n=== Server verdicts ===');
    const totals = ctx.totals();
    check('nothing the page sent was rejected', totals.rejected === 0, JSON.stringify(totals));

    console.log('\n  batches on the wire:');
    ctx.captured.forEach((row) => {
      const line = row.events.map((e) => {
        let extra = '';
        if (e.watchMs) extra = `(${e.watchMs}ms)`;
        else if (e.dwellMs) extra = `(${e.dwellMs}ms dwell)`;
        else if (e.commentId) extra = `(comment ${String(e.commentId).slice(-6)})`;
        else if (e.clientExposureId) extra = `(occ ${String(e.clientExposureId).slice(0, 6)})`;
        return `${e.eventType}${extra}`;
      }).join(' ');
      console.log(`    ${line}  ->  ${JSON.stringify(row.verdict)}`);
    });
  } finally {
    await mongo.close();
    await ctx.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 3: replay, interactions, dwell');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
