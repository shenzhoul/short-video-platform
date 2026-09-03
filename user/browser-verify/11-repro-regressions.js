/**
 * Reproduction pass for the four manually-reported regressions.
 *
 * This script does not assert a fix. It records, from a real production build
 * driven by real gestures, exactly what the reporter saw — URL, login state,
 * session id, cursor, current post/creator, sequence ids, API traffic and
 * console errors — so the root-cause work has evidence rather than a
 * screenshot.
 *
 *   R1  For You renders <video src=""> and logs a React error
 *   R2  Home reload keeps the same first post; the rest only change position
 *   R3  Post Detail recommendation runs out after ~3 posts
 *   R4  The Videos tab shows one creator's header over another creator's grid
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

/** Console errors/warnings, and every recommendation-related response. */
function instrument(ctx) {
  const logs = [];
  const api = [];
  ctx.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    logs.push(`[${message.type()}] ${message.text().slice(0, 400)}`);
  });
  ctx.page.on('pageerror', (error) => logs.push(`[pageerror] ${String(error).slice(0, 400)}`));
  ctx.page.on('response', async (response) => {
    const url = response.url();
    if (!/\/posts\//.test(url)) return;
    if (/recommendation-events/.test(url)) return;
    try {
      const json = await response.json();
      const data = json?.data;
      api.push({
        url: url.replace(/^https?:\/\/[^/]+/, '').slice(0, 160),
        status: response.status(),
        sessionId: data?.sessionId,
        nextCursor: typeof data?.nextCursor === 'string' ? data.nextCursor.slice(0, 24) : data?.nextCursor,
        postId: data?.postId,
        ids: Array.isArray(data?.data) ? data.data.map((post) => post._id) : undefined,
        creators: Array.isArray(data?.data) ? data.data.map((post) => post.user?._id) : undefined
      });
    } catch { /* not JSON */ }
  });
  return { logs, api };
}

/**
 * What the For You stage is rendering right now.
 *
 * React 19 refuses to set `src=""` — it drops the attribute and warns instead —
 * so in a production build the defect does not show up as `src=""` in the DOM.
 * What it shows up as is a mounted `<video>` with *no source at all* over a post
 * that has no video to play. `data-video-id` on the element is `for-you-<postId>`,
 * which is what ties the element back to the post the stage chose to draw.
 */
async function stageState(page) {
  return page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video[data-video-id]'));
    return {
      url: window.location.href,
      videos: videos.map((video) => {
        const attribute = video.getAttribute('src');
        return {
          videoId: video.getAttribute('data-video-id'),
          src: attribute === null ? null : attribute,
          srcState: attribute === null ? 'ABSENT' : (attribute.trim() === '' ? 'EMPTY-STRING' : 'ok')
        };
      })
    };
  });
}

async function reproForYou(browser, db, signedIn) {
  const label = signedIn ? 'A' : 'guest';
  console.log(`\n########## R1  For You — ${signedIn ? 'authenticated' : 'guest'} ##########`);
  const ctx = await openContext(browser, label);
  const probe = instrument(ctx);
  try {
    if (signedIn) await signIn(ctx, ACCOUNT);
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(6000);

    console.log(`  URL            : ${ctx.page.url()}`);
    console.log(`  login          : ${signedIn ? ACCOUNT : 'guest (no session)'}`);
    console.log(`  API seen       : ${probe.api.map((row) => `${row.status} ${row.url}`).join(' | ') || '(first page is SSR)'}`);

    /** Resolve a stage post id to what the database says its media actually is. */
    const classify = async (postId) => {
      if (!postId) return null;
      const post = await db.collection('posts').findOne({ _id: new ObjectId(postId) }, { projection: { type: 1, mediaTypes: 1, userId: 1 } });
      const media = await db.collection('post_media').find({ postId: new ObjectId(postId) }).project({ mediaType: 1 }).toArray();
      const types = media.map((row) => row.mediaType);
      return {
        type: post?.type,
        mediaTypes: post?.mediaTypes,
        mediaRowTypes: types,
        hasVideo: types.some((row) => String(row).toLowerCase().includes('video'))
      };
    };

    const walk = [];
    let firstBroken = -1;
    for (let step = 0; step <= 25; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const state = await stageState(ctx.page);
      const element = state.videos[0];
      const postId = element?.videoId?.replace(/^for-you-/, '');
      // eslint-disable-next-line no-await-in-loop
      const media = await classify(postId);
      const broken = Boolean(element) && element.srcState !== 'ok';
      walk.push({
        step, postId, srcState: element?.srcState, media
      });
      console.log(`  step ${step}: post=${postId} src=${element?.srcState} dbType=${media?.type} mediaRows=${JSON.stringify(media?.mediaRowTypes)} hasVideo=${media?.hasVideo}`);
      if (broken && firstBroken < 0) {
        firstBroken = step;
        console.log(`  >>> REPRODUCED at step ${step}: a <video> is mounted for a post whose media is ${JSON.stringify(media?.mediaRowTypes)}`);
        // eslint-disable-next-line no-await-in-loop
        await ctx.shot(`31-repro-for-you-broken-stage-${label}`);
      }
      if (firstBroken >= 0 && step >= firstBroken + 1) break;
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.keyboard.press('ArrowDown');
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1100);
    }
    if (firstBroken < 0) console.log('  no broken stage within 25 steps');
    console.log(`  console: ${probe.logs.length} error/warning`);
    probe.logs.slice(0, 10).forEach((line) => console.log(`     ${line}`));
    await ctx.shot(`30-repro-for-you-${label}`);
    return { firstBroken, consoleErrors: probe.logs.length, walk };
  } finally {
    await ctx.close();
  }
}

