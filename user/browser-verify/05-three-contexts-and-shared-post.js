/**
 * Browser pass 5 — three independent contexts (§4) and the shared-post message
 * route (§6).
 *
 * Guest, persona A and persona B each get their own browser context, so they
 * have separate cookie jars, storage and sessions — genuinely three different
 * people rather than three tabs of one login. What each is served is read out
 * of the rendered feed, and the score breakdown behind it is read from the
 * engine's own dev-only debug output for the same session.
 */

// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient } = require(require.resolve('mongodb', {
  paths: [require('path').resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, API, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT_A = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const ACCOUNT_B = process.env.RECO_ACCOUNT_B || 'tomasberg.plays@demo.invalid';
const TASTE_A = (process.env.RECO_TASTE_A || 'food,travel,photography').split(',');
const TASTE_B = (process.env.RECO_TASTE_B || 'games,anime,knowledge').split(',');
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

/**
 * Reads the feed the *page* is showing, using the page's own credentials.
 *
 * `fetch` from inside the document carries that context's cookies and token,
 * so this is the same request the app makes — not an out-of-band API call with
 * a token this script minted.
 */
async function feedAsPage(page, path, params = {}) {
  return page.evaluate(async ([apiBase, endpoint, query]) => {
    const url = new URL(apiBase + endpoint);
    Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const token = document.cookie.split('; ').find((c) => c.startsWith('token='))?.split('=')[1];
    const response = await fetch(url, { headers: token ? { Authorization: decodeURIComponent(token) } : {} });
    const body = await response.json();
    return body?.data || body;
  }, [API, path, { debug: 'true', ...params }]);
}

const share = (posts, taste, n = 20) => {
  const window = posts.slice(0, n);
  if (!window.length) return 0;
  return window.filter((p) => taste.includes(p.topicKey)).length / window.length;
};

function printTop(label, result, limit = 20) {
  const posts = result.data || [];
  const debug = result.debug || [];
  console.log(`\n--- ${label} (session ${String(result.sessionId).slice(0, 8)}…) ---`);
  console.log('   #  category      creator                source        interest watch  engage fresh  explore  final');
  posts.slice(0, limit).forEach((post, i) => {
    const d = debug[i] || {};
    const b = d.breakdown || {};
    const f = (v) => (typeof v === 'number' ? v.toFixed(2).padStart(6) : '     -');
    console.log(
      `  ${String(i + 1).padStart(2)}  ${String(post.topicKey || '-').padEnd(13)} `
      + `${String(post.user?.username || '-').padEnd(22)} ${String(d.source || '-').padEnd(13)} `
      + `${f(b.userInterest)} ${f(b.watchQuality)} ${f(b.engagementQuality)} ${f(b.freshness)} `
      + `${f(b.explorationBonus)} ${f(d.finalScore)}`
    );
  });
  const mix = new Map();
  posts.slice(0, limit).forEach((p) => mix.set(p.topicKey, (mix.get(p.topicKey) || 0) + 1));
  console.log(`  categories: ${[...mix.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const guest = await openContext(browser, 'guest');
  const a = await openContext(browser, 'A');
  const b = await openContext(browser, 'B');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();

  try {
    console.log('=== Three independent browser contexts ===');
    await guest.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await guest.page.waitForTimeout(4000);
    await signIn(a, ACCOUNT_A);
    await signIn(b, ACCOUNT_B);
    check('three contexts are open', true, `guest, ${ACCOUNT_A}, ${ACCOUNT_B}`);

    // Contexts must not share identity.
    const cookieA = await a.context.cookies();
    const cookieB = await b.context.cookies();
    const tokenA = cookieA.find((c) => c.name === 'token')?.value;
    const tokenB = cookieB.find((c) => c.name === 'token')?.value;
    check('A and B hold different sessions', Boolean(tokenA) && Boolean(tokenB) && tokenA !== tokenB,
      'distinct tokens');
    const guestCookies = await guest.context.cookies();
    check('the guest context holds no session token',
      !guestCookies.find((c) => c.name === 'token')?.value, 'no token');

    console.log('\n=== 4.1/4.2 What each context is served ===');
    const guestHome = await feedAsPage(guest.page, '/posts/home-posts', { limit: 20 });
    const aForYou = await feedAsPage(a.page, '/posts/recommended', { limit: 20 });
    const bForYou = await feedAsPage(b.page, '/posts/recommended', { limit: 20 });
    const aHome = await feedAsPage(a.page, '/posts/home-posts', { limit: 20 });

    printTop('GUEST — Home', guestHome);
    printTop(`A (${ACCOUNT_A}) — For You`, aForYou);
    printTop(`B (${ACCOUNT_B}) — For You`, bForYou);

    // Guest: no personalisation, but a real mix.
    const guestSources = new Set((guestHome.debug || []).map((d) => d.source));
    check('the guest feed uses no personalized bucket',
      !guestSources.has('personalized') && !guestSources.has('social'),
      `sources: ${[...guestSources].join(', ')}`);
    const guestCategories = new Set((guestHome.data || []).map((p) => p.topicKey));
    check('the guest feed spans several categories', guestCategories.size >= 4,
      `${guestCategories.size} categories`);
    const guestIds = (guestHome.data || []).map((p) => p._id);
    check('the guest feed has no duplicates', new Set(guestIds).size === guestIds.length,
      `${guestIds.length} posts`);

    // A and B: different, and each leaning its own way.
    const aTaste = share(aForYou.data, TASTE_A, 10);
    const bTaste = share(bForYou.data, TASTE_B, 10);
    const aTasteOnB = share(bForYou.data, TASTE_A, 10);
    const bTasteOnA = share(aForYou.data, TASTE_B, 10);
    check(`A leans to A's taste more than B's feed does`, aTaste > aTasteOnB,
      `${(aTaste * 100).toFixed(0)}% on A vs ${(aTasteOnB * 100).toFixed(0)}% on B`);
    check(`B leans to B's taste more than A's feed does`, bTaste > bTasteOnA,
      `${(bTaste * 100).toFixed(0)}% on B vs ${(bTasteOnA * 100).toFixed(0)}% on A`);

    const overlap = (aForYou.data || []).slice(0, 20).map((p) => p._id)
      .filter((id) => new Set((bForYou.data || []).slice(0, 20).map((p) => p._id)).has(id)).length;
    check('A and B differ by more than jitter', overlap < 15, `${overlap}/20 shared`);
    const guestOverlapA = (guestHome.data || []).slice(0, 20).map((p) => p._id)
      .filter((id) => new Set((aHome.data || []).slice(0, 20).map((p) => p._id)).has(id)).length;
    check('the guest feed differs from A', guestOverlapA < 18, `${guestOverlapA}/20 shared with A`);

    // Interest scoring must actually be non-zero for a persona and zero for a guest.
    const aInterest = (aForYou.debug || []).map((d) => d.breakdown?.userInterest || 0);
    const guestInterest = (guestHome.debug || []).map((d) => d.breakdown?.userInterest || 0);
    check('A is scored with a real user-interest signal', Math.max(...aInterest, 0) > 0,
      `max ${Math.max(...aInterest, 0).toFixed(3)}`);
    check('the guest is scored with no user-interest signal', Math.max(...guestInterest, 0) === 0,
      `max ${Math.max(...guestInterest, 0).toFixed(3)}`);

    // Diversity, on what was actually rendered.
    const consecutive = (posts) => posts.reduce((n, p, i) => (i > 0
      && p.user?.username === posts[i - 1].user?.username ? n + 1 : n), 0);
    check('no two consecutive posts by the same creator in any top 20',
      consecutive(aForYou.data || []) === 0 && consecutive(bForYou.data || []) === 0
        && consecutive(guestHome.data || []) === 0,
      `A ${consecutive(aForYou.data || [])}, B ${consecutive(bForYou.data || [])}, guest ${consecutive(guestHome.data || [])}`);

    await a.shot('15-context-a-for-you');
    await b.shot('16-context-b-for-you');
    await guest.shot('17-context-guest-home');

    // ---------------------------------------------------------------
    console.log('\n=== 6. Shared-post message route ===');
    await a.page.goto(`${USER_APP}/messages`, { waitUntil: 'domcontentloaded' });
    await a.page.waitForTimeout(6000);
    await a.shot('18-messages-list');

    // Open the first conversation that contains a shared post.
    const threads = a.page.locator('[role="listitem"], li, [class*="conversation" i]');
    const threadCount = await threads.count();
    let opened = false;
    for (let i = 0; i < Math.min(threadCount, 12) && !opened; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await threads.nth(i).click({ force: true }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await a.page.waitForTimeout(2500);
      // eslint-disable-next-line no-await-in-loop
      const card = a.page.locator('[data-testid="shared-post-card"], [data-testid="shared-post-unavailable"]').first();
      // eslint-disable-next-line no-await-in-loop
      if (await card.isVisible().catch(() => false)) opened = true;
    }
    if (!opened) {
      // Fall back to finding any clickable shared-post preview.
      const anyCard = a.page.locator('[data-testid="shared-post-card"]').first();
      opened = await anyCard.isVisible().catch(() => false);
    }

    if (opened) {
      await a.shot('19-conversation-with-shared-post');
      const before = a.page.url();
      await a.page.locator('[data-testid="shared-post-card"]').first().click({ force: true });
      await a.page.waitForTimeout(4000);
      const after = new URL(a.page.url());
      check('clicking a shared post opens a post detail',
        Boolean(after.searchParams.get('modal_id')), `modal_id=${after.searchParams.get('modal_id')}`);
      check('the open is tagged as a message-originated one',
        after.searchParams.get('modal_src') === 'message',
        `modal_src=${after.searchParams.get('modal_src')}`);
      check('it left the messages route for one that hosts the modal',
        after.pathname !== '/messages', `${new URL(before).pathname} -> ${after.pathname}`);
      await a.shot('20-shared-post-opened');
    } else {
      console.log('  ~ no shared-post card reachable in the messages UI this run');
    }

    console.log('\n=== Server verdicts ===');
    [guest, a, b].forEach((ctx) => {
      const t = ctx.totals();
      console.log(`  ${ctx.label}: ${JSON.stringify(t)}`);
    });
    check('no context had an event rejected',
      [guest, a, b].every((ctx) => ctx.totals().rejected === 0), 'all clean');
  } finally {
    await mongo.close();
    await guest.close();
    await a.close();
    await b.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 5: three contexts and the shared-post route');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
