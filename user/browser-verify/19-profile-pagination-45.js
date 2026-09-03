/**
 * Profile pagination against a creator with more posts than one page.
 *
 * The seeded catalogue gives every creator exactly 10 posts against a 20-post
 * page size, so the grid is a single page and none of this could be observed:
 * whether `IntersectionObserver` actually calls `loadMore`, whether the page-two
 * cursor works, whether page two stays scoped to the creator, and whether a
 * pending page for the creator being left is dropped. `api/scripts/
 * profile-pagination-fixture.js` creates one 45-post creator for exactly that,
 * and records its ids for cleanup.
 *
 * Every `/posts/creator-posts` request is captured with its scope, cursor and
 * the creator of every row it returned.
 */

const fs = require('fs');
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
const LEDGER = path.resolve(__dirname, '..', '..', 'output', 'profile-fixture.json');

function trace(ctx) {
  const calls = [];
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
    if (!/\/posts\/(creator-posts|home-posts)|\/creator\/posts/.test(url)) return;
    const parsed = new URL(url);
    const row = {
      route: parsed.pathname,
      userId: parsed.searchParams.get('userId'),
      limit: parsed.searchParams.get('limit'),
      cursor: parsed.searchParams.get('cursor'),
      lastCreatedAt: parsed.searchParams.get('lastCreatedAt'),
      lastIsPinned: parsed.searchParams.get('lastIsPinned'),
      status: response.status()
    };
    try {
      const json = await response.json();
      const data = json?.data;
      row.ids = (data?.data || []).map((post) => post._id);
      row.creators = [...new Set((data?.data || []).map((post) => post.user?._id))];
      row.pinned = (data?.data || []).map((post) => Boolean(post.isPinned));
      row.hasMore = data?.hasMore;
    } catch { /* not JSON */ }
    calls.push(row);
  });
  return { calls, logs };
}

const tiles = (page) => page.evaluate(() => Array.from(document.querySelectorAll('li[data-post-id]'))
  .map((node) => ({
    postId: node.getAttribute('data-post-id'),
    creatorId: node.getAttribute('data-creator-id'),
    hasVideo: Boolean(node.querySelector('video')),
    pinned: Boolean(node.querySelector('[data-pinned-badge], .post-pinned-badge'))
  })));

/**
 * Scrolls the profile's own scroll container.
 *
 * Not the window: this page keeps its content in an `overflow-auto` column, so
 * `document.body` never scrolls and `window.scrollTo` is a no-op — a harness
 * that scrolled the window reported the grid as stuck at 20 tiles when nothing
 * had been asked to scroll at all. Jiggled up and back down so a scroll event
 * fires every round even when already at the bottom.
 */
async function scrollProfile(page, rounds = 20) {
  const move = (toBottom) => page.evaluate((bottom) => {
    Array.from(document.querySelectorAll('*'))
      .filter((el) => el.scrollHeight > el.clientHeight + 50
        && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      .forEach((el) => {
        el.scrollTop = bottom ? el.scrollHeight : Math.max(0, el.scrollHeight - el.clientHeight - 400);
      });
  }, toBottom);

  let previous = -1;
  let stable = 0;
  const seen = [];
  for (let round = 0; round < rounds && stable < 3; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await move(false);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(150);
    // eslint-disable-next-line no-await-in-loop
    await move(true);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1700);
    // eslint-disable-next-line no-await-in-loop
    const count = (await tiles(page)).length;
    seen.push(count);
    if (count === previous) stable += 1; else stable = 0;
    previous = count;
  }
  return seen;
}

/** The canonical listing, straight from the API, in the creator's own order. */
async function canonical(page, creatorId) {
  return page.evaluate(async ({ api, id }) => {
    const all = [];
    let cursor = null;
    for (let index = 0; index < 30; index += 1) {
      const params = new URLSearchParams({
        userId: id, limit: '20', sortBy: 'createdAt', sort: 'desc'
      });
      if (cursor) {
        params.set('cursor', cursor.id);
        params.set('lastCreatedAt', new Date(cursor.createdAt).toISOString());
        if (typeof cursor.isPinned === 'boolean') params.set('lastIsPinned', String(cursor.isPinned));
        if (cursor.pinnedAt) params.set('lastPinnedAt', new Date(cursor.pinnedAt).toISOString());
      }
      // eslint-disable-next-line no-await-in-loop
      const response = await fetch(`${api}/posts/creator-posts?${params.toString()}`, { credentials: 'omit' });
      // eslint-disable-next-line no-await-in-loop
      const json = await response.json();
      const body = json?.data;
      (body?.data || []).forEach((post) => all.push(post._id));
      if (!body?.hasMore || !body?.nextCursor) break;
      cursor = body.nextCursor;
    }
    return all;
  }, { api: API, id: creatorId });
}

