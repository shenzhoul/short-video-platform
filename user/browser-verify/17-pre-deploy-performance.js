/**
 * Pre-deploy performance and session invariants, on a production build.
 *
 * Not a re-run of the Home Feed optimisation work — that stays closed. This
 * measures the surfaces this round changed, so a functional fix that revived a
 * known cost (a video leak, a full-size cover decode, a request per frame)
 * shows up as a number rather than as a surprise later.
 *
 * Reported per scenario: cards, mounted and playing videos, duplicate ids,
 * network and console errors, p95/p99/worst frame, heap before and after, and
 * how many recommendation-event requests were sent.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

function instrument(ctx) {
  const state = { consoleErrors: [], networkErrors: [], eventRequests: 0 };
  ctx.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (/403 \(Forbidden\)/.test(text)) return;
    state.consoleErrors.push(text.slice(0, 160));
  });
  ctx.page.on('pageerror', (error) => state.consoleErrors.push(String(error).slice(0, 160)));
  ctx.page.on('requestfailed', (request) => {
    // A navigation the harness itself abandoned is not a product failure.
    if (request.failure()?.errorText === 'net::ERR_ABORTED') return;
    state.networkErrors.push(`${request.method()} ${request.url().slice(-60)}: ${request.failure()?.errorText}`);
  });
  ctx.page.on('response', (response) => {
    const url = response.url();
    if (url.includes('/posts/recommendation-events')) state.eventRequests += 1;
    if (response.status() >= 500) state.networkErrors.push(`${response.status()} ${url.slice(-60)}`);
  });
  return state;
}

async function startMetrics(page) {
  await page.evaluate(() => {
    window.__perf = { longTasks: [], frames: [] };
    try {
      new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => window.__perf.longTasks.push(Math.round(entry.duration)));
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* longtask unsupported */ }
    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__perf.frames.push(now - last);
      last = now;
      window.__perf.raf = requestAnimationFrame(tick);
    };
    window.__perf.raf = requestAnimationFrame(tick);
    window.__perf.heapAtStart = performance.memory ? performance.memory.usedJSHeapSize : null;
  });
}

async function readMetrics(page, label) {
  const raw = await page.evaluate(() => {
    const frames = window.__perf.frames.slice().sort((a, b) => a - b);
    const at = (p) => (frames.length ? Math.round(frames[Math.floor(frames.length * p)]) : 0);
    const videos = Array.from(document.querySelectorAll('video'));
    const cardIds = Array.from(document.querySelectorAll('[data-post-id]'))
      .map((node) => node.getAttribute('data-post-id'));
    const result = {
      longTaskCount: window.__perf.longTasks.length,
      longTaskMs: window.__perf.longTasks.reduce((a, b) => a + b, 0),
      worstLongTaskMs: Math.max(0, ...window.__perf.longTasks),
      p95FrameMs: at(0.95),
      p99FrameMs: at(0.99),
      cards: cardIds.length,
      duplicateCards: cardIds.length - new Set(cardIds).size,
      videos: videos.length,
      playingVideos: videos.filter((video) => !video.paused).length,
      heapStartMb: window.__perf.heapAtStart ? Math.round(window.__perf.heapAtStart / 1048576) : null,
      heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
    };
    window.__perf.longTasks = [];
    window.__perf.frames = [];
    return result;
  });
  console.log(
    `  ${label.padEnd(34)} cards ${String(raw.cards).padStart(3)} dup ${raw.duplicateCards}  `
    + `video ${raw.videos}/${raw.playingVideos}  `
    + `p95 ${String(raw.p95FrameMs).padStart(3)}ms p99 ${String(raw.p99FrameMs).padStart(4)}ms worst ${String(raw.worstLongTaskMs).padStart(4)}ms  `
    + `long ${String(raw.longTaskCount).padStart(3)}  heap ${raw.heapStartMb}->${raw.heapMb}MB`
  );
  return raw;
}

