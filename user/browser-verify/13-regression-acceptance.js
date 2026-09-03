/**
 * Browser acceptance for the four regressions, against a production build.
 *
 *   A  For You renders both media kinds, 20+ posts, clean console
 *   B  Home reload produces a new selection, not a re-sort of one fixed set
 *   C  Post Detail recommendation walks 20+ posts with working history
 *   D  The Videos tab never mixes creators
 *   E  A locked panel does not move the post
 *
 * Every assertion is driven by a real gesture in a real browser. Post ids come
 * from the page (`data-post-id`, `data-video-id`, `modal_id`); the database is
 * read only to say what a post *is*, never to drive the UI.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

function watchConsole(ctx) {
  const logs = [];
  ctx.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    // A 403 on a media byte range is the demo file server declining a request
    // for a file it does not hold; unrelated to what is under test here.
    if (/403 \(Forbidden\)/.test(text)) return;
    logs.push(`[${message.type()}] ${text.slice(0, 200)}`);
  });
  ctx.page.on('pageerror', (error) => logs.push(`[pageerror] ${String(error).slice(0, 200)}`));
  return logs;
}

/** What the For You stage is showing: the open post, and how it is drawn. */
function stage(page) {
  return page.evaluate(() => {
    const video = document.querySelector('video[data-video-id^="for-you-"]');
    const slides = Array.from(document.querySelectorAll('main img, section img'))
      .map((image) => image.getAttribute('src'))
      .filter((src) => src && !src.startsWith('data:'));
    return {
      videoPostId: video ? video.getAttribute('data-video-id').replace('for-you-', '') : null,
      videoSrc: video ? video.getAttribute('src') : null,
      videoSrcIsEmpty: Boolean(video) && (video.getAttribute('src') || '').trim() === '',
      imageCount: slides.length
    };
  });
}

async function scenarioA(browser, db, signedIn) {
  const label = signedIn ? 'A-auth' : 'A-guest';
  console.log(`\n=== Scenario A — For You (${signedIn ? 'authenticated' : 'guest'}) ===`);
  const ctx = await openContext(browser, label);
  const logs = watchConsole(ctx);
  try {
    if (signedIn) await signIn(ctx, ACCOUNT);
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(5000);

    const seen = [];
    let emptySrc = 0;
    let photosDrawnWithImages = 0;
    let videosWithRealSrc = 0;

    for (let step = 0; step <= 22; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const view = await stage(ctx.page);
      if (view.videoSrcIsEmpty) emptySrc += 1;

      if (view.videoPostId) {
        seen.push(view.videoPostId);
        if (view.videoSrc && view.videoSrc.trim()) videosWithRealSrc += 1;
        if (step === 0) await ctx.shot(`40-for-you-video-${label}`);
      } else if (view.imageCount > 0) {
        // A photo post: drawn with images, and crucially with no <video> at all.
        photosDrawnWithImages += 1;
        // eslint-disable-next-line no-await-in-loop
        const anyVideo = await ctx.page.locator('video').count();
        if (anyVideo > 0) check('a photo post mounted a <video>', false, `${anyVideo} element(s)`);
        if (photosDrawnWithImages === 1) await ctx.shot(`41-for-you-photo-${label}`);
        seen.push(`photo-${step}`);
      }

      // eslint-disable-next-line no-await-in-loop
      await ctx.page.keyboard.press('ArrowDown');
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(900);
    }

    check(`${label}: For You steps through more than 20 posts`, seen.length >= 20, `${seen.length} stage states`);
    check(`${label}: no <video> ever carried an empty src`, emptySrc === 0, `${emptySrc} occurrences`);
    check(`${label}: video posts render a real media URL`, videosWithRealSrc > 0, `${videosWithRealSrc} video stages`);
    check(`${label}: photo posts render their images`, photosDrawnWithImages > 0, `${photosDrawnWithImages} photo stages`);
    check(`${label}: console is clean`, logs.length === 0, logs.slice(0, 3).join(' | '));
    void db;
  } finally {
    await ctx.close();
  }
}

