/**
 * Creator profile listing — reproduction and acceptance.
 *
 * Records what the profile grid actually requests, with URLs, query strings,
 * cursors and the creator each returned post belongs to. DOM alone cannot
 * answer "did this page ask the right endpoint with the right scope", which is
 * the whole question here.
 *
 * Run with MODE=before to capture the pre-fix behaviour, MODE=after for the
 * acceptance pass.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, API, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT_A = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';
const MODE = process.env.MODE || 'after';

/** Every post-listing request the page makes, with its scope and its answer. */
function traceListings(ctx) {
  const calls = [];
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
    if (!/\/posts\/(creator-posts|home-posts|recommended)|\/creator\/posts/.test(url)) return;
    const parsed = new URL(url);
    const row = {
      path: parsed.pathname,
      query: Object.fromEntries(parsed.searchParams.entries()),
      status: response.status()
    };
    try {
      const json = await response.json();
      const data = json?.data;
      row.ids = (data?.data || []).map((post) => post._id);
      row.creators = [...new Set((data?.data || []).map((post) => post.user?._id))];
      row.pinned = (data?.data || []).map((post) => Boolean(post.isPinned));
      row.hasMore = data?.hasMore;
      row.nextCursor = data?.nextCursor;
    } catch { /* not JSON */ }
    calls.push(row);
  });
  return { calls, logs };
}

/** The canonical listing for one creator, straight from the API, paged small. */
async function canonicalListing(page, creatorId, limit) {
  return page.evaluate(async ({ api, id, size }) => {
    const pages = [];
    let cursor = null;
    for (let index = 0; index < 20; index += 1) {
      const params = new URLSearchParams({
        userId: id, limit: String(size), sortBy: 'createdAt', sort: 'desc'
      });
      if (cursor) {
        params.set('cursor', cursor.id);
        params.set('lastCreatedAt', new Date(cursor.createdAt).toISOString());
        if (typeof cursor.isPinned === 'boolean') params.set('lastIsPinned', String(cursor.isPinned));
        if (cursor.pinnedAt) params.set('lastPinnedAt', new Date(cursor.pinnedAt).toISOString());
      }
      const url = `${api}/posts/creator-posts?${params.toString()}`;
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(url, { credentials: 'omit' });
      // eslint-disable-next-line no-await-in-loop
      const json = await response.json();
      const body = json?.data;
      pages.push({
        url: url.replace(api, ''),
        status: response.status,
        ids: (body?.data || []).map((post) => post._id),
        creators: [...new Set((body?.data || []).map((post) => post.user?._id))],
        pinned: (body?.data || []).map((post) => Boolean(post.isPinned)),
        hasMore: body?.hasMore,
        nextCursor: body?.nextCursor
      });
      if (!body?.hasMore || !body?.nextCursor) break;
      cursor = body.nextCursor;
    }
    return pages;
  }, { api: API, id: creatorId, size: limit });
}

/** Post ids as the profile grid rendered them, with the creator each belongs to. */
function gridState(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('[data-post-id]'))
    .map((node) => ({
      postId: node.getAttribute('data-post-id'),
      creatorId: node.getAttribute('data-creator-id')
    }))
    .filter((row) => row.postId));
}

async function scrollToBottom(page, times = 4) {
  for (let index = 0; index < times; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1800);
  }
}