/** Ordered post ids as the Home grid actually rendered them. */
function gridOrder(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('article[data-post-id]'))
    .map((node) => node.getAttribute('data-post-id')));
}

async function reproHomeReload(browser, rounds = 10) {
  console.log('\n########## R2  Home reload novelty — guest ##########');
  const ctx = await openContext(browser, 'guest');
  instrument(ctx);
  const sessions = [];
  try {
    for (let round = 0; round < rounds; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1200);
      // eslint-disable-next-line no-await-in-loop
      const ids = await gridOrder(ctx.page);
      sessions.push({ round: round + 1, first: ids[0], top10: ids.slice(0, 10), all: ids });
      console.log(`  reload ${round + 1}: rendered=${ids.length}  first=${ids[0]}`);
      console.log(`             top10=${ids.slice(0, 10).join(' ')}`);
    }

    const firsts = sessions.map((row) => row.first);
    const distinctFirst = new Set(firsts);
    console.log(`\n  distinct first posts over ${rounds} reloads: ${distinctFirst.size}`);
    console.log(`  firsts: ${firsts.join(' ')}`);
    for (let i = 1; i < sessions.length; i += 1) {
      const previous = new Set(sessions[i - 1].top10);
      const overlap = sessions[i].top10.filter((id) => previous.has(id)).length;
      const same = sessions[i].top10.join(',') === sessions[i - 1].top10.join(',');
      console.log(`  reload ${i} -> ${i + 1}: top-10 overlap ${overlap}/10  identical order: ${same}`);
    }
    await ctx.shot('34-repro-home-reload');
    return { distinctFirst: distinctFirst.size, sessions };
  } finally {
    await ctx.close();
  }
}

async function reproDetailSequence(browser, db) {
  console.log('\n########## R3  Post Detail recommendation depth ##########');
  const ctx = await openContext(browser, 'A');
  const probe = instrument(ctx);
  try {
    await signIn(ctx, ACCOUNT);
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await ctx.page.waitForTimeout(2000);
    await ctx.page.locator('article[data-post-id]').first().click({ position: { x: 120, y: 80 } });
    await ctx.page.waitForFunction(() => window.location.search.includes('modal_id'), { timeout: 20000 });
    await ctx.page.waitForTimeout(2500);

    const visited = [];
    const seen = new Set();
    let stopReason = 'completed 22 steps';
    for (let step = 0; step < 22; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const id = new URL(ctx.page.url()).searchParams.get('modal_id');
      if (id && !seen.has(id)) {
        seen.add(id);
        // eslint-disable-next-line no-await-in-loop
        const post = await db.collection('posts').findOne({ _id: new ObjectId(id) }, { projection: { userId: 1, type: 1 } });
        visited.push({ step, id, creator: post?.userId?.toString(), type: post?.type });
      } else if (id) {
        visited.push({ step, id, creator: 'DUPLICATE', type: '' });
      }

      const next = ctx.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      const visible = await next.isVisible().catch(() => false);
      // eslint-disable-next-line no-await-in-loop
      let enabled = visible ? await next.isEnabled().catch(() => false) : false;
      if (!enabled) {
        console.log(`  next unavailable at step ${step} (visible=${visible}) — waiting 8s for a prefetch`);
        // eslint-disable-next-line no-await-in-loop
        await ctx.page.waitForTimeout(8000);
        // eslint-disable-next-line no-await-in-loop
        enabled = visible ? await next.isEnabled().catch(() => false) : false;
        console.log(`    after wait: enabled=${enabled}`);
        if (!enabled) {
          stopReason = `next stayed disabled at step ${step} after an 8s wait`;
          await ctx.shot('32-repro-detail-dead-end');
          break;
        }
      }
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(2400);
    }

    console.log(`\n  stop reason: ${stopReason}`);
    console.log(`  distinct posts reached: ${seen.size}`);
    visited.forEach((row) => console.log(`    step ${row.step}: ${row.id}  creator=${row.creator}  type=${row.type}`));
    console.log(`  distinct creators: ${new Set(visited.map((row) => row.creator)).size}`);
    console.log('  detail-session API traffic:');
    probe.api.filter((row) => /detail-session/.test(row.url))
      .forEach((row) => console.log(`    ${row.status} ${row.url} -> postId=${row.postId ?? 'null'}`));
    console.log(`  console: ${probe.logs.length}`);
    probe.logs.slice(0, 6).forEach((line) => console.log(`     ${line}`));
    return { depth: seen.size, stopReason, visited };
  } finally {
    await ctx.close();
  }
}