async function scenarioB(browser) {
  console.log('\n=== Scenario B — Home reload novelty (guest) ===');
  const ctx = await openContext(browser, 'B');
  const logs = watchConsole(ctx);
  const rounds = [];
  try {
    for (let round = 1; round <= 10; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(900);
      // eslint-disable-next-line no-await-in-loop
      const ids = await ctx.page.evaluate(() => Array.from(document.querySelectorAll('article[data-post-id]'))
        .map((node) => node.getAttribute('data-post-id')));
      rounds.push(ids);
      console.log(`  reload ${round}: first=${ids[0]} top10=${ids.slice(0, 10).join(' ')}`);
      if (round <= 3) await ctx.shot(`42-home-reload-${round}`);
    }

    const firsts = rounds.map((ids) => ids[0]);
    const distinctFirst = new Set(firsts).size;
    check('the first post is not pinned to one post across ten reloads',
      distinctFirst > 1, `${distinctFirst} distinct leads: ${[...new Set(firsts)].join(', ')}`);

    let identicalTop10 = 0;
    let maxOverlap = 0;
    for (let i = 1; i < rounds.length; i += 1) {
      const previous = new Set(rounds[i - 1].slice(0, 10));
      const overlap = rounds[i].slice(0, 10).filter((id) => previous.has(id)).length;
      maxOverlap = Math.max(maxOverlap, overlap);
      if (rounds[i].slice(0, 10).join() === rounds[i - 1].slice(0, 10).join()) identicalTop10 += 1;
    }
    check('no two consecutive sessions share an identical top 10', identicalTop10 === 0, `${identicalTop10} identical pairs`);
    check('consecutive sessions differ in content, not only in order',
      maxOverlap < 10, `worst-case overlap ${maxOverlap}/10`);
    check('sessions still overlap, because ranking still means something',
      maxOverlap >= 2, `worst-case overlap ${maxOverlap}/10`);

    // Load more must not duplicate inside one session.
    await ctx.page.evaluate(() => {
      const scroller = document.getElementById('home-feed-scroll');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
    await ctx.page.waitForTimeout(4000);
    const afterLoadMore = await ctx.page.evaluate(() => Array.from(document.querySelectorAll('article[data-post-id]'))
      .map((node) => node.getAttribute('data-post-id')));
    check('load-more grew the session', afterLoadMore.length > rounds[rounds.length - 1].length,
      `${rounds[rounds.length - 1].length} -> ${afterLoadMore.length}`);
    check('load-more introduced no duplicate', new Set(afterLoadMore).size === afterLoadMore.length,
      `${afterLoadMore.length} cards, ${new Set(afterLoadMore).size} distinct`);
    check('Home console is clean', logs.length === 0, logs.slice(0, 3).join(' | '));
    await ctx.shot('43-home-after-load-more');
  } finally {
    await ctx.close();
  }
}

async function scenarioC(browser, db) {
  console.log('\n=== Scenario C — Post Detail recommendation depth ===');
  const ctx = await openContext(browser, 'C');
  const logs = watchConsole(ctx);
  try {
    await signIn(ctx, ACCOUNT);
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
    await ctx.page.waitForTimeout(1500);
    await ctx.page.locator('article[data-post-id]').first().click({ position: { x: 120, y: 80 } });
    await ctx.page.waitForFunction(() => window.location.search.includes('modal_id'), { timeout: 20000 });
    await ctx.page.waitForTimeout(2500);

    const visited = [];
    for (let step = 0; step < 24; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const id = new URL(ctx.page.url()).searchParams.get('modal_id');
      visited.push(id);
      const next = ctx.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      if (!await next.isEnabled().catch(() => false)) {
        console.log(`  next disabled at step ${step}`);
        break;
      }
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1600);
    }

    // The loop records each post before clicking, so the one it ended on is
    // not in the list yet.
    const landed = new URL(ctx.page.url()).searchParams.get('modal_id');
    if (landed && landed !== visited[visited.length - 1]) visited.push(landed);

    const distinct = new Set(visited);
    check('the detail sequence reaches at least 20 posts', distinct.size >= 20, `${distinct.size} distinct`);
    check('the sequence never repeats a post', distinct.size === visited.length,
      `${visited.length} steps, ${distinct.size} distinct`);
    check('it did not dead-end around the third post', visited.length > 3, `${visited.length} steps`);

    const creators = await Promise.all([...distinct].map(async (id) => {
      const post = await db.collection('posts').findOne({ _id: new ObjectId(id) }, { projection: { userId: 1 } });
      return post?.userId?.toString();
    }));
    check('the sequence spans several creators', new Set(creators).size >= 3,
      `${new Set(creators).size} creators`);
    await ctx.shot('44-detail-depth');

    // History: previous must replay what was already shown, and next must
    // resume the same sequence rather than recomputing.
    const before = new URL(ctx.page.url()).searchParams.get('modal_id');
    const previous = ctx.page.locator('button[aria-label="Previous post"]').first();
    const back = [];
    for (let step = 0; step < 5; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await previous.click();
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1400);
      back.push(new URL(ctx.page.url()).searchParams.get('modal_id'));
    }
    const expectedBack = visited.slice(visited.indexOf(before) - 5, visited.indexOf(before)).reverse();
    check('previous replays exactly the posts already shown, in reverse',
      back.join() === expectedBack.join(), `${back.join(' ')} vs ${expectedBack.join(' ')}`);

    const forward = [];
    for (let step = 0; step < 5; step += 1) {
      const next = ctx.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(1400);
      forward.push(new URL(ctx.page.url()).searchParams.get('modal_id'));
    }
    check('next after previous resumes the same sequence',
      forward.join() === [...back].reverse().slice(1).concat(before).join(),
      `${forward.join(' ')} vs ${[...back].reverse().slice(1).concat(before).join(' ')}`);
    check('detail console is clean', logs.length === 0, logs.slice(0, 3).join(' | '));
  } finally {
    await ctx.close();
  }
}

