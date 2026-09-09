/**
 * Phase 1 — the popup's top-left control is decided by navigation mode, not by
 * media type.
 *
 * ## What was wrong
 *
 * The Back behaviour was written inside `VideoPostDetail`. `GraphicPostDetail`
 * drew its own button — always an X wired straight to `onClose` — so an
 * **image** post with the Videos tab open still showed Close, and pressing it
 * threw the viewer out of the popup instead of back to the post they came from.
 *
 * ## What this asserts, in a real browser
 *
 * The full transition matrix, both media types on both sides of the swap:
 *
 *   video base -> Videos -> video creator post -> Back
 *   video base -> Videos -> image creator post -> Back
 *   image base -> Videos -> image creator post -> Back
 *   image base -> Videos -> video creator post -> Back
 *
 * plus Escape ordering, the accessible name, and the accepted P0/P1 history
 * scenario replayed with an image as P1.
 *
 * Nothing here reads `post.type` to decide what it expects: every expectation
 * is stated in terms of the panel tab, and the *layout* that happens to be
 * mounted is recorded only so the report can show both were exercised.
 */
const { chromium, USER_APP, signIn, SHOT_DIR, routeMediaOrigin } = require('./lib/harness');

const W = Number(process.env.W || 1440);
const H = Number(process.env.H || 900);
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

let pass = 0;
let fail = 0;
const skipped = [];
/*
  Not every pairing exists in the seeded catalogue, and a missing pairing is not
  a defect. Measured against the demo database: all 16 creators hold exactly one
  photo and nine videos (16 photos / 144 videos), so no creator grid can offer a
  *second* photo to step onto. That case is covered at the hook level in
  `detail-back-control.spec.tsx`; it is recorded here as not exercisable rather
  than quietly passed or misreported as a product failure.
*/
const skip = (label, reason) => {
  skipped.push({ label, reason });
  console.log(`  ○ ${label} — NOT EXERCISABLE: ${reason}`);
};
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const short = (id) => (id ? String(id).slice(-6) : String(id));

const POPUP = '[data-post-detail-popup]';
/** How many base posts to try before giving up on finding the required pairing. */
const MAX_BASE_CANDIDATES = 6;

/** The control's own report of what it is — read off the DOM, never inferred. */
const readControl = (page) => page.evaluate((popup) => {
  const root = document.querySelector(popup);
  if (!root) return { present: false, popupOpen: false };
  const button = root.querySelector('button[data-detail-back]');
  if (!button) return { present: false, popupOpen: true };
  return {
    present: true,
    popupOpen: true,
    isBack: button.getAttribute('data-detail-back') === 'true',
    label: button.getAttribute('aria-label'),
    // Which layout drew it, so the report can prove both were exercised.
    layout: root.getAttribute('data-post-detail-popup')
  };
}, POPUP);

const openId = (page) => page.evaluate(
  () => new URL(window.location.href).searchParams.get('modal_id')
);

const activeTab = (page) => page.evaluate((popup) => {
  const el = document.querySelector(`${popup} [data-panel-tab="active"]`);
  return el ? el.getAttribute('aria-label') : null;
}, POPUP);

const popupOpen = (page) => page.evaluate(
  (popup) => Boolean(document.querySelector(popup)),
  POPUP
);

/**
 * The detail panel is not mounted while it is closed, so its tab strip does not
 * exist yet. Opening it is the same two-step a viewer performs: open the panel,
 * then choose a tab.
 */
async function clickTab(page, name) {
  await page.evaluate((popup) => {
    if (document.querySelector(`${popup} nav[aria-label="Video details"]`)) return;
    document.querySelector(`${popup} button[aria-label="Open post details"]`)?.click();
  }, POPUP);
  await page.waitForTimeout(1200);
  await page.evaluate(([popup, label]) => {
    document.querySelector(`${popup} nav[aria-label="Video details"] button[aria-label="${label}"]`)?.click();
  }, [POPUP, name]);
  await page.waitForTimeout(1600);
}

