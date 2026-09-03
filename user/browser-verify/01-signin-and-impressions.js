/**
 * Browser pass 1 — sign-in, and Home impression semantics from real scrolling.
 *
 * Proves the first link of the chain: that a *gesture* in a real page produces
 * a recommendation batch on the wire with the right shape, and that the
 * visibility rules (>=50% for >=1s) are enforced by the page rather than
 * assumed. Nothing here calls the API directly.
 */

const {
  chromium, USER_APP, openContext, signIn, waitForEvent, check, summarise
} = require('./lib/harness');

const ACCOUNT_A = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

/** Scrolls the window by a distance over a number of steps, like a real wheel. */
async function scrollBy(page, distance, steps = 12, pauseMs = 16) {
  for (let i = 0; i < steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.wheel(0, distance / steps);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(pauseMs);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await openContext(browser, 'A');

  try {
    console.log('=== Sign in (real login dialog) ===');
    await signIn(ctx, ACCOUNT_A);
    const signedIn = await ctx.page.evaluate(() => document.cookie.length > 0);
    check('signed in through the real login form', signedIn, `${ACCOUNT_A}`);
    await ctx.shot('01-home-signed-in');

    console.log('\n=== Home feed loaded ===');
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(2500);
    // `.home-feed-card-media` is the element `useRecommendationImpression`
    // observes, so it is both the card and the thing whose visibility decides
    // whether an impression is owed.
    await ctx.page.locator('.home-feed-card-media').first().waitFor({ state: 'visible', timeout: 20000 });
    const cardCount = await ctx.page.locator('.home-feed-card-media').count();
    check('Home rendered feed cards', cardCount > 0, `${cardCount} observed card media elements`);

    console.log('\n=== 3.1 Fast scroll past cards (under the dwell threshold) ===');
    const beforeFast = ctx.eventsOfType('impression').length;
    // Sweep down and back quickly: nothing should stay >=50% visible for >=1s.
    await scrollBy(ctx.page, 4000, 20, 10);
    await scrollBy(ctx.page, -4000, 20, 10);
    await ctx.page.waitForTimeout(5000); // let any batch flush
    const afterFast = ctx.eventsOfType('impression').length;
    check(
      'a fast scroll past cards records few or no impressions',
      afterFast - beforeFast <= 3,
      `${afterFast - beforeFast} impressions from the sweep`
    );

    console.log('\n=== 3.1 Dwell on a card (over the threshold) ===');
    const beforeDwell = ctx.eventsOfType('impression').length;
    await scrollBy(ctx.page, 900, 10, 30);
    await ctx.page.waitForTimeout(6000); // comfortably over 1s visible + flush
    const impressions = await waitForEvent(ctx, 'impression', 12000);
    const afterDwell = impressions.length;
    check(
      'dwelling on cards records impressions',
      afterDwell > beforeDwell,
      `${afterDwell - beforeDwell} new impressions`
    );
    await ctx.shot('02-home-after-dwell');

    console.log('\n=== 3.1 Holding longer does not duplicate ===');
    const settled = ctx.eventsOfType('impression');
    const perPostSession = new Map();
    settled.forEach((event) => {
      const key = `${event.sessionId}:${event.postId}`;
      perPostSession.set(key, (perPostSession.get(key) || 0) + 1);
    });
    const duplicatesOnWire = [...perPostSession.values()].filter((n) => n > 1).length;
    await ctx.page.waitForTimeout(6000);
    const stillSettled = ctx.eventsOfType('impression').length;
    check(
      'holding the same cards visible sends no further impressions',
      stillSettled === settled.length,
      `${settled.length} -> ${stillSettled}`
    );
    check(
      'the client does not resend an impression for the same (session, post)',
      duplicatesOnWire === 0,
      `${duplicatesOnWire} repeated pairs on the wire`
    );

    console.log('\n=== Server verdicts ===');
    const totals = ctx.totals();
    check(
      'every batch was answered by the server',
      ctx.captured.every((row) => row.verdict && row.verdict.status === 200),
      JSON.stringify(totals)
    );
    check(
      'the server rejected nothing the page sent',
      totals.rejected === 0,
      `accepted ${totals.accepted}, deduped ${totals.deduped}, rejected ${totals.rejected}`
    );

    // What actually went over the wire, for the report.
    const sample = ctx.captured.slice(0, 4).map((row) => ({
      events: row.events.map((e) => `${e.eventType}:${String(e.postId).slice(-6)}`).join(' '),
      verdict: row.verdict
    }));
    console.log('\n  sample batches:');
    sample.forEach((row) => console.log(`    ${row.events}  ->  ${JSON.stringify(row.verdict)}`));

    // Emit the captured stream for the later scenarios / the report.
    console.log(`\n  CAPTURED_JSON ${JSON.stringify(ctx.captured.slice(0, 40))}`);
  } finally {
    await ctx.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 1: sign-in and Home impressions');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