async function scenarioD(browser, db, username) {
  console.log(`\n=== Scenario D — Videos tab, @${username} ===`);
  const ctx = await openContext(browser, `D-${username}`);
  const logs = watchConsole(ctx);
  try {
    await signIn(ctx, ACCOUNT);
    const creator = await db.collection('users').findOne({ username });
    const creatorId = creator._id.toString();
    // Start at the *top* of the creator's grid — pinned first, then newest —
    // so "next" walks down through the whole list. Anchoring on the oldest post
    // would leave next correctly disabled and prove nothing.
    const [anchor] = await db.collection('posts')
      .find({ userId: creator._id, status: 'active' })
      .sort({ isPinned: -1, pinnedAt: -1, createdAt: -1, _id: -1 })
      .limit(1)
      .toArray();
    const totalPosts = await db.collection('posts').countDocuments({ userId: creator._id, status: 'active' });

    await ctx.page.goto(`${USER_APP}/?modal_id=${anchor._id.toString()}`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(6000);

    // Open the creator grid the way the product offers it: the rail avatar.
    // The rail avatar — aria-label "Open <name>'s details". Deliberately not
    // `[aria-label$="details"]`, which also matches "Open post details", the
    // description's control: that opens the Details tab, which is locked mode.
    const avatar = ctx.page.locator("button[aria-label$=\"'s details\"]").first();
    await avatar.click({ timeout: 15000 });
    await ctx.page.waitForTimeout(4000);

    const readPanel = () => ctx.page.evaluate(() => ({
      header: document.querySelector('[data-panel-creator-id]')?.getAttribute('data-panel-creator-id') || null,
      tiles: Array.from(document.querySelectorAll('button[data-post-id]')).map((node) => ({
        postId: node.getAttribute('data-post-id'), creatorId: node.getAttribute('data-creator-id')
      }))
    }));

    let panel = await readPanel();
    check(`@${username}: the grid opened`, panel.tiles.length > 0, `${panel.tiles.length} tiles`);
    check(`@${username}: the header names the creator whose post was open`,
      panel.header === creatorId, `${panel.header} vs ${creatorId}`);
    check(`@${username}: every tile belongs to that creator`,
      panel.tiles.every((tile) => tile.creatorId === creatorId),
      `${[...new Set(panel.tiles.map((tile) => tile.creatorId))].join(', ')}`);
    await ctx.shot(`45-videos-tab-${username}`);

    // Walk the whole creator list, deliberately fast, and check after each step.
    const walked = new Set();
    let mixed = 0;
    for (let step = 0; step < totalPosts + 2; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const currentId = new URL(ctx.page.url()).searchParams.get('modal_id');
      walked.add(currentId);
      // eslint-disable-next-line no-await-in-loop
      const current = await db.collection('posts').findOne({ _id: new ObjectId(currentId) }, { projection: { userId: 1 } });
      if (current?.userId?.toString() !== creatorId) mixed += 1;

      // eslint-disable-next-line no-await-in-loop
      panel = await readPanel();
      if (panel.tiles.some((tile) => tile.creatorId !== creatorId)) mixed += 1;
      if (panel.header && panel.header !== creatorId) mixed += 1;

      const next = ctx.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      if (!await next.isEnabled().catch(() => false)) break;
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // Short on purpose: fast clicking is where the stale creator response used
      // to land in the grid.
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(700);
    }

    check(`@${username}: scrolling the creator list never left the creator`, mixed === 0, `${mixed} violations`);
    check(`@${username}: the walk covered the creator's whole list`, walked.size === totalPosts,
      `${walked.size} of ${totalPosts}`);

    await ctx.page.waitForTimeout(5000);
    panel = await readPanel();
    check(`@${username}: the grid is still this creator's after settling`,
      panel.tiles.length > 0 && panel.tiles.every((tile) => tile.creatorId === creatorId),
      `${[...new Set(panel.tiles.map((tile) => tile.creatorId))].join(', ')}`);
    check(`@${username}: console is clean`, logs.length === 0, logs.slice(0, 3).join(' | '));
    await ctx.shot(`46-videos-tab-settled-${username}`);
  } finally {
    await ctx.close();
  }
}

async function scenarioE(browser, db) {
  console.log('\n=== Scenario E — a locked panel does not move the post ===');
  const ctx = await openContext(browser, 'E');
  const logs = watchConsole(ctx);
  try {
    await signIn(ctx, ACCOUNT);
    const anchor = await db.collection('posts').findOne({ type: 'video', status: 'active' });
    await ctx.page.goto(`${USER_APP}/?modal_id=${anchor._id.toString()}`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(6000);

    const openId = new URL(ctx.page.url()).searchParams.get('modal_id');

    // Open Details, which is a reading panel, not a navigating one.
    const detailsTrigger = ctx.page.getByText(/^details$/i).first();
    if (!await detailsTrigger.isVisible().catch(() => false)) {
      // Reached through the comments panel's tab strip.
      await ctx.page.locator('button[aria-label="Comment"]').first().click();
      await ctx.page.waitForTimeout(2500);
      await ctx.page.getByText(/^details$/i).first().click();
    } else {
      await detailsTrigger.click();
    }
    await ctx.page.waitForTimeout(2500);
    await ctx.shot('47-locked-details-open');

    const nextButton = ctx.page.locator('button[aria-label="Next post"]').first();
    const nextEnabledWhileLocked = await nextButton.isEnabled().catch(() => false);
    check('the next control does not navigate while a reading panel is open',
      !nextEnabledWhileLocked, `enabled=${nextEnabledWhileLocked}`);

    // Wheel over the overlay must not change the post either.
    for (let step = 0; step < 6; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.mouse.move(700, 450);
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.mouse.wheel(0, 400);
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(350);
    }
    const afterWheel = new URL(ctx.page.url()).searchParams.get('modal_id');
    check('scrolling with the panel open leaves the post where it was',
      afterWheel === openId, `${openId} -> ${afterWheel}`);

    // Close the panel; navigation must come back.
    const close = ctx.page.locator('button[aria-label="Close panel"], button[aria-label="Close"]').first();
    if (await close.isVisible().catch(() => false)) {
      await close.click();
    } else {
      await ctx.page.getByText(/^details$/i).first().click();
    }
    await ctx.page.waitForTimeout(3000);

    const restored = await ctx.page.locator('button[aria-label="Next post"]').first().isEnabled().catch(() => false);
    check('closing the panel restores navigation', restored, `enabled=${restored}`);
    if (restored) {
      await ctx.page.locator('button[aria-label="Next post"]').first().click();
      await ctx.page.waitForTimeout(2500);
      const moved = new URL(ctx.page.url()).searchParams.get('modal_id');
      check('and next then moves the post', moved !== openId, `${openId} -> ${moved}`);
    }
    check('locked-mode console is clean', logs.length === 0, logs.slice(0, 3).join(' | '));
    await ctx.shot('48-locked-restored');
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
    await scenarioA(browser, db, false);
    await scenarioA(browser, db, true);
    await scenarioB(browser);
    await scenarioC(browser, db);
    await scenarioD(browser, db, 'iris.inthefield');
    await scenarioD(browser, db, 'sofia.builds');
    await scenarioE(browser, db);
  } finally {
    await mongo.close();
    await browser.close();
  }
  process.exit(summarise('Regression acceptance'));
}

main().catch((error) => { console.error(error); process.exit(1); });