async function pressBack(page) {
  await page.evaluate((popup) => {
    document.querySelector(`${popup} button[data-detail-back]`)?.click();
  }, POPUP);
  await page.waitForTimeout(1400);
}

async function pressNav(page, direction) {
  const moved = await page.evaluate(([popup, name]) => {
    const button = document.querySelector(`${popup} button[aria-label="${name}"]`);
    if (!button || button.disabled) return false;
    button.click();
    return true;
  }, [POPUP, direction === 'next' ? 'Next post' : 'Previous post']);
  await page.waitForTimeout(1500);
  return moved;
}

/**
 * The creator grid's own tiles, which say which kind each post is.
 *
 * Anchored on `data-post-id` *and* the tile's exact `Open photo:`/`Open video:`
 * wording: a looser `^Open ` match also picks up "Open messages" and "Open post
 * details", which have no post id and are not in the grid at all.
 */
const gridTiles = (page) => page.evaluate(
  (popup) => [...document.querySelectorAll(`${popup} button[data-post-id]`)]
    .map((button) => ({ id: button.getAttribute('data-post-id'), label: button.getAttribute('aria-label') || '' }))
    .filter((tile) => tile.id && /^Open (photo|video):/.test(tile.label))
    .map((tile) => ({ id: tile.id, kind: /^Open photo:/.test(tile.label) ? 'photo' : 'video' })),
  POPUP
);

async function openGridTile(page, id) {
  await page.evaluate(([popup, postId]) => {
    document.querySelector(`${popup} button[data-post-id="${postId}"]`)?.click();
  }, [POPUP, id]);
  await page.waitForTimeout(1800);
}

async function closePopup(page) {
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await popupOpen(page))) break;
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(400);
}

/**
 * Open the popup from Home and walk forward until the mounted layout is the
 * one we want as a base. Walking is a real gesture — the same Next the viewer
 * presses.
 */
async function openBase(page, wantLayout, candidate = 0, maxSteps = 30) {
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await page.waitForSelector(POPUP, { timeout: 20000 });
  await page.waitForTimeout(1800);
  /*
    `candidate` walks past base posts already tried: a creator with only one
    photo cannot supply a *second* photo to step onto, which is a property of
    the seeded catalogue rather than of the control under test.
  */
  let seen = 0;
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < maxSteps; i += 1) {
    const control = await readControl(page);
    if (control.layout === wantLayout) {
      if (seen === candidate) return { ok: true, steps: i };
      seen += 1;
    }
    if (!(await pressNav(page, 'next'))) break;
  }
  /* eslint-enable no-await-in-loop */
  return { ok: false, steps: maxSteps };
}

/**
 * One transition of the matrix, end to end.
 *
 * `baseLayout` picks which kind of post the popup opens on; `creatorKind`
 * picks which kind of the creator's posts we step onto inside the grid.
 */
