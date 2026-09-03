/**
 * A first-ever visit must produce exactly one subject and one session.
 *
 * Every context here starts from a genuinely clean browser profile: no cookie,
 * no localStorage, no service worker. That is the case the previous round got
 * wrong — the server render had no subject yet, built a throwaway session, and
 * the client then opened its own, so one page load produced two sessions and a
 * Home feed of 78-86 cards against a 70-item policy.
 *
 * Reported: subjects seen, Redis session ids and their owners, rows served per
 * page, and the final DOM card count.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const Redis = require(require.resolve('ioredis', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, check, summarise
} = require('./lib/harness');

const NAMESPACE = process.env.REDIS_NAMESPACE || 'douyin-clone';
const COOKIE = 'douyin-clone-reco-anonymous-id';

function tracePages(ctx) {
  const pages = [];
  const logs = [];
  ctx.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (/403 \(Forbidden\)/.test(text)) return;
    logs.push(`[${message.type()}] ${text.slice(0, 180)}`);
  });
  ctx.page.on('pageerror', (error) => logs.push(`[pageerror] ${String(error).slice(0, 180)}`));
  ctx.page.on('response', async (response) => {
    const url = response.url();
    if (!/\/posts\/(home-posts|recommended)/.test(url)) return;
    const parsed = new URL(url);
    try {
      const json = await response.json();
      const data = json?.data;
      pages.push({
        sentAnonymousId: parsed.searchParams.get('anonymousId'),
        sentSessionId: parsed.searchParams.get('sessionId'),
        sentCursor: parsed.searchParams.get('cursor'),
        sessionId: data?.sessionId,
        hasMore: data?.hasMore,
        nextCursor: data?.nextCursor,
        rows: (data?.data || []).length
      });
    } catch { /* not JSON */ }
  });
  return { pages, logs };
}

/** Every recommendation feed session in Redis, with its owner. */
async function sessionOwners() {
  const client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  try {
    const keys = await client.keys(`${NAMESPACE}:reco-feed:*:meta`);
    const rows = [];
    for (const key of keys) {
      // eslint-disable-next-line no-await-in-loop
      const meta = await client.hgetall(key);
      // eslint-disable-next-line no-await-in-loop
      const items = await client.llen(key.replace(':meta', ':items'));
      // eslint-disable-next-line no-await-in-loop
      const ttl = await client.ttl(key);
      rows.push({
        sessionId: key.split(':')[2], subjectId: meta.subjectId, createdAt: meta.createdAt, items, ttl
      });
    }
    return rows.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  } finally {
    client.disconnect();
  }
}

async function clearRecoKeys() {
  const client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  try {
    let removed = 0;
    for (const pattern of [`${NAMESPACE}:reco-feed:*`, `${NAMESPACE}:reco-hero:*`, `${NAMESPACE}:reco-detail:*`]) {
      // eslint-disable-next-line no-await-in-loop
      const keys = await client.keys(pattern);
      // eslint-disable-next-line no-await-in-loop
      if (keys.length) removed += await client.del(...keys);
    }
    return removed;
  } finally {
    client.disconnect();
  }
}

const cards = (page) => page.evaluate(() => Array.from(
  document.querySelectorAll('article[data-post-id]')
).map((node) => node.getAttribute('data-post-id')));

/**
 * Scrolls until the card count stops growing.
 *
 * The scroll position is *jiggled* rather than pinned to the bottom. The
 * infinite-scroll component listens for scroll events on the container, and a
 * container already at its maximum `scrollTop` emits none — so a harness that
 * jumps straight to the bottom before hydration attaches that listener can sit
 * there forever and report a 20-card feed as exhausted. Moving up and back down
 * guarantees an event on every round.
 *
 * Three consecutive identical readings before stopping: a cold first visit
 * takes longer than one poll to answer.
 */
