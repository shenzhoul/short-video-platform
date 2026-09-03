/**
 * Session depth in a real browser.
 *
 *   Home    — scroll to exhaustion, and check the total against what the server
 *             actually stored for that session.
 *   For You — scroll well past the 40-item initial segment, across the boundary,
 *             checking for duplicates, dead ends and attribution.
 *
 * Every page response is captured with its session id, cursor, row count and
 * `hasMore`, so "it stopped at N" can be attributed to the client or the server
 * rather than guessed at.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT_A = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

function tracePages(ctx) {
  const pages = [];
  const logs = [];
  ctx.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (/403 \(Forbidden\)/.test(text)) return;
    logs.push(`[${message.type()}] ${text.slice(0, 200)}`);
  });
  ctx.page.on('pageerror', (error) => logs.push(`[pageerror] ${String(error).slice(0, 200)}`));
  ctx.page.on('response', async (response) => {
    const url = response.url();
    if (!/\/posts\/(home-posts|recommended)/.test(url)) return;
    const parsed = new URL(url);
    try {
      const json = await response.json();
      const data = json?.data;
      pages.push({
        route: parsed.pathname,
        sentSessionId: parsed.searchParams.get('sessionId'),
        sentCursor: parsed.searchParams.get('cursor'),
        limit: parsed.searchParams.get('limit'),
        sessionId: data?.sessionId,
        nextCursor: data?.nextCursor,
        hasMore: data?.hasMore,
        ids: (data?.data || []).map((post) => post._id)
      });
    } catch { /* not JSON */ }
  });
  return { pages, logs };
}

/** The post ids the server stored for a session, read straight from Redis. */
async function storedSession(sessionId) {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const Redis = require(require.resolve('ioredis', {
    paths: [path.resolve(__dirname, '..', '..', 'api')]
  }));
  const client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  try {
    // Same namespaced key the API writes — see `REDIS_KEYS` in the api project.
    const namespace = process.env.REDIS_NAMESPACE || 'douyin-clone';
    const rows = await client.lrange(`${namespace}:reco-feed:${sessionId}:items`, 0, -1);
    return rows.map((raw) => JSON.parse(raw).postId);
  } finally {
    client.disconnect();
  }
}