async function main() {
  if (!fs.existsSync(LEDGER)) {
    console.error(`No fixture. Run: node api/scripts/profile-pagination-fixture.js --create`);
    process.exit(1);
  }
  const fixture = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    const creator = await db.collection('users').findOne({ _id: new ObjectId(fixture.userId) });
    const expected = await db.collection('posts')
      .find({ userId: creator._id, status: 'active' })
      .sort({ isPinned: -1, pinnedAt: -1, createdAt: -1, _id: -1 })
      .project({ _id: 1, type: 1, isPinned: 1 })
      .toArray();
    console.log(`\nfixture creator @${creator.username} (${creator._id}) with ${expected.length} posts`);
    console.log(`  types: ${expected.filter((p) => p.type === 'video').length} video, ${expected.filter((p) => p.type === 'photo').length} photo`);
    console.log(`  pinned: ${expected.filter((p) => p.isPinned).length}`);

    // ---------------------------------------------------------------
    console.log('\n=== Account A viewing the fixture profile ===');
    const ctx = await openContext(browser, 'A-views-fixture');
    const probe = trace(ctx);
    await signIn(ctx, ACCOUNT_A);
    await ctx.page.goto(`${USER_APP}/${creator.username}`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('li[data-post-id]').first().waitFor({ state: 'visible', timeout: 30000 });
    await ctx.page.waitForTimeout(1200);

    const firstPage = await tiles(ctx.page);
    console.log(`  first page: ${firstPage.length} tiles`);
    const growth = await scrollProfile(ctx.page);
    const finalTiles = await tiles(ctx.page);
    console.log(`  tile count after each scroll round: ${growth.join(' -> ')}`);

    const creatorCalls = probe.calls.filter((row) => row.route === '/posts/creator-posts');
    console.log('  /posts/creator-posts requests:');
    creatorCalls.forEach((row, index) => console.log(
      `    ${index + 1}. userId=${String(row.userId).slice(-6)} limit=${row.limit} cursor=${row.cursor}`
      + ` lastIsPinned=${row.lastIsPinned} -> ${row.ids?.length} rows,`
      + ` creators=${JSON.stringify((row.creators || []).map((id) => String(id).slice(-6)))}, hasMore=${row.hasMore}`
    ));

    const creatorId = creator._id.toString();
    const rendered = finalTiles.map((tile) => tile.postId);
    const expectedIds = expected.map((post) => post._id.toString());
    const canonicalIds = await canonical(ctx.page, creatorId);

    check('the first page returned 20 posts', firstPage.length === 20, `${firstPage.length}`);
    check('scrolling triggered real page-two and page-three requests',
      creatorCalls.length >= 2, `${creatorCalls.length} client requests`);
    check('the grid grew 20 -> 40 -> 45',
      growth.includes(40) && finalTiles.length === 45,
      `${growth.join(' -> ')} (final ${finalTiles.length})`);
    check('every request was scoped to the fixture creator',
      creatorCalls.every((row) => row.userId === creatorId),
      JSON.stringify([...new Set(creatorCalls.map((row) => row.userId))]));
    check('every request after the first carried the previous cursor',
      creatorCalls.slice(1).every((row) => Boolean(row.cursor) && Boolean(row.lastCreatedAt)),
      JSON.stringify(creatorCalls.map((row) => row.cursor)));
    check('every returned row belongs to the fixture creator',
      creatorCalls.every((row) => (row.creators || []).every((id) => id === creatorId)),
      JSON.stringify([...new Set(creatorCalls.flatMap((row) => row.creators || []))]));
    check('no request went to the viewer\'s own listing',
      probe.calls.every((row) => !row.route.startsWith('/creator/posts')),
      `${probe.calls.filter((row) => row.route.startsWith('/creator/posts')).length} myPosts calls`);
    check('45 distinct tiles, no duplicate', new Set(rendered).size === 45,
      `${rendered.length} tiles, ${new Set(rendered).size} distinct`);
    check('nothing missing against the canonical listing',
      canonicalIds.length === 45 && canonicalIds.every((id) => rendered.includes(id)),
      `${canonicalIds.filter((id) => !rendered.includes(id)).length} missing of ${canonicalIds.length}`);
    check('the rendered order matches the canonical pinned-first order',
      rendered.join() === expectedIds.join(),
      `${rendered.slice(0, 3).join(',')} vs ${expectedIds.slice(0, 3).join(',')}`);
    check('every tile is the fixture creator\'s',
      finalTiles.every((tile) => !tile.creatorId || tile.creatorId === creatorId),
      JSON.stringify([...new Set(finalTiles.map((tile) => tile.creatorId))].map((id) => String(id).slice(-6))));
    check('hasMore was only false on the last page',
      creatorCalls.length > 0
        && creatorCalls.slice(0, -1).every((row) => row.hasMore === true)
        && creatorCalls[creatorCalls.length - 1].hasMore === false,
      JSON.stringify(creatorCalls.map((row) => row.hasMore)));

    const pinnedFlags = expectedIds.map((id) => Boolean(expected.find((p) => p._id.toString() === id)?.isPinned));
    const firstUnpinned = pinnedFlags.indexOf(false);
    check('pinned posts lead the grid and appear exactly once',
      firstUnpinned === expected.filter((p) => p.isPinned).length
        && !pinnedFlags.slice(firstUnpinned).includes(true),
      `${expected.filter((p) => p.isPinned).length} pinned, first unpinned at ${firstUnpinned}`);
    const renderedPinned = rendered.slice(0, 2);
    check('the pinned posts are rendered in the first two tiles',
      renderedPinned.every((id) => expected.find((p) => p._id.toString() === id)?.isPinned),
      JSON.stringify(renderedPinned));

    const photoTiles = finalTiles.filter((_, index) => expected[index]?.type === 'photo').length;
    check('both photo and video posts are present in the grid',
      photoTiles > 0 && photoTiles < finalTiles.length, `${photoTiles} photo of ${finalTiles.length}`);
    // Read the rendered text rather than asking Playwright whether the node is
    // "visible": the end-of-list line sits below 45 tiles inside a scroll
    // container, and visibility there is about viewport intersection, not about
    // whether the grid has finished.
    const endOfList = await ctx.page.evaluate(() => ({
      noMore: /No more for now/i.test(document.body.innerText),
      loading: /Loading more/i.test(document.body.innerText)
    }));
    check('"No more for now" is shown only once the last page has arrived',
      endOfList.noMore && !endOfList.loading, JSON.stringify(endOfList));
    check('profile console is clean', probe.logs.length === 0, probe.logs.slice(0, 3).join(' | '));
    await ctx.shot('60-fixture-profile-45-loaded');
    await ctx.close();

    // ---------------------------------------------------------------
    console.log('\n=== Guest viewing the fixture profile ===');
    const guest = await openContext(browser, 'guest-views-fixture');
    const guestProbe = trace(guest);
    await guest.page.goto(`${USER_APP}/${creator.username}`, { waitUntil: 'domcontentloaded' });
    await guest.page.locator('li[data-post-id]').first().waitFor({ state: 'visible', timeout: 30000 });
    await scrollProfile(guest.page);
    const guestTiles = await tiles(guest.page);
    console.log(`  guest tiles: ${guestTiles.length}`);
    check('a guest also pages the full 45', guestTiles.length === 45, `${guestTiles.length}`);
    check('and every tile is the creator\'s',
      guestTiles.every((tile) => !tile.creatorId || tile.creatorId === creatorId), 'ok');
    check('a guest never calls the owner listing',
      guestProbe.calls.every((row) => !row.route.startsWith('/creator/posts')), 'ok');
    check('guest console is clean', guestProbe.logs.length === 0, guestProbe.logs.slice(0, 3).join(' | '));
    await guest.close();

    // ---------------------------------------------------------------
    console.log('\n=== The fixture creator viewing their own profile ===');
    const own = await openContext(browser, 'fixture-views-own');
    const ownProbe = trace(own);
    await signIn(own, 'fixture.pagination@fixture.invalid');
    await own.page.goto(`${USER_APP}/${creator.username}`, { waitUntil: 'domcontentloaded' });
    await own.page.locator('li[data-post-id]').first().waitFor({ state: 'visible', timeout: 30000 });
    await scrollProfile(own.page);
    const ownTiles = await tiles(own.page);
    console.log(`  own tiles: ${ownTiles.length}`);
    const ownCreatorCalls = ownProbe.calls.filter((row) => row.route === '/posts/creator-posts');
    check('the owner pages their own profile through the creator route',
      ownTiles.length === 45 && ownCreatorCalls.length >= 2,
      `${ownTiles.length} tiles, ${ownCreatorCalls.length} creator requests`);
    check('and every tile is theirs',
      ownTiles.every((tile) => !tile.creatorId || tile.creatorId === creatorId), 'ok');
    check('own-profile console is clean', ownProbe.logs.length === 0, ownProbe.logs.slice(0, 3).join(' | '));
    await own.shot('61-fixture-profile-own');
    await own.close();

    // ---------------------------------------------------------------
    console.log('\n=== Race: page two of the fixture, then straight to another creator ===');
    const race = await openContext(browser, 'race');
    const raceProbe = trace(race);
    await signIn(race, ACCOUNT_A);
    const other = await db.collection('users').findOne({ username: 'kai.wanders' });
    const otherId = other._id.toString();

    // Hold the fixture's *next page* open so it is guaranteed in flight when
    // the viewer navigates away.
    await race.page.route('**/posts/creator-posts*', async (route) => {
      const url = route.request().url();
      if (url.includes(creatorId) && url.includes('cursor=')) {
        await new Promise((resolve) => { setTimeout(resolve, 4000); });
      }
      await route.continue();
    });

    await race.page.goto(`${USER_APP}/${creator.username}`, { waitUntil: 'domcontentloaded' });
    await race.page.locator('li[data-post-id]').first().waitFor({ state: 'visible', timeout: 30000 });
    // Trigger page two, then leave immediately.
    await race.page.evaluate(() => Array.from(document.querySelectorAll('*'))
      .filter((el) => el.scrollHeight > el.clientHeight + 50
        && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY))
      .forEach((el) => { el.scrollTop = el.scrollHeight; }));
    await race.page.waitForTimeout(700);
    await race.page.goto(`${USER_APP}/${other.username}`, { waitUntil: 'domcontentloaded' });
    await race.page.locator('li[data-post-id]').first().waitFor({ state: 'visible', timeout: 30000 });
    await race.page.waitForTimeout(7000);
    const raceTiles = await tiles(race.page);
    const raceCreators = [...new Set(raceTiles.map((tile) => tile.creatorId))];
    console.log(`  after the switch: ${raceTiles.length} tiles, creators=${JSON.stringify(raceCreators.map((id) => String(id).slice(-6)))}`);
    const afterSwitch = raceProbe.calls.filter((row) => row.route === '/posts/creator-posts');
    afterSwitch.forEach((row, index) => console.log(
      `    ${index + 1}. userId=${String(row.userId).slice(-6)} cursor=${row.cursor} -> ${row.ids?.length} rows`
    ));
    check('the in-flight page for the previous creator never lands in the new grid',
      raceTiles.length > 0 && raceTiles.every((tile) => !tile.creatorId || tile.creatorId === otherId),
      `expected ${otherId.slice(-6)}, saw ${JSON.stringify(raceCreators.map((id) => String(id).slice(-6)))}`);
    check('no fixture post appears on the other creator\'s profile',
      !raceTiles.some((tile) => expectedIds.includes(tile.postId)),
      `${raceTiles.filter((tile) => expectedIds.includes(tile.postId)).length} leaked`);
    check('any request made after the switch is scoped to the new creator',
      afterSwitch.filter((row) => row.cursor).every((row) => row.userId === creatorId || row.userId === otherId),
      JSON.stringify(afterSwitch.map((row) => String(row.userId).slice(-6))));
    check('race console is clean', raceProbe.logs.length === 0, raceProbe.logs.slice(0, 3).join(' | '));
    await race.shot('62-fixture-profile-race');
    await race.close();
  } finally {
    await mongo.close();
    await browser.close();
  }

  process.exit(summarise('Profile pagination (45-post fixture)'));
}

main().catch((error) => { console.error(error); process.exit(1); });