async function runTransition(page, baseLayout, creatorKind, candidate = 0) {
  const name = `${baseLayout} base -> ${creatorKind} creator post`;
  if (candidate === 0) console.log(`\n--- ${name} ---`);

  const opened = await openBase(page, baseLayout, candidate);
  if (!opened.ok) {
    if (candidate > 0) {
      skip(name, `the feed held no ${baseLayout} post beyond candidate #${candidate}, and none so far had a second ${creatorKind}`);
    } else {
      check(`${name}: found a ${baseLayout} post to open on`, false, 'none reached');
    }
    return null;
  }
  const basePost = await openId(page);

  // 1. base popup: the control closes.
  const atBase = await readControl(page);
  check(`${name}: base control is Close`,
    atBase.present && atBase.isBack === false && atBase.label === 'Close post details',
    `layout=${atBase.layout} back=${atBase.isBack} label="${atBase.label}"`);

  // 2. Videos open: the control becomes Back.
  await clickTab(page, 'Videos');
  const tabOpen = await activeTab(page);
  const inVideos = await readControl(page);
  check(`${name}: Videos open makes it Back`,
    tabOpen === 'Videos' && inVideos.isBack === true && inVideos.label === 'Exit creator videos',
    `tab=${tabOpen} back=${inVideos.isBack} label="${inVideos.label}"`);

  // 3. step onto a creator post of the requested kind — the control must not change.
  const tiles = await gridTiles(page);
  const target = tiles.find((tile) => tile.kind === creatorKind && tile.id !== basePost);
  if (!target) {
    /*
      This creator has no *other* post of that kind. A property of the seeded
      catalogue, not of the control — so try the next base candidate rather
      than recording a failure the code cannot cause.
    */
    await closePopup(page);
    if (candidate < MAX_BASE_CANDIDATES) return runTransition(page, baseLayout, creatorKind, candidate + 1);
    skip(name, `no creator grid offered a second ${creatorKind} in ${MAX_BASE_CANDIDATES} base candidates`);
    return null;
  }
  if (candidate > 0) console.log(`  (base candidate #${candidate + 1}; earlier creators had no second ${creatorKind})`);
  await openGridTile(page, target.id);
  const onCreatorPost = await readControl(page);
  const creatorPost = await openId(page);
  check(`${name}: still Back after stepping onto the ${creatorKind}`,
    onCreatorPost.isBack === true && onCreatorPost.label === 'Exit creator videos',
    `layout=${onCreatorPost.layout} post=${short(creatorPost)} back=${onCreatorPost.isBack}`);

  // 4. Back: exits Videos, returns to the base post, and does NOT close.
  await pressBack(page);
  const stillOpen = await popupOpen(page);
  const afterTab = await activeTab(page);
  const afterPost = await openId(page);
  const afterControl = await readControl(page);
  check(`${name}: Back keeps the popup open`, stillOpen === true, `open=${stillOpen}`);
  check(`${name}: Back exits the Videos tab`, afterTab !== 'Videos', `tab=${afterTab}`);
  check(`${name}: Back returns to the base post`, afterPost === basePost,
    `base=${short(basePost)} after=${short(afterPost)}`);
  check(`${name}: control is Close again`,
    afterControl.isBack === false && afterControl.label === 'Close post details',
    `back=${afterControl.isBack} label="${afterControl.label}"`);

  await closePopup(page);
  return {
    basePost, creatorPost, baseLayout, creatorKind, creatorLayout: onCreatorPost.layout
  };
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  await routeMediaOrigin(context);
  const page = await context.newPage();

  console.log(`\n=== Popup back control: mode decides, not media type @ ${W}x${H} ===`);
  console.log(`    app=${USER_APP}`);
  await signIn({ page }, ACCOUNT);

  // ------------------------------------------------ the four transitions
  const transitions = [];
  /* eslint-disable no-await-in-loop */
  for (const [baseLayout, creatorKind] of [
    ['video', 'video'],
    ['video', 'photo'],
    ['graphic', 'photo'],
    ['graphic', 'video']
  ]) {
    transitions.push(await runTransition(page, baseLayout, creatorKind));
  }
  /* eslint-enable no-await-in-loop */

  const layoutsSeen = new Set(transitions.filter(Boolean).map((row) => row.baseLayout));
  check('both layouts were actually exercised as a base',
    layoutsSeen.has('video') && layoutsSeen.has('graphic'),
    `[${[...layoutsSeen].join(', ')}]`);

  const creatorLayouts = new Set(transitions.filter(Boolean).map((row) => row.creatorLayout));
  check('both layouts were exercised as a creator post inside the grid',
    creatorLayouts.has('video') && creatorLayouts.has('graphic'),
    `[${[...creatorLayouts].join(', ')}]`);

  // ------------------------------------------------ Escape ordering, image base
  console.log('\n--- Escape ordering on an image post ---');
  const escOpened = await openBase(page, 'graphic', 0);
  if (escOpened.ok) {
    const escBase = await openId(page);
    await clickTab(page, 'Videos');
    const before = await readControl(page);
    check('Escape scenario: Videos open, control is Back', before.isBack === true, `back=${before.isBack}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1300);
    const afterFirst = await popupOpen(page);
    const tabAfterFirst = await activeTab(page);
    const postAfterFirst = await openId(page);
    check('first Escape exits Videos and keeps the popup open',
      afterFirst === true && tabAfterFirst !== 'Videos',
      `open=${afterFirst} tab=${tabAfterFirst} post=${short(postAfterFirst)}`);
    check('Escape left the base post unchanged', postAfterFirst === escBase,
      `base=${short(escBase)} after=${short(postAfterFirst)}`);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(1300);
    const afterSecond = await popupOpen(page);
    check('a second Escape closes the popup', afterSecond === false, `open=${afterSecond}`);
  } else {
    check('Escape scenario: found an image post', false);
  }

  // ------------------------------------------------ history, with an image P1
  console.log('\n--- P0 -> Next P1(image) -> Videos -> creator nav -> Back -> Previous/Next ---');
  await closePopup(page);
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await page.waitForSelector(POPUP, { timeout: 20000 });
  await page.waitForTimeout(1800);

  /*
    Step forward until the open post is an image — that is the whole point of
    the run. P0 is the post *immediately before* it, not whichever post the
    popup happened to open on: Previous walks exactly one step, so asserting
    against the first post fails whenever more than one Next was needed. Where
    the images fall in the ranked feed is not a property of navigation.
  */
  let p0 = await openId(page);
  let p1 = null;
  /* eslint-disable no-await-in-loop */
  for (let i = 0; i < 25; i += 1) {
    const before = await openId(page);
    if (!(await pressNav(page, 'next'))) break;
    const control = await readControl(page);
    if (control.layout === 'graphic') {
      p0 = before;
      p1 = await openId(page);
      break;
    }
  }
  /* eslint-enable no-await-in-loop */
  check('history: reached an image post as P1', Boolean(p1), `P0=${short(p0)} P1=${short(p1)}`);

  if (p1) {
    await clickTab(page, 'Videos');
    const tiles = await gridTiles(page);
    const step = tiles.find((tile) => tile.id !== p1);
    if (step) await openGridTile(page, step.id);
    check('history: navigated inside the creator grid', Boolean(step),
      step ? `to ${short(step.id)} (${step.kind})` : 'no other tile');

    await pressBack(page);
    const backTo = await openId(page);
    check('history: Back lands on P1, the image post', backTo === p1,
      `expected=${short(p1)} got=${short(backTo)}`);

    const movedPrev = await pressNav(page, 'previous');
    const prevId = await openId(page);
    check('history: Previous returns to P0', movedPrev && prevId === p0,
      `expected=${short(p0)} got=${short(prevId)}`);

    const movedNext = await pressNav(page, 'next');
    const nextId = await openId(page);
    check('history: Next returns to P1 from history', movedNext && nextId === p1,
      `expected=${short(p1)} got=${short(nextId)}`);
  }

  // ------------------------------------------------ captures
  console.log('\n--- captures ---');
  const shots = [];
  const capture = async (file) => {
    await page.screenshot({ path: `${SHOT_DIR}/${file}` });
    shots.push(file);
  };
  await closePopup(page);
  const shotOpened = await openBase(page, 'graphic', 0);
  if (shotOpened.ok) {
    await capture('37-image-base-close.png');
    await clickTab(page, 'Videos');
    await capture('37-image-videos-back.png');
    const tiles = await gridTiles(page);
    const videoTile = tiles.find((tile) => tile.kind === 'video');
    if (videoTile) {
      await openGridTile(page, videoTile.id);
      await capture('37-image-base-video-creator-post-back.png');
    }
    await pressBack(page);
    await capture('37-image-after-back.png');
  }
  await closePopup(page);
  const videoShot = await openBase(page, 'video', 0);
  if (videoShot.ok) {
    await clickTab(page, 'Videos');
    await capture('37-video-videos-back.png');
  }
  console.log(`  wrote ${shots.length} captures to ${SHOT_DIR}`);
  shots.forEach((file) => console.log(`    ${file}`));

  await context.close();
  await browser.close();

  if (skipped.length) {
    console.log('  --- not exercisable against this catalogue ---');
    skipped.forEach((row) => console.log(`  ○ ${row.label}: ${row.reason}`));
  }
  console.log(`=== ${pass} passed, ${fail} failed, ${skipped.length} not exercisable ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
