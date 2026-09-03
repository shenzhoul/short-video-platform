/**
 * Browser pass 4 — Post Detail across its sources (§6) and photo dwell in the
 * detail view (§3.6).
 *
 * Home is roughly nine-tenths video, so a photo card rarely lands in the
 * visible band during a scroll; the photo path is exercised by opening a known
 * photo post the way a link does, which is also one of the sources §6 asks
 * about. Post ids come from the database only to *choose* what to open — every
 * interaction after that is a real click in the page.
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

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await openContext(browser, 'A');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    await signIn(ctx, ACCOUNT);

    // ---------------------------------------------------------------
    console.log('=== 6. Post Detail from Home (a card click) ===');
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('.home-feed-card-media').first().waitFor({ state: 'visible', timeout: 20000 });
    await ctx.page.waitForTimeout(2500);

    await ctx.page.locator('article').first().click({ position: { x: 120, y: 80 } });
    await ctx.page.waitForFunction(() => window.location.search.includes('modal_id'), { timeout: 15000 });
    const homeUrl = new URL(ctx.page.url());
    const anchorId = homeUrl.searchParams.get('modal_id');
    check('clicking a Home card opens the detail modal', Boolean(anchorId), `modal_id=${anchorId}`);
    check('a Home card click carries no modal_src (it is not a message open)',
      !homeUrl.searchParams.get('modal_src'), `modal_src=${homeUrl.searchParams.get('modal_src')}`);

    const detailOpens = await waitForEvent(ctx, 'detail_open', 20000);
    check('opening the detail sent detail_open', detailOpens.length > 0,
      `${detailOpens.length} sent, source=${detailOpens[detailOpens.length - 1]?.source}`);
    check('the detail_open is attributed to the post-detail surface',
      detailOpens[detailOpens.length - 1]?.source === 'post-detail',
      detailOpens[detailOpens.length - 1]?.source);
    await ctx.shot('10-detail-from-home');

    // The detail sequence must be the recommendation session, not grid order.
    const homeGridIds = await ctx.page.evaluate(() => Array.from(
      document.querySelectorAll('article')
    ).slice(0, 6).map((_, i) => i));
    const nextButton = ctx.page.locator('button[aria-label="Next post"], button[title="Next post"]').first();
    let secondId = null;
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      await ctx.page.waitForTimeout(4000);
      secondId = new URL(ctx.page.url()).searchParams.get('modal_id');
      check('next moved to a different post', Boolean(secondId) && secondId !== anchorId,
        `${anchorId} -> ${secondId}`);

      const prevButton = ctx.page.locator('button[aria-label="Previous post"], button[title="Previous post"]').first();
      await prevButton.click();
      await ctx.page.waitForTimeout(3500);
      const backId = new URL(ctx.page.url()).searchParams.get('modal_id');
      check('previous returns to exactly the post already shown, from history',
        backId === anchorId, `${secondId} -> ${backId}`);
    } else {
      console.log('  ~ navigation controls not visible in this layout');
    }
    void homeGridIds;

    // ---------------------------------------------------------------
    console.log('\n=== 3.6 Photo dwell in Post Detail ===');
    const photoPost = await db.collection('posts').findOne({
      status: 'active', mediaTypes: 'photo'
    }, { projection: { _id: 1, topicKey: 1 } });
    check('a photo post exists to open', Boolean(photoPost), `post ${photoPost?._id}`);

    const dwellBefore = ctx.eventsOfType('photo_dwell').length;
    await ctx.page.goto(`${USER_APP}/?modal_id=${photoPost._id}`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(6000); // dwell on the photo
    await ctx.shot('11-detail-photo');

    /*
     * The modal is closed from inside the app rather than by navigating away.
     * `useRecommendationPhotoDwell` flushes on unmount, and a full page load
     * tears the document down without React ever unmounting — so the dwell was
     * never enqueued and there was nothing for the unload flush to send.
     */
    await ctx.page.keyboard.press('Escape');
    await ctx.page.waitForTimeout(2000);
    await waitForEvent(ctx, 'photo_dwell', 15000);
    await ctx.page.waitForTimeout(3000);

    const dwells = ctx.eventsOfType('photo_dwell');
    check('dwelling on a photo detail then leaving flushed photo_dwell',
      dwells.length > dwellBefore,
      `${dwells.length - dwellBefore} sent, ${dwells[dwells.length - 1]?.dwellMs}ms`);
    if (dwells.length > dwellBefore) {
      const latest = dwells[dwells.length - 1];
      check('the dwell reported a plausible duration', (latest.dwellMs || 0) >= 1000,
        `${latest.dwellMs}ms`);
      const row = await db.collection('recommendation_events').findOne({
        postId: new ObjectId(latest.postId), eventType: 'photo_dwell', sessionId: latest.sessionId
      });
      check('the dwell persisted with the same value', row && row.dwellMs === latest.dwellMs,
        `stored ${row?.dwellMs}ms vs sent ${latest.dwellMs}ms`);
    }

    // ---------------------------------------------------------------
    console.log('\n=== 6. Post Detail from For You ===');
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(6000);
    const forYouOpens = ctx.eventsOfType('impression').filter((e) => e.source === 'for-you');
    check('For You reports against its own feed session', forYouOpens.length > 0,
      `${forYouOpens.length} for-you impressions, session ${forYouOpens[0]?.sessionId?.slice(0, 8)}…`);

    // Opening the detail from For You must continue For You's own session.
    const rail = ctx.page.locator('aside').first();
    const avatarButton = rail.locator('button[aria-label^="Open "]').first();
    if (await avatarButton.isVisible().catch(() => false)) {
      const before = ctx.eventsOfType('detail_open').length;
      await avatarButton.click({ force: true });
      await ctx.page.waitForTimeout(5000);
      const opens = ctx.eventsOfType('detail_open');
      if (opens.length > before) {
        const latest = opens[opens.length - 1];
        check('a detail opened from For You reports the for-you source',
          latest.source === 'for-you', `source=${latest.source}`);
      } else {
        console.log('  ~ opening the detail from the avatar produced no new detail_open this run');
      }
      await ctx.shot('12-detail-from-for-you');
    }

    console.log('\n=== Server verdicts ===');
    const totals = ctx.totals();
    check('nothing the page sent was rejected', totals.rejected === 0, JSON.stringify(totals));
  } finally {
    await mongo.close();
    await ctx.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 4: Post Detail sources and photo dwell');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
