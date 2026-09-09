/**
 * Post Detail navigates its OWN recommendation session.
 *
 * Three independent engines, verified by canonical post id:
 *
 *   Home              ranks a browse
 *   For You           ranks by watch/interest behaviour
 *   Post Detail / PiP an anchor-based session of its own
 *
 * A previous pass coupled the popup to Home's ordered ids; this suite is the
 * regression fence for that. It asserts the popup is *not* `Home.slice(i + 1)`
 * and *not* the For You order, that five fresh sessions do not all replay one
 * prefix, and that popup history is replayed rather than re-requested.
 *
 *   node browser-verify/27-popup-session-trace.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SESSIONS.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const { signIn, routeMediaOrigin } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const SESSIONS = Number(process.env.SESSIONS || 5);
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const short = (id) => (id ? String(id).slice(-6) : String(id));

const openId = (page) => page.evaluate(
  () => new URL(window.location.href).searchParams.get('modal_id')
);

async function pressNav(page, direction) {
  const label = direction === 'next' ? 'Next post' : 'Previous post';
  const moved = await page.evaluate((name) => {
    const button = document.querySelector(`[data-post-detail-popup] button[aria-label="${name}"]`);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, label);
  await page.waitForTimeout(900);
  return moved;
}

/**
 * Whether a navigation control is disabled, read after a settle.
 *
 * Without the settle this races the commit that follows a navigation: probed
 * immediately after stepping back to the anchor it reported `false`, and the
 * same read 1000ms later reported `true`. The control was always correct; the
 * assertion was early.
 */
async function navDisabled(page, direction) {
  await page.waitForTimeout(600);
  return page.evaluate((name) => {
    const button = document.querySelector(`[data-post-detail-popup] button[aria-label="${name}"]`);
    return button ? button.disabled : null;
  }, direction === 'next' ? 'Next post' : 'Previous post');
}

/**
 * Open a popup from Home and walk it forward, recording every id and request.
 *
 * Each call gets a **fresh browser context**, and therefore its own recommendation
 * subject. Five sessions sharing one identity drain the same already-seen pool:
 * measured that way, sessions 4 and 5 exhausted after 6 and 0 steps, which says
 * nothing about whether the *selection* varies. Exhaustion is correct behaviour
 * — it is what disables Next instead of wrapping — but it is not what this
 * suite is measuring.
 */