async function reproCreatorTab(browser, db) {
  console.log('\n########## R4  Videos tab creator mixing ##########');
  const ctx = await openContext(browser, 'A');
  const probe = instrument(ctx);
  try {
    await signIn(ctx, ACCOUNT);
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await ctx.page.waitForTimeout(2000);
    await ctx.page.locator('article[data-post-id]').first().click({ position: { x: 120, y: 80 } });
    await ctx.page.waitForFunction(() => window.location.search.includes('modal_id'), { timeout: 20000 });
    await ctx.page.waitForTimeout(2500);

    const anchorId = new URL(ctx.page.url()).searchParams.get('modal_id');
    const anchor = await db.collection('posts').findOne({ _id: new ObjectId(anchorId) });
    const anchorCreator = anchor?.userId?.toString();
    const creatorDoc = await db.collection('users').findOne({ _id: anchor?.userId });
    console.log(`  anchor post    : ${anchorId}`);
    console.log(`  anchor creator : ${anchorCreator} @${creatorDoc?.username}`);

    // Open the creator grid the way the UI offers it: the avatar on the rail.
    const avatar = ctx.page.locator('button[aria-label^="Open "]').first();
    await avatar.click({ timeout: 10000 }).catch(() => {});
    await ctx.page.waitForTimeout(4000);
    await ctx.shot('33-repro-videos-tab-open');

    const readPanel = () => ctx.page.evaluate(() => ({
      headerCreator: document.querySelector('[data-panel-creator-id]')?.getAttribute('data-panel-creator-id') || null,
      headerName: document.querySelector('[data-panel-creator-id]')?.innerText?.split('\n')[0] || null,
      tiles: Array.from(document.querySelectorAll('button[data-post-id]')).map((node) => ({
        postId: node.getAttribute('data-post-id'),
        creatorId: node.getAttribute('data-creator-id')
      }))
    }));

    let panel = await readPanel();
    console.log(`  after opening the tab: header=${panel.headerCreator} (${panel.headerName}) tiles=${panel.tiles.length}`);
    console.log(`    tile creators: ${JSON.stringify([...new Set(panel.tiles.map((tile) => tile.creatorId))])}`);

    // Now do what the reporter did: keep the tab open and move through posts.
    for (let step = 1; step <= 6; step += 1) {
      const next = ctx.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      if (!await next.isEnabled().catch(() => false)) {
        console.log(`  next disabled at step ${step}`);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // Deliberately short: the defect is a race between the creator query for
      // the post being left and the one for the post being entered.
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(900);
      // eslint-disable-next-line no-await-in-loop
      panel = await readPanel();
      // eslint-disable-next-line no-await-in-loop
      const currentId = new URL(ctx.page.url()).searchParams.get('modal_id');
      const tileCreators = [...new Set(panel.tiles.map((tile) => tile.creatorId))];
      console.log(`  step ${step}: post=${currentId} header=${panel.headerCreator} tiles=${panel.tiles.length} tileCreators=${JSON.stringify(tileCreators)}`);
      if (tileCreators.filter(Boolean).length > 1 || (panel.headerCreator && tileCreators.filter(Boolean).length === 1 && tileCreators[0] !== panel.headerCreator)) {
        console.log('  >>> REPRODUCED: the grid does not match the header creator');
        // eslint-disable-next-line no-await-in-loop
        await ctx.shot('35-repro-creator-mixed');
      }
    }

    // Settle, then look again — a mismatch that survives is not a loading blip.
    await ctx.page.waitForTimeout(6000);
    panel = await readPanel();
    const settledCreators = [...new Set(panel.tiles.map((tile) => tile.creatorId))];
    const currentId = new URL(ctx.page.url()).searchParams.get('modal_id');
    console.log(`\n  settled: post=${currentId} header=${panel.headerCreator} tiles=${panel.tiles.length}`);
    console.log(`  settled tile creators: ${JSON.stringify(settledCreators)}`);
    console.log(`  MISMATCH SURVIVES SETTLING: ${settledCreators.filter(Boolean).length > 1 || (settledCreators[0] && settledCreators[0] !== panel.headerCreator)}`);
    console.log('  creator API traffic:');
    probe.api.filter((row) => /creator|user/.test(row.url)).forEach((row) => console.log(`    ${row.status} ${row.url} creators=${JSON.stringify([...new Set(row.creators || [])])}`));
    await ctx.shot('36-repro-creator-settled');
    return { anchorCreator, settledCreators };
  } finally {
    await ctx.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();
  try {
    await reproForYou(browser, db, false);
    await reproForYou(browser, db, true);
    await reproHomeReload(browser, 10);
    await reproDetailSequence(browser, db);
    await reproCreatorTab(browser, db);
  } finally {
    await mongo.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