async function scrollToEnd(page) {
  let previous = -1;
  let stable = 0;
  for (let round = 0; round < 40 && stable < 3; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    const count = await page.evaluate(() => {
      const scroller = document.getElementById('home-feed-scroll');
      if (!scroller) return document.querySelectorAll('article[data-post-id]').length;
      scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight - 400);
      return document.querySelectorAll('article[data-post-id]').length;
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(120);
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const scroller = document.getElementById('home-feed-scroll');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    if (count === previous) stable += 1; else stable = 0;
    previous = count;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1500);
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });

  try {
    console.log(`  cleared ${await clearRecoKeys()} pre-existing recommendation Redis keys`);
    const before = await sessionOwners();

    // ---------------------------------------------------------------
    console.log('\n=== Home, first-ever visit from a clean browser ===');
    const ctx = await openContext(browser, 'first-visit');
    const probe = tracePages(ctx);

    const storageBefore = await ctx.page.evaluate(() => ({ cookie: document.cookie, keys: 0 })).catch(() => null);
    void storageBefore;

    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    const firstPaint = await cards(ctx.page);
    const cookieAfterPaint = await ctx.page.evaluate(() => document.cookie);
    console.log(`  first paint: ${firstPaint.length} cards`);
    console.log(`  cookie present at first paint: ${cookieAfterPaint.includes(COOKIE)}`);

    await scrollToEnd(ctx.page);
    const finalCards = await cards(ctx.page);

    const after = await sessionOwners();
    const created = after.filter((row) => !before.some((old) => old.sessionId === row.sessionId));
    const subjects = [...new Set(created.map((row) => row.subjectId))];

    console.log('\n  Redis sessions created by this visit:');
    created.forEach((row) => console.log(
      `    ${row.sessionId.slice(0, 8)}  subject=${row.subjectId}  items=${row.items}  ttl=${row.ttl}s`
    ));
    console.log('  page responses:');
    probe.pages.forEach((page, index) => console.log(
      `    ${index + 1}. anonymousId=${String(page.sentAnonymousId).slice(0, 8)} sentSession=${String(page.sentSessionId).slice(0, 8)}`
      + ` cursor=${page.sentCursor} -> ${page.rows} rows, hasMore=${page.hasMore}, session=${String(page.sessionId).slice(0, 8)}`
    ));
    console.log(`  final DOM: ${finalCards.length} cards (${new Set(finalCards).size} distinct)`);

    check('the subject cookie exists at first paint', cookieAfterPaint.includes(COOKIE), 'issued by the proxy');
    check('exactly one subject was used', subjects.length === 1, `${subjects.length}: ${JSON.stringify(subjects)}`);
    check('no session was owned by a throwaway subject',
      created.every((row) => !String(row.subjectId).startsWith('ephemeral:')),
      JSON.stringify(created.map((row) => row.subjectId)));
    check('exactly one recommendation session was created', created.length === 1,
      `${created.length}: ${JSON.stringify(created.map((row) => row.sessionId.slice(0, 8)))}`);
    check('that session holds the policy count', created[0]?.items === 70, `${created[0]?.items} items`);
    check('every session has a TTL', created.every((row) => row.ttl > 0), JSON.stringify(created.map((row) => row.ttl)));
    check('the DOM ends at exactly the session length', finalCards.length === 70, `${finalCards.length} cards`);
    check('no duplicate card', new Set(finalCards).size === finalCards.length,
      `${finalCards.length} cards, ${new Set(finalCards).size} distinct`);
    check('paging ended because the session ended',
      probe.pages.length > 0 && probe.pages[probe.pages.length - 1].hasMore === false,
      `last hasMore=${probe.pages[probe.pages.length - 1]?.hasMore}`);
    check('every client page carried the subject',
      probe.pages.every((page) => Boolean(page.sentAnonymousId)),
      `${probe.pages.filter((page) => !page.sentAnonymousId).length} without`);

    const refreshVisible = await ctx.page.getByText(/refresh recommendations/i).first().isVisible().catch(() => false);
    check('"Refresh recommendations" appears only after the 70th item', refreshVisible, `visible=${refreshVisible}`);
    check('first-visit console is clean', probe.logs.length === 0, probe.logs.slice(0, 3).join(' | '));
    await ctx.shot('58-first-visit-exhausted');

    // ---------------------------------------------------------------
    console.log('\n=== Reload: same subject, a new session ===');
    const subjectAfterFirst = subjects[0];
    probe.pages.length = 0;
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await scrollToEnd(ctx.page);
    const reloadCards = await cards(ctx.page);
    const afterReload = await sessionOwners();
    const reloadCreated = afterReload.filter((row) => !after.some((old) => old.sessionId === row.sessionId));

    reloadCreated.forEach((row) => console.log(
      `    ${row.sessionId.slice(0, 8)}  subject=${row.subjectId}  items=${row.items}`
    ));
    console.log(`  reload DOM: ${reloadCards.length} cards`);

    check('the reload kept the same subject',
      reloadCreated.every((row) => row.subjectId === subjectAfterFirst),
      `${JSON.stringify([...new Set(reloadCreated.map((row) => row.subjectId))])} vs ${subjectAfterFirst}`);
    check('the reload opened exactly one new session', reloadCreated.length === 1,
      `${reloadCreated.length}`);
    check('and it is a different session from the first',
      reloadCreated[0] && reloadCreated[0].sessionId !== created[0].sessionId, 'new ranking');
    check('the reload also ends at exactly 70 cards', reloadCards.length === 70, `${reloadCards.length}`);
    await ctx.shot('59-first-visit-reload');
    await ctx.close();

    // ---------------------------------------------------------------
    console.log('\n=== For You, first-ever visit from a clean browser ===');
    const fy = await openContext(browser, 'first-visit-for-you');
    const fyProbe = tracePages(fy);
    const beforeFy = await sessionOwners();
    await fy.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await fy.page.waitForTimeout(6000);
    const afterFy = await sessionOwners();
    const fyCreated = afterFy.filter((row) => !beforeFy.some((old) => old.sessionId === row.sessionId));
    fyCreated.forEach((row) => console.log(
      `    ${row.sessionId.slice(0, 8)}  subject=${row.subjectId}  items=${row.items}  ttl=${row.ttl}s`
    ));
    check('For You\'s first visit creates one session under a real subject',
      fyCreated.length === 1 && !String(fyCreated[0].subjectId).startsWith('ephemeral:'),
      `${fyCreated.length} session(s), subject=${fyCreated[0]?.subjectId}`);
    check('and it is the For You segment length', fyCreated[0]?.items === 40, `${fyCreated[0]?.items} items`);
    check('For You console is clean', fyProbe.logs.length === 0, fyProbe.logs.slice(0, 3).join(' | '));
    await fy.close();

    // ---------------------------------------------------------------
    console.log('\n=== Cooldown namespaces are separate per feed type ===');
    const client = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
    try {
      const heroKeys = await client.keys(`${NAMESPACE}:reco-hero:*`);
      const ttls = await Promise.all(heroKeys.map((key) => client.ttl(key)));
      console.log(`  hero cooldown keys: ${JSON.stringify(heroKeys.map((key) => key.replace(`${NAMESPACE}:reco-hero:`, '')))}`);
      check('Home and For You cooldowns are keyed separately',
        heroKeys.some((key) => key.includes(':home:')) && heroKeys.some((key) => key.includes(':for-you:')),
        JSON.stringify(heroKeys.map((key) => key.split(':').slice(2, 3))));
      check('every cooldown key has a TTL', ttls.every((ttl) => ttl > 0), JSON.stringify(ttls));
      check('no cooldown is keyed to a shared "guest" subject',
        !heroKeys.some((key) => /:guest$/.test(key)), 'ok');
    } finally {
      client.disconnect();
    }

    // ---------------------------------------------------------------
    console.log('\n=== A request with no subject at all still gets a feed ===');
    const bare = await openContext(browser, 'no-subject');
    const status = await bare.page.evaluate(async (api) => {
      const response = await fetch(`${api}/posts/home-posts?limit=5`, { credentials: 'omit' });
      const json = await response.json();
      return { status: response.status, rows: (json?.data?.data || []).length, sessionId: json?.data?.sessionId };
    }, process.env.API || 'http://localhost:8080');
    console.log(`  ${status.status}, ${status.rows} rows, session=${String(status.sessionId).slice(0, 8)}`);
    check('a subject-less request answers 200, not 500', status.status === 200, `${status.status}`);
    check('and it still returns a feed', status.rows > 0, `${status.rows} rows`);

    console.log('\n=== A malformed subject is refused, not used as a key ===');
    const bad = await bare.page.evaluate(async (api) => {
      const results = {};
      for (const value of ['short', 'has space', 'a'.repeat(200), 'colon:injected']) {
        // eslint-disable-next-line no-await-in-loop
        const response = await fetch(`${api}/posts/home-posts?limit=5&anonymousId=${encodeURIComponent(value)}`, { credentials: 'omit' });
        results[value.slice(0, 14)] = response.status;
      }
      return results;
    }, process.env.API || 'http://localhost:8080');
    console.log(`  ${JSON.stringify(bad)}`);
    check('every malformed anonymousId is rejected with 4xx',
      Object.values(bad).every((code) => code >= 400 && code < 500), JSON.stringify(bad));
    await bare.close();
  } finally {
    await browser.close();
  }

  process.exit(summarise('First-visit session integrity'));
}

main().catch((error) => { console.error(error); process.exit(1); });