async function popupSession(page, steps) {
  const requests = [];
  const onRequest = (request) => {
    const url = request.url();
    if (/detail-session/.test(url)) requests.push(url.replace(/\?.*$/, '').slice(-60));
  };
  page.on('request', onRequest);

  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const homeIds = await page.evaluate(() => [...document.querySelectorAll('article[data-post-id]')]
    .map((element) => element.getAttribute('data-post-id')));

  await page.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  await page.waitForTimeout(1800);

  const anchor = await openId(page);
  const forward = [];
  for (let i = 0; i < steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await pressNav(page, 'next'))) break;
    // eslint-disable-next-line no-await-in-loop
    forward.push(await openId(page));
  }
  page.off('request', onRequest);
  return {
    homeIds, anchor, forward, requests
  };
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  await routeMediaOrigin(context);
  const page = await context.newPage();

  console.log(`\n=== Post Detail owns its recommendation session @ ${W}x${H} ===`);
  await signIn({ page }, ACCOUNT);

  // -------------------------------------------------- For You, for comparison
  await page.goto(`${USER_APP}/for-you`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const forYouIds = await page.evaluate(async () => {
    const ids = [];
    const read = () => document.querySelector('[data-testid="post-drag-current"] video, [data-testid="post-drag-current"] img')
      ?.getAttribute('src') || null;
    ids.push(read());
    for (let i = 0; i < 4; i += 1) {
      document.querySelector('button[aria-label="Next post"]')?.click();
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => { setTimeout(resolve, 700); });
      ids.push(read());
    }
    return ids;
  });

  // ---------------------------------------------- five fresh detail sessions
  const traces = [];
  for (let i = 0; i < SESSIONS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const sessionContext = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  await routeMediaOrigin(sessionContext);
    // eslint-disable-next-line no-await-in-loop
    const sessionPage = await sessionContext.newPage();
    /*
     * Deliberately signed OUT. A fresh context gives a fresh guest
     * `anonymousId` and therefore a genuinely new recommendation subject; a
     * fresh context signed in as the same account shares that account's
     * already-seen memory, which this suite has itself drained over repeated
     * runs. Exhaustion is correct behaviour, but it measures nothing about
     * whether the *selection* varies between sessions.
     */
    // eslint-disable-next-line no-await-in-loop
    traces.push(await popupSession(sessionPage, 10));
    // eslint-disable-next-line no-await-in-loop
    await sessionContext.close();
  }

  traces.forEach((trace, index) => {
    console.log(`\n  --- detail session ${index + 1} ---`);
    console.log(`  home first 8: ${trace.homeIds.slice(0, 8).map(short).join(' ')}`);
    console.log(`  anchor:       ${short(trace.anchor)} (home index ${trace.homeIds.indexOf(trace.anchor)})`);
    console.log(`  forward:      ${trace.forward.map(short).join(' -> ')}`);
  });

  console.log('\n  --- assertions ---\n');

  const first = traces[0];

  check('the popup opens its own detail session',
    first.requests.some((url) => /detail-session/.test(url)),
    `${first.requests.length} detail-session request(s)`);

  const followsHome = (trace) => {
    const index = trace.homeIds.indexOf(trace.anchor);
    if (index < 0) return false;
    const expected = trace.homeIds.slice(index + 1, index + 1 + trace.forward.length);
    return expected.length > 0 && expected.join() === trace.forward.join();
  };
  check('popup order is NOT Home.slice(clickedIndex + 1)',
    !traces.some(followsHome),
    `${traces.filter(followsHome).length}/${traces.length} followed Home`);

  const forYouTail = forYouIds.filter(Boolean).join();
  check('popup order is NOT the For You sequence',
    !traces.some((trace) => trace.forward.join() === forYouTail));

  check('the anchor is excluded from its own forward recommendations',
    !traces.some((trace) => trace.forward.includes(trace.anchor)));

  const dupes = traces.map((trace) => trace.forward.filter((id, i) => trace.forward.indexOf(id) !== i));
  check('ten forward moves contain no duplicate ids',
    dupes.every((list) => list.length === 0),
    dupes.map((list) => list.length).join(','));

  const prefixes = traces.map((trace) => trace.forward.join(','));
  const distinct = new Set(prefixes).size;
  check(`${SESSIONS} fresh sessions do not all replay one identical prefix`,
    distinct > 1, `${distinct} distinct prefix(es) of ${SESSIONS}`);

  // --------------------------------------------------- popup history contract
  console.log('\n  --- popup history ---\n');
  const historyContext = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  await routeMediaOrigin(historyContext);
  const historyPage = await historyContext.newPage();
  // Guest, for the same reason as above: history needs an unexhausted pool.
  await historyPage.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await historyPage.waitForTimeout(2500);
  await historyPage.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await historyPage.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  await historyPage.waitForTimeout(1800);

  const p0 = await openId(historyPage);
  check('Previous is disabled at the anchor', (await navDisabled(historyPage, 'previous')) === true);

  await pressNav(historyPage, 'next');
  const p1 = await openId(historyPage);
  await pressNav(historyPage, 'next');
  const p2 = await openId(historyPage);

  await pressNav(historyPage, 'previous');
  const backTo1 = await openId(historyPage);
  await pressNav(historyPage, 'previous');
  const backTo0 = await openId(historyPage);
  // Read the control state *at the anchor*, before stepping forward again —
  // after the forward step we are on P1, where Previous is correctly enabled.
  const prevDisabledAtAnchor = await navDisabled(historyPage, 'previous');
  const forwardAgain = await pressNav(historyPage, 'next') ? await openId(historyPage) : null;

  console.log(`  P0=${short(p0)} P1=${short(p1)} P2=${short(p2)}`);
  console.log(`  back: ${short(backTo1)}, ${short(backTo0)} · forward again: ${short(forwardAgain)}`);

  check('Previous returns to the exact previous post', backTo1 === p1, `${short(backTo1)} vs ${short(p1)}`);
  check('Previous again returns to the anchor', backTo0 === p0, `${short(backTo0)} vs ${short(p0)}`);
  check('Previous is disabled again at the anchor', prevDisabledAtAnchor === true);
  check('Next replays history rather than recommending anew',
    forwardAgain === p1, `${short(forwardAgain)} vs ${short(p1)}`);
  check('the three history entries are three distinct posts',
    new Set([p0, p1, p2]).size === 3, `${short(p0)}, ${short(p1)}, ${short(p2)}`);
  await historyContext.close();

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