async function viewProfile(browser, db, { label, signedIn, username }) {
  const ctx = await openContext(browser, label);
  const probe = traceListings(ctx);
  const creator = await db.collection('users').findOne({ username });
  const creatorId = creator._id.toString();
  const expected = await db.collection('posts')
    .find({ userId: creator._id, status: 'active' })
    .sort({ isPinned: -1, pinnedAt: -1, createdAt: -1, _id: -1 })
    .toArray();

  if (signedIn) await signIn(ctx, signedIn);
  await ctx.page.goto(`${USER_APP}/${username}`, { waitUntil: 'domcontentloaded' });
  await ctx.page.locator('[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
  await ctx.page.waitForTimeout(1500);

  const firstPage = await gridState(ctx.page);
  await scrollToBottom(ctx.page);
  const afterScroll = await gridState(ctx.page);

  return {
    ctx, probe, creator, creatorId, expected, firstPage, afterScroll
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    // ---------------------------------------------------------------
    console.log(`\n=== Account A viewing creator B's profile (${MODE}) ===`);
    const b = await viewProfile(browser, db, {
      label: 'A-views-B', signedIn: ACCOUNT_A, username: 'iris.inthefield'
    });
    const viewer = await db.collection('users').findOne({ email: ACCOUNT_A });
    const viewerId = viewer._id.toString();

    console.log(`  viewer (account A) : ${viewerId} @${viewer.username}`);
    console.log(`  profile creator B  : ${b.creatorId} @iris.inthefield`);
    console.log(`  creator B posts    : ${b.expected.length}`);
    console.log(`  first page rendered: ${b.firstPage.length} tiles`);
    console.log(`  after 4 scrolls    : ${b.afterScroll.length} tiles`);
    console.log('  listing requests the page made:');
    b.probe.calls.forEach((row) => console.log(
      `    ${row.status} ${row.path}?${new URLSearchParams(row.query).toString()}`
      + ` -> ${row.ids ? row.ids.length : '?'} posts, creators=${JSON.stringify(row.creators)}`
      + ` hasMore=${row.hasMore}`
    ));

    const ownerRouteCalls = b.probe.calls.filter((row) => row.path.startsWith('/creator/posts'));
    check("no request for B's profile goes to the viewer's own listing",
      ownerRouteCalls.length === 0,
      `${ownerRouteCalls.length} call(s) to /creator/posts`);

    const feedRouteCalls = b.probe.calls.filter((row) => row.path === '/posts/home-posts');
    check("no request for B's profile goes to the Home recommendation feed",
      feedRouteCalls.length === 0, `${feedRouteCalls.length} call(s)`);

    const strangerTiles = b.afterScroll.filter((tile) => tile.creatorId && tile.creatorId !== b.creatorId);
    check('every tile on B\'s profile belongs to B',
      strangerTiles.length === 0,
      strangerTiles.length ? `${strangerTiles.length} foreign tiles: ${JSON.stringify(strangerTiles.slice(0, 3))}` : 'all B');

    const renderedIds = b.afterScroll.map((tile) => tile.postId);
    check('the grid has no duplicate', new Set(renderedIds).size === renderedIds.length,
      `${renderedIds.length} tiles, ${new Set(renderedIds).size} distinct`);
    check('the grid holds every post B has, none missing',
      new Set(renderedIds).size === b.expected.length,
      `${new Set(renderedIds).size} of ${b.expected.length}`);
    check('pinned posts lead the grid, in the canonical order',
      renderedIds.join() === b.expected.map((post) => post._id.toString()).join(),
      `rendered ${renderedIds.slice(0, 3).join(',')} vs canonical ${b.expected.slice(0, 3).map((p) => p._id.toString()).join(',')}`);
    await b.ctx.shot(`50-profile-${MODE}-A-views-B`);

    // ---------------------------------------------------------------
    console.log('\n=== Multi-page cursor walk against the canonical route ===');
    // The seeded catalogue gives every creator 10 posts against a 20-post page
    // size, so the profile grid is genuinely one page in production. Cursor
    // behaviour across pages is therefore exercised with an explicit small
    // limit, through the same route and contract the grid uses.
    const pages = await canonicalListing(b.ctx.page, b.creatorId, 3);
    pages.forEach((page, index) => console.log(
      `  page ${index + 1}: ${page.status} ${page.url}\n`
      + `    ids=${page.ids.join(',')} creators=${JSON.stringify(page.creators)} pinned=${JSON.stringify(page.pinned)} hasMore=${page.hasMore}`
    ));
    const walked = pages.flatMap((page) => page.ids);
    check('paging the creator route never leaves the creator',
      pages.every((page) => page.creators.length <= 1 && (!page.creators[0] || page.creators[0] === b.creatorId)),
      JSON.stringify([...new Set(pages.flatMap((page) => page.creators))]));
    check('paging returns every post exactly once', new Set(walked).size === walked.length && walked.length === b.expected.length,
      `${walked.length} rows, ${new Set(walked).size} distinct, ${b.expected.length} expected`);
    check('paged order matches the canonical pinned-first order',
      walked.join() === b.expected.map((post) => post._id.toString()).join(),
      `${walked.slice(0, 4).join(',')} vs ${b.expected.slice(0, 4).map((p) => p._id.toString()).join(',')}`);
    const pinnedFlags = pages.flatMap((page) => page.pinned);
    const firstUnpinned = pinnedFlags.indexOf(false);
    check('no pinned post reappears after the unpinned block starts',
      firstUnpinned < 0 || !pinnedFlags.slice(firstUnpinned).includes(true),
      JSON.stringify(pinnedFlags));
    check('profile console is clean', b.probe.logs.length === 0, b.probe.logs.slice(0, 3).join(' | '));
    await b.ctx.close();

    // ---------------------------------------------------------------
    console.log('\n=== Guest viewing creator B ===');
    const guest = await viewProfile(browser, db, {
      label: 'guest-views-B', signedIn: null, username: 'sofia.builds'
    });
    console.log(`  creator: ${guest.creatorId}  tiles: ${guest.afterScroll.length}`);
    guest.probe.calls.forEach((row) => console.log(
      `    ${row.status} ${row.path}?${new URLSearchParams(row.query).toString()} -> creators=${JSON.stringify(row.creators)}`
    ));
    check('a guest sees only that creator\'s posts',
      guest.afterScroll.length > 0 && guest.afterScroll.every((tile) => !tile.creatorId || tile.creatorId === guest.creatorId),
      `${guest.afterScroll.length} tiles`);
    check('a guest\'s profile view never calls the owner listing',
      guest.probe.calls.every((row) => !row.path.startsWith('/creator/posts')), 'ok');
    check('a guest gets the creator\'s whole list',
      new Set(guest.afterScroll.map((t) => t.postId)).size === guest.expected.length,
      `${new Set(guest.afterScroll.map((t) => t.postId)).size} of ${guest.expected.length}`);
    check('guest profile console is clean', guest.probe.logs.length === 0, guest.probe.logs.slice(0, 3).join(' | '));
    await guest.ctx.shot(`51-profile-${MODE}-guest-views-B`);
    await guest.ctx.close();

    // ---------------------------------------------------------------
    console.log('\n=== Account A viewing their own profile ===');
    const own = await viewProfile(browser, db, {
      label: 'A-views-A', signedIn: ACCOUNT_A, username: viewer.username
    });
    console.log(`  own profile tiles: ${own.afterScroll.length} of ${own.expected.length}`);
    own.probe.calls.forEach((row) => console.log(
      `    ${row.status} ${row.path}?${new URLSearchParams(row.query).toString()} -> creators=${JSON.stringify(row.creators)}`
    ));
    check('the owner sees their own complete list',
      new Set(own.afterScroll.map((t) => t.postId)).size === own.expected.length,
      `${new Set(own.afterScroll.map((t) => t.postId)).size} of ${own.expected.length}`);
    check('and every tile is theirs',
      own.afterScroll.every((tile) => !tile.creatorId || tile.creatorId === own.creatorId), 'ok');
    await own.ctx.shot(`52-profile-${MODE}-A-views-own`);
    await own.ctx.close();

    // ---------------------------------------------------------------
    console.log('\n=== Switching B -> C while B is still loading ===');
    const ctx = await openContext(browser, 'switch');
    const probe = traceListings(ctx);
    await signIn(ctx, ACCOUNT_A);
    const creatorB = await db.collection('users').findOne({ username: 'iris.inthefield' });
    const creatorC = await db.collection('users').findOne({ username: 'kai.wanders' });
    // Slow B's listing down so its response is guaranteed to be in flight when
    // the viewer navigates away.
    await ctx.page.route(`**/posts/creator-posts*`, async (route) => {
      const url = route.request().url();
      if (url.includes(creatorB._id.toString())) {
        await new Promise((resolve) => { setTimeout(resolve, 3000); });
      }
      await route.continue();
    });
    await ctx.page.goto(`${USER_APP}/iris.inthefield`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(400);
    await ctx.page.goto(`${USER_APP}/kai.wanders`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('[data-post-id]').first().waitFor({ state: 'visible', timeout: 30000 });
    await ctx.page.waitForTimeout(6000);
    const switched = await gridState(ctx.page);
    const cId = creatorC._id.toString();
    console.log(`  after B -> C: ${switched.length} tiles, creators=${JSON.stringify([...new Set(switched.map((t) => t.creatorId))])}`);
    check('a slow response for the previous creator never lands in the new grid',
      switched.length > 0 && switched.every((tile) => !tile.creatorId || tile.creatorId === cId),
      `expected ${cId}`);
    check('switch console is clean', probe.logs.length === 0, probe.logs.slice(0, 3).join(' | '));
    await ctx.shot(`53-profile-${MODE}-switch-b-to-c`);
    await ctx.close();
  } finally {
    await mongo.close();
    await browser.close();
  }

  process.exit(summarise(`Creator profile listing (${MODE})`));
}

main().catch((error) => { console.error(error); process.exit(1); });