async function homeDepth(browser) {
  console.log('\n=== Home — scroll to exhaustion (guest) ===');
  const ctx = await openContext(browser, 'home-depth');
  const probe = tracePages(ctx);
  try {
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await ctx.page.waitForTimeout(1500);

    const countCards = () => ctx.page.evaluate(() => Array.from(
      document.querySelectorAll('article[data-post-id]')
    ).map((node) => node.getAttribute('data-post-id')));

    let cards = await countCards();
    const serverRendered = cards.length;
    console.log(`  after first paint: ${cards.length} cards (server-rendered)`);

    let stable = 0;
    for (let round = 0; round < 40 && stable < 3; round += 1) {
      // Jiggle rather than pin to the bottom: a container already at its
      // maximum `scrollTop` emits no scroll event, so an infinite-scroll
      // listener attached after the jump would never hear one again.
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.evaluate(() => {
        const scroller = document.getElementById('home-feed-scroll');
        if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 400);
      });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(120);
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.evaluate(() => {
        const scroller = document.getElementById('home-feed-scroll');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1800);
      // eslint-disable-next-line no-await-in-loop
      const now = await countCards();
      if (now.length === cards.length) stable += 1; else stable = 0;
      cards = now;
      console.log(`  scroll ${round + 1}: ${cards.length} cards`);
    }

    console.log('  page responses:');
    probe.pages.forEach((page, index) => console.log(
      `    ${index + 1}. limit=${page.limit} sentCursor=${page.sentCursor} -> ${page.ids.length} posts,`
      + ` hasMore=${page.hasMore}, nextCursor=${page.nextCursor}, session=${String(page.sessionId).slice(0, 8)}`
    ));

    const sessionIds = [...new Set(probe.pages.map((page) => page.sessionId).filter(Boolean))];
    const served = probe.pages.flatMap((page) => page.ids);
    // The first page is server-rendered, so the browser never sees it; the
    // session id comes back on the first client page instead.
    const stored = sessionIds.length ? await storedSession(sessionIds[0]) : [];

    console.log(`\n  distinct sessions used : ${sessionIds.length} ${JSON.stringify(sessionIds.map((id) => id.slice(0, 8)))}`);
    console.log(`  rows served to client   : ${served.length} (${new Set(served).size} distinct)`);
    console.log(`  cards rendered          : ${cards.length} (${new Set(cards).size} distinct)`);
    console.log(`  server session length   : ${stored.length}`);

    check('Home pages within one session, not many', sessionIds.length <= 1, `${sessionIds.length} sessions`);
    check('every post the server stored for the session was rendered',
      stored.length > 0 && stored.every((id) => cards.includes(id)),
      `${stored.filter((id) => !cards.includes(id)).length} of ${stored.length} missing`);
    /*
     * The client fetches the part of the session the server render did not
     * deliver — not the whole thing. It used to fetch all of it because the
     * server-rendered session belonged to a different subject and was
     * abandoned; now the two share one session, so `server-rendered + client
     * rows` is the session length.
     */
    check('the server render and the client together cover the session exactly',
      serverRendered + served.length === stored.length && new Set(served).size === served.length,
      `${serverRendered} server-rendered + ${served.length} client = ${serverRendered + served.length}`
      + ` for a ${stored.length}-item session`);
    check('no duplicate card', new Set(cards).size === cards.length,
      `${cards.length} cards, ${new Set(cards).size} distinct`);
    check('paging ended because the session ended, not early',
      probe.pages.length > 0 && probe.pages[probe.pages.length - 1].hasMore === false,
      `last hasMore=${probe.pages[probe.pages.length - 1]?.hasMore}`);

    const refreshVisible = await ctx.page.getByText(/refresh recommendations/i).first().isVisible().catch(() => false);
    check('the "Refresh recommendations" prompt appears only once the session is spent',
      refreshVisible, `visible=${refreshVisible}`);
    check('Home console is clean', probe.logs.length === 0, probe.logs.slice(0, 3).join(' | '));
    await ctx.shot('54-home-session-exhausted');

    /*
     * Second visit, same browser.
     *
     * A visit is one session either way now — `proxy.ts` issues the guest
     * subject before anything renders, so even a first-ever paint shares its
     * subject with the client. This case is kept because it is the one that
     * *used* to differ: before the proxy, the first visit produced two sessions
     * and 78-86 cards for a 70-item policy, and only a return visit was clean.
     * Both are asserted so a regression in either shows up.
     */
    console.log('\n  -- second visit, cookie now present --');
    probe.pages.length = 0;
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await ctx.page.waitForTimeout(1500);
    let secondCards = await countCards();
    let secondStable = 0;
    for (let round = 0; round < 40 && secondStable < 3; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.evaluate(() => {
        const scroller = document.getElementById('home-feed-scroll');
        if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 400);
      });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(120);
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.evaluate(() => {
        const scroller = document.getElementById('home-feed-scroll');
        if (scroller) scroller.scrollTop = scroller.scrollHeight;
      });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1800);
      // eslint-disable-next-line no-await-in-loop
      const now = await countCards();
      if (now.length === secondCards.length) secondStable += 1; else secondStable = 0;
      secondCards = now;
    }
    const secondSessions = [...new Set(probe.pages.map((page) => page.sessionId).filter(Boolean))];
    const secondStored = secondSessions.length ? await storedSession(secondSessions[0]) : [];
    probe.pages.forEach((page, index) => console.log(
      `    ${index + 1}. sentCursor=${page.sentCursor} -> ${page.ids.length} posts,`
      + ` hasMore=${page.hasMore}, session=${String(page.sessionId).slice(0, 8)}`
    ));
    console.log(`  second visit: ${secondCards.length} cards, ${secondSessions.length} session(s), stored ${secondStored.length}`);
    check('a returning guest renders and pages exactly one session',
      secondSessions.length === 1 && secondCards.length === secondStored.length,
      `${secondCards.length} cards vs ${secondStored.length} stored, ${secondSessions.length} session(s)`);
    check('and it still holds the whole session with no duplicate',
      new Set(secondCards).size === secondCards.length && secondStored.every((id) => secondCards.includes(id)),
      `${secondCards.length} cards, ${new Set(secondCards).size} distinct`);
    await ctx.shot('56-home-second-visit');
    return { cards, stored };
  } finally {
    await ctx.close();
  }
}