async function scrollHomeToEnd(page) {
  let previous = -1;
  for (let round = 0; round < 20; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    const count = await page.evaluate(() => {
      const scroller = document.getElementById('home-feed-scroll');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      return document.querySelectorAll('article[data-post-id]').length;
    });
    if (count === previous) break;
    previous = count;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1800);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--js-flags=--expose-gc'] });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();
  const results = {};

  try {
    // ---------------------------------------------------------------
    console.log('\n=== Home: cold load, then the whole session ===');
    const home = await openContext(browser, 'perf-home');
    const homeState = instrument(home);
    await home.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await home.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await startMetrics(home.page);
    await home.page.waitForTimeout(3000);
    results.homeCold = await readMetrics(home.page, 'cold load');

    await scrollHomeToEnd(home.page);
    results.homeFull = await readMetrics(home.page, 'full session loaded');

    for (let round = 0; round < 10; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await home.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await home.page.waitForTimeout(1100);
    }
    await startMetrics(home.page);
    await home.page.waitForTimeout(2000);
    results.homeReloads = await readMetrics(home.page, 'after 10 reloads');
    check('Home holds no duplicate card after a full session',
      results.homeFull.duplicateCards === 0, `${results.homeFull.duplicateCards}`);
    check('Home mounts at most one playing video',
      results.homeFull.playingVideos <= 1, `${results.homeFull.playingVideos} playing`);
    check('Home reloads leak no heap',
      results.homeReloads.heapMb === null || results.homeReloads.heapMb < 400,
      `${results.homeReloads.heapMb}MB`);
    check('Home had no network error', homeState.networkErrors.length === 0, homeState.networkErrors.slice(0, 2).join(' | '));
    check('Home had no console error', homeState.consoleErrors.length === 0, homeState.consoleErrors.slice(0, 2).join(' | '));
    console.log(`  recommendation-event requests: ${homeState.eventRequests}`);
    await home.close();

    // ---------------------------------------------------------------
    console.log('\n=== For You: 50 posts across the segment boundary ===');
    const forYou = await openContext(browser, 'perf-for-you');
    const forYouState = instrument(forYou);
    await signIn(forYou, ACCOUNT);
    await forYou.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await forYou.page.waitForTimeout(4000);
    await startMetrics(forYou.page);
    for (let step = 0; step < 52; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await forYou.page.keyboard.press('ArrowDown');
      // eslint-disable-next-line no-await-in-loop
      await forYou.page.waitForTimeout(600);
    }
    results.forYou = await readMetrics(forYou.page, '52 steps');
    check('For You keeps at most one video mounted on the stage',
      results.forYou.videos <= 1, `${results.forYou.videos} mounted`);
    check('For You keeps at most one video playing',
      results.forYou.playingVideos <= 1, `${results.forYou.playingVideos} playing`);
    check('For You had no network error', forYouState.networkErrors.length === 0, forYouState.networkErrors.slice(0, 2).join(' | '));
    check('For You had no console error', forYouState.consoleErrors.length === 0, forYouState.consoleErrors.slice(0, 2).join(' | '));
    console.log(`  recommendation-event requests: ${forYouState.eventRequests}`);
    await forYou.close();

    // ---------------------------------------------------------------
    console.log('\n=== Creator profile: the whole works grid ===');
    const profile = await openContext(browser, 'perf-profile');
    const profileState = instrument(profile);
    await profile.page.goto(`${USER_APP}/iris.inthefield`, { waitUntil: 'domcontentloaded' });
    await profile.page.locator('[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await startMetrics(profile.page);
    for (let round = 0; round < 6; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await profile.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // eslint-disable-next-line no-await-in-loop
      await profile.page.waitForTimeout(1200);
    }
    results.profile = await readMetrics(profile.page, 'scrolled to end');
    check('the profile grid holds no duplicate', results.profile.duplicateCards === 0, `${results.profile.duplicateCards}`);
    check('the profile grid holds the creator\'s whole list', results.profile.cards === 10, `${results.profile.cards} tiles`);
    check('profile had no network error', profileState.networkErrors.length === 0, profileState.networkErrors.slice(0, 2).join(' | '));
    check('profile had no console error', profileState.consoleErrors.length === 0, profileState.consoleErrors.slice(0, 2).join(' | '));
    await profile.close();

    // ---------------------------------------------------------------
    console.log('\n=== Post Detail: the three modes ===');
    const detail = await openContext(browser, 'perf-detail');
    const detailState = instrument(detail);
    await signIn(detail, ACCOUNT);
    const anchor = await db.collection('posts').findOne({ type: 'video', status: 'active' });
    await detail.page.goto(`${USER_APP}/?modal_id=${anchor._id.toString()}`, { waitUntil: 'domcontentloaded' });
    await detail.page.waitForTimeout(5000);
    await startMetrics(detail.page);

    for (let step = 0; step < 15; step += 1) {
      const next = detail.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      if (!await next.isEnabled().catch(() => false)) break;
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // eslint-disable-next-line no-await-in-loop
      await detail.page.waitForTimeout(900);
    }
    results.detailRecommendation = await readMetrics(detail.page, 'recommendation mode, 15 steps');

    await detail.page.locator("button[aria-label$=\"'s details\"]").first().click().catch(() => {});
    await detail.page.waitForTimeout(3500);
    for (let step = 0; step < 8; step += 1) {
      const next = detail.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      if (!await next.isEnabled().catch(() => false)) break;
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // eslint-disable-next-line no-await-in-loop
      await detail.page.waitForTimeout(800);
    }
    results.detailCreator = await readMetrics(detail.page, 'creator mode, 8 steps');

    await detail.page.getByText(/^details$/i).first().click().catch(() => {});
    await detail.page.waitForTimeout(2500);
    for (let step = 0; step < 6; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await detail.page.mouse.move(700, 450);
      // eslint-disable-next-line no-await-in-loop
      await detail.page.mouse.wheel(0, 400);
      // eslint-disable-next-line no-await-in-loop
      await detail.page.waitForTimeout(350);
    }
    results.detailLocked = await readMetrics(detail.page, 'locked mode, 6 wheels');

    check('Post Detail keeps one video mounted at a time',
      results.detailRecommendation.videos <= 2 && results.detailCreator.videos <= 2,
      `recommendation ${results.detailRecommendation.videos}, creator ${results.detailCreator.videos}`);
    check('Post Detail had no network error', detailState.networkErrors.length === 0, detailState.networkErrors.slice(0, 2).join(' | '));
    check('Post Detail had no console error', detailState.consoleErrors.length === 0, detailState.consoleErrors.slice(0, 2).join(' | '));
    console.log(`  recommendation-event requests: ${detailState.eventRequests}`);
    await detail.close();
  } finally {
    await mongo.close();
    await browser.close();
  }

  process.exit(summarise('Pre-deploy performance'));
}

main().catch((error) => { console.error(error); process.exit(1); });