async function forYouBoundary(browser, signedIn) {
  const label = signedIn ? 'for-you-auth' : 'for-you-guest';
  console.log(`\n=== For You — across the 40-item boundary (${signedIn ? 'authenticated' : 'guest'}) ===`);
  const ctx = await openContext(browser, label);
  const probe = tracePages(ctx);
  try {
    if (signedIn) await signIn(ctx, ACCOUNT_A);
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(5000);

    const visited = [];
    const emptySrcAt = [];
    const blackFrameAt = [];
    let stalledAt = -1;

    for (let step = 0; step < 56; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const view = await ctx.page.evaluate(() => {
        const video = document.querySelector('video[data-video-id^="for-you-"]');
        const images = Array.from(document.querySelectorAll('section img'))
          .filter((image) => image.getAttribute('src') && !image.getAttribute('src').startsWith('data:'));
        return {
          postId: video ? video.getAttribute('data-video-id').replace('for-you-', '') : null,
          srcState: video ? ((video.getAttribute('src') || '').trim() === '' ? 'EMPTY' : 'ok') : 'no-video',
          videoCount: document.querySelectorAll('video').length,
          playing: Array.from(document.querySelectorAll('video')).filter((v) => !v.paused).length,
          imageCount: images.length
        };
      });

      if (view.srcState === 'EMPTY') emptySrcAt.push(step);
      if (view.postId) {
        visited.push(view.postId);
      } else if (view.imageCount > 0) {
        visited.push(`photo@${step}`);
      } else {
        blackFrameAt.push(step);
        visited.push(`blank@${step}`);
      }
      if (step === 38 || step === 39 || step === 40 || step === 41) {
        console.log(`  step ${step}: post=${view.postId || `(photo, ${view.imageCount} images)`} videos=${view.videoCount} playing=${view.playing}`);
      }

      // eslint-disable-next-line no-await-in-loop
      await ctx.page.keyboard.press('ArrowDown');
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(750);

      // Detect a dead end: the stage stopped changing for several steps.
      if (step > 5 && visited.slice(-4).every((id) => id === visited[visited.length - 1])) {
        stalledAt = step;
        break;
      }
    }

    console.log('  page responses:');
    probe.pages.forEach((page, index) => console.log(
      `    ${index + 1}. sentSession=${String(page.sentSessionId).slice(0, 8)} sentCursor=${page.sentCursor}`
      + ` -> ${page.ids.length} posts, hasMore=${page.hasMore}, nextCursor=${page.nextCursor},`
      + ` session=${String(page.sessionId).slice(0, 8)}`
    ));

    const realPosts = visited.filter((id) => /^[0-9a-f]{24}$/.test(id));
    const sessionIds = [...new Set(probe.pages.map((page) => page.sessionId).filter(Boolean))];
    const rollovers = probe.pages.filter((page) => !page.sentSessionId && page.sentCursor === null).length;

    console.log(`\n  stage states walked : ${visited.length}`);
    console.log(`  distinct video posts: ${new Set(realPosts).size}`);
    console.log(`  sessions opened     : ${sessionIds.length} (client-visible)`);
    console.log(`  rollover requests   : ${rollovers}`);
    console.log(`  stalled at step     : ${stalledAt < 0 ? 'never' : stalledAt}`);

    check(`${label}: walks at least 50 posts`, visited.length >= 50, `${visited.length} stage states`);
    check(`${label}: never stalls at the 40-item boundary`,
      stalledAt < 0, stalledAt < 0 ? 'no stall' : `stalled at ${stalledAt}`);
    check(`${label}: no duplicate video post across the boundary`,
      new Set(realPosts).size === realPosts.length,
      `${realPosts.length} video stages, ${new Set(realPosts).size} distinct`);
    check(`${label}: no empty <video> src anywhere in the walk`,
      emptySrcAt.length === 0, JSON.stringify(emptySrcAt));
    check(`${label}: no blank stage (a post with neither video nor images)`,
      blackFrameAt.length === 0, JSON.stringify(blackFrameAt));
    check(`${label}: a second segment was opened rather than the feed ending`,
      probe.pages.length > 1, `${probe.pages.length} client page requests`);
    check(`${label}: console is clean`, probe.logs.length === 0, probe.logs.slice(0, 3).join(' | '));
    await ctx.shot(`55-${label}-past-boundary`);
    return { visited, pages: probe.pages };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  try {
    await homeDepth(browser);
    await forYouBoundary(browser, false);
    await forYouBoundary(browser, true);
  } finally {
    await mongo.close();
    await browser.close();
  }
  process.exit(summarise('Session depth'));
}

main().catch((error) => { console.error(error); process.exit(1); });
