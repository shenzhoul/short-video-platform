/**
 * Standalone post-detail popup — swipe/drag navigation acceptance.
 *
 * The point of this pass is equivalence: for the same starting post, a swipe
 * must land on exactly the post the existing Next/Previous button lands on. So
 * every navigation assertion here records the button's answer first, returns to
 * the same post, and then compares the gesture's answer against it.
 *
 *   node browser-verify/26-popup-drag.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SHOOT=1.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const path = require('path');
const fs = require('fs');
const { signIn } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const SHOTS = path.resolve(__dirname, '..', '..', 'output', 'screenshots');
const SHOOT = process.env.SHOOT === '1';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

let pass = 0;
let fail = 0;
const frames = [];

const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function shot(page, name) {
  if (!SHOOT) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
  frames.push(name);
  console.log(`    · ${name}`);
}

const transformY = (matrix) => {
  if (!matrix || matrix === 'none') return 0;
  const parts = matrix.match(/matrix(3d)?\(([^)]+)\)/);
  if (!parts) return 0;
  const values = parts[2].split(',').map((value) => Number(value.trim()));
  return parts[1] ? values[13] : values[5];
};

/** Everything the popup's drag touches, in one read. */
async function readPopup(page) {
  return page.evaluate(() => {
    // The two popup layouts are different components; only the graphic one
    // carries `role="dialog"` today, so both are named explicitly.
    const dialog = document.querySelector('[data-post-detail-popup]');
    const viewport = dialog?.querySelector('[data-testid="post-drag-viewport"]');
    const current = dialog?.querySelector('[data-testid="post-drag-current"]');
    const next = dialog?.querySelector('[data-testid="post-drag-preview-next"]');
    const previous = dialog?.querySelector('[data-testid="post-drag-preview-previous"]');
    const panel = dialog?.querySelector('aside[class*="detailpanel"]');
    const close = dialog?.querySelector('button[aria-label*="Close" i]');
    const read = (element) => (element ? {
      transform: getComputedStyle(element).transform,
      transitionProperty: getComputedStyle(element).transitionProperty,
      top: Math.round(element.getBoundingClientRect().top * 10) / 10,
      height: Math.round(element.getBoundingClientRect().height * 10) / 10,
      visible: element.getBoundingClientRect().height > 0
    } : null);

    // The open post, named by what its media points at.
    const media = current?.querySelector('video, img');
    /*
     * The creator by *id*, not by whichever `@handle` happens to appear first
     * in the popup's text. With the Videos tab open the panel shows the
     * username (`@iris.inthefield`) and the stage caption shows the display
     * name (`@Iris Lindqvist`) — the same person, read two ways, which is a
     * false mismatch rather than a creator change.
     */
    const creatorId = dialog?.querySelector('[data-panel-creator-id]')
      ?.getAttribute('data-panel-creator-id') || null;
    const creator = (dialog?.innerText || '').match(/@[^\n·]+/);

    return {
      open: Boolean(dialog),
      viewportHeight: viewport ? Math.round(viewport.getBoundingClientRect().height * 10) / 10 : null,
      current: read(current),
      next: read(next),
      previous: read(previous),
      panel: read(panel),
      close: read(close),
      videoCount: dialog ? dialog.querySelectorAll('video').length : 0,
      previewVideos: dialog
        ? dialog.querySelectorAll('[data-testid^="post-drag-preview-"] video').length : 0,
      previewsDecoded: dialog
        ? [...dialog.querySelectorAll('[data-testid^="post-drag-preview-"] img')]
          .every((image) => image.complete && image.naturalWidth > 0) : null,
      mediaSrc: media?.getAttribute('src') || null,
      creator: creator ? creator[0].trim() : null,
      creatorId,
      activeTab: [...(dialog?.querySelectorAll('nav[aria-label="Video details"] button') || [])]
        .find((button) => /border-b|text-white$/.test(button.className) || button.getAttribute('aria-selected') === 'true')
        ?.textContent?.trim() || null
    };
  });
}

/** A real touch gesture over the popup's media, optionally paused mid-way. */
async function drag(page, { dy, hold = false, steps = 12, x = null, y = null }) {
  const startX = x ?? Math.round(W * 0.45);
  const startY = y ?? Math.round(H * 0.55);
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: startX, y: startY }] });
  for (let i = 1; i <= steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await client.send('Input.dispatchTouchEvent', {
      type: 'touchMove', touchPoints: [{ x: startX, y: startY + (dy * i) / steps }]
    });
  }
  if (hold) return client;
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await page.waitForTimeout(500);
  return null;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  console.log(`\n=== Popup drag navigation @ ${W}x${H} ===\n`);

  await signIn({ page }, ACCOUNT);

  /*
   * Opening by id, not by clicking whatever the feed happens to show.
   *
   * Home is a ranked session, so "click the first card" is a different post on
   * every load — and an equivalence test that cannot return to the same
   * starting post proves nothing. `modal_id` is the popup's own deep link.
   */
  const openPopup = async () => {
    await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    await page.locator('article[data-post-id]').first()
      .click({ timeout: 8000, position: { x: 30, y: 60 } }).catch(() => null);
    await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
    await page.waitForTimeout(1600);
    return new URL(page.url()).searchParams.get('modal_id');
  };

  const openPostById = async (id) => {
    await page.goto(`${USER_APP}/?modal_id=${id}`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
    await page.waitForTimeout(1800);
  };

  /*
   * The popup's own Next/Previous, invoked directly.
   *
   * The capsule is `max-lg:hidden` at a compact viewport, so it cannot be
   * clicked through the pointer there — but it is the control whose behaviour
   * swipe has to match, and it is the same `onNavigate` either way. Calling it
   * exercises exactly the handler under test.
   */
  const pressNav = async (direction) => {
    const label = direction === 'next' ? 'Next post' : 'Previous post';
    await page.evaluate((name) => {
      const button = document.querySelector(`[data-post-detail-popup] button[aria-label="${name}"]`);
      if (button) button.click();
    }, label);
    await page.waitForTimeout(900);
  };

  const openPanelTab = async (label) => {
    // The tab strip only exists once a panel is open, so open one first.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll('[data-post-detail-popup] button')]
        .find((element) => /comment/i.test(element.getAttribute('aria-label') || element.title || ''));
      if (button) button.click();
    });
    await page.waitForTimeout(900);
    await page.evaluate((name) => {
      const tab = [...document.querySelectorAll('[data-post-detail-popup] nav button')]
        .find((element) => element.textContent.trim() === name);
      if (tab) tab.click();
    }, label);
    await page.waitForTimeout(1200);
  };

  const seedId = await openPopup();
  check('the popup exposes its post id in the url', Boolean(seedId), seedId);
  let state = await readPopup(page);
  check('the popup opened', state.open);
  check('the drag viewport is mounted inside the popup', state.viewportHeight !== null,
    `${state.viewportHeight}px`);
  check('the current stage sits at zero at rest', Math.abs(transformY(state.current?.transform)) < 0.5,
    `${transformY(state.current?.transform)}`);
  check('a neighbour is preloaded and parked one stage away',
    Boolean(state.next) && Math.abs(transformY(state.next.transform) - state.viewportHeight) <= 1,
    state.next ? `${Math.round(transformY(state.next.transform))} vs ${state.viewportHeight}` : 'none');
  check('the preview mounts no second video — nothing else can autoplay',
    state.previewVideos === 0, `${state.previewVideos}`);
  check('preview media is already decoded before any gesture', state.previewsDecoded !== false,
    `${state.previewsDecoded}`);
  await shot(page, 'popup-01-at-rest.png');

  // ---------------------------------------------- 1. button vs swipe: next
  const startPost = state.mediaSrc;
  await pressNav('next');
  const buttonNext = (await readPopup(page)).mediaSrc;
  check('the Next button moved to another post', buttonNext !== startPost,
    `${startPost?.slice(-24)} -> ${buttonNext?.slice(-24)}`);

  /*
   * Return to the starting post *inside the same session*, with Previous.
   *
   * Reopening via `?modal_id=` used to be equivalent, because the popup ran a
   * detached sequence that was the same on every load. It no longer is: the
   * popup now navigates the Home recommendation session it was opened from, and
   * a reload is a new ranked session with a different order — so "the next post
   * after X" is legitimately different there. Comparing a button and a gesture
   * only means something within one session.
   */
  await pressNav('previous');
  const restart = await readPopup(page);
  check('stepped back to the same starting post', restart.mediaSrc === startPost,
    `${restart.mediaSrc === startPost ? 'same' : 'different'}`);
  check('a reopened popup inherits no drag state',
    Math.abs(transformY(restart.current?.transform)) < 0.5,
    `${transformY(restart.current?.transform)}`);

  // mid-drag frame, finger still down
  const stageHeight = restart.viewportHeight;
  const client = await drag(page, { dy: -Math.round(stageHeight * 0.34), hold: true });
  await page.waitForTimeout(90);
  const mid = await readPopup(page);
  const midDelta = transformY(mid.current?.transform);
  check('the current post follows the finger', midDelta < -20, `${Math.round(midDelta)}px`);
  check('no transition while the finger is down', mid.current?.transitionProperty === 'none',
    mid.current?.transitionProperty);
  check('the next post is visible beside it during the gesture',
    Boolean(mid.next) && Math.abs(transformY(mid.next.transform) - (stageHeight + midDelta)) <= 2,
    mid.next ? `${Math.round(transformY(mid.next.transform))} vs ${Math.round(stageHeight + midDelta)}` : 'none');
  check('the close button stays anchored during the drag',
    Math.abs((mid.close?.top ?? 0) - (restart.close?.top ?? 0)) <= 0.5,
    `${restart.close?.top} -> ${mid.close?.top}`);
  check('still only one video in the popup mid-drag', mid.videoCount <= 1, `${mid.videoCount}`);
  await shot(page, 'popup-02-mid-drag-up.png');

  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await page.waitForTimeout(600);
  const afterSwipe = await readPopup(page);
  check('SWIPE UP selects exactly the post the Next button selected',
    afterSwipe.mediaSrc === buttonNext,
    `${afterSwipe.mediaSrc === buttonNext ? 'identical' : `swipe=${afterSwipe.mediaSrc} button=${buttonNext}`}`);
  check('the committed stage returned to zero', Math.abs(transformY(afterSwipe.current?.transform)) < 0.5);
  await shot(page, 'popup-03-commit-up.png');

  // ------------------------------------------ 2. button vs swipe: previous
  const buttonPrevious = startPost;
  check('the Previous button returns to the starting post', buttonPrevious === startPost);

  // The up-swipe above already left us on `buttonNext`, so a down-swipe from
  // here must return to the post it started from.
  const downClient = await drag(page, { dy: Math.round(stageHeight * 0.34), hold: true });
  await page.waitForTimeout(90);
  const midDown = await readPopup(page);
  check('dragging down reveals the previous post above',
    Boolean(midDown.previous)
    && Math.abs(transformY(midDown.previous.transform)
      - (-stageHeight + transformY(midDown.current.transform))) <= 2,
    midDown.previous ? `${Math.round(transformY(midDown.previous.transform))}` : 'none');
  await shot(page, 'popup-04-mid-drag-down.png');
  await downClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await downClient.detach();
  await page.waitForTimeout(600);
  const afterDown = await readPopup(page);
  check('SWIPE DOWN selects exactly the post the Previous button selected',
    afterDown.mediaSrc === buttonPrevious,
    `${afterDown.mediaSrc === buttonPrevious ? 'identical' : `swipe=${afterDown.mediaSrc} button=${buttonPrevious}`}`);

  // --------------------------------------------------- 3. rollback below
  const beforeRollback = (await readPopup(page)).mediaSrc;
  await drag(page, { dy: -26, steps: 5 });
  const rolled = await readPopup(page);
  check('an under-threshold drag rolls back and changes nothing',
    rolled.mediaSrc === beforeRollback && Math.abs(transformY(rolled.current?.transform)) < 0.5,
    `${rolled.mediaSrc === beforeRollback ? 'unchanged' : 'CHANGED'}`);
  await shot(page, 'popup-05-rollback.png');

  // ------------------------------ 3b. edge: damped resistance, no navigation
  /*
   * The seed post is the head of the sequence — its `Previous post` control is
   * disabled — so a downward drag there is the edge case: it may move, damped,
   * but it must not commit.
   */
  // Walk back to the head of the sequence rather than reloading, for the same
  // reason as above.
  for (let i = 0; i < 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const atHead = await page.evaluate(
      () => document.querySelector('[data-post-detail-popup] button[aria-label="Previous post"]')?.disabled
    );
    if (atHead) break;
    // eslint-disable-next-line no-await-in-loop
    await pressNav('previous');
  }
  const edgeBefore = await readPopup(page);
  const edgeDisabled = await page.evaluate(
    () => document.querySelector('[data-post-detail-popup] button[aria-label="Previous post"]')?.disabled
  );
  check('the seed post is the head of the sequence', edgeDisabled === true, `${edgeDisabled}`);
  const edgeClient = await drag(page, { dy: Math.round(stageHeight * 0.4), hold: true });
  await page.waitForTimeout(90);
  const edgeMid = await readPopup(page);
  const edgeDelta = transformY(edgeMid.current?.transform);
  check('the edge resists rather than following the finger',
    Math.abs(edgeDelta) < Math.round(stageHeight * 0.4) * 0.6,
    `${Math.round(edgeDelta)}px of ${Math.round(stageHeight * 0.4)}px requested`);
  await shot(page, 'popup-10-edge-damped.png');
  await edgeClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await edgeClient.detach();
  await page.waitForTimeout(700);
  const edgeAfter = await readPopup(page);
  check('the edge drag rolled back and navigated nothing',
    edgeAfter.mediaSrc === edgeBefore.mediaSrc && Math.abs(transformY(edgeAfter.current?.transform)) < 0.5,
    `${edgeAfter.mediaSrc === edgeBefore.mediaSrc ? 'unchanged' : 'CHANGED'}`);

  // ------------------------------------- 4. Videos tab: creator-scoped swipe
  await openPanelTab('Videos');
  const videosBefore = await readPopup(page);
  check('the Videos tab is open', Boolean(videosBefore.panel), videosBefore.panel ? 'panel up' : 'missing');
  await shot(page, 'popup-06-videos-tab-before.png');

  const panelTopBefore = videosBefore.panel?.top;
  const creatorBefore = videosBefore.creatorId;
  const videoClient = await drag(page, { dy: -Math.round(stageHeight * 0.34), hold: true });
  await page.waitForTimeout(90);
  const videosMid = await readPopup(page);
  check('the detail panel stays anchored while the post drags',
    Math.abs((videosMid.panel?.top ?? 0) - (panelTopBefore ?? 0)) <= 0.5
    && Math.abs(transformY(videosMid.panel?.transform)) < 0.5,
    `panel top ${panelTopBefore} -> ${videosMid.panel?.top}, transformY ${transformY(videosMid.panel?.transform)}`);
  await videoClient.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await videoClient.detach();
  await page.waitForTimeout(700);
  const videosAfter = await readPopup(page);
  check('the Videos tab swipe stayed inside the same creator',
    Boolean(creatorBefore) && videosAfter.creatorId === creatorBefore,
    `${creatorBefore} -> ${videosAfter.creatorId}`);
  /*
   * Moved — or correctly refused to, because the creator's grid ends here.
   * Home is ranked, so which creator the popup opens on varies per run, and a
   * creator whose catalogue ends at the open post is a legitimate edge rather
   * than a stuck gesture. `Next post` being disabled is what tells them apart.
   */
  const creatorNextAvailable = await page.evaluate(
    () => !document.querySelector('[data-post-detail-popup] button[aria-label="Next post"]')?.disabled
  );
  check('the Videos tab swipe moved, or the creator grid had nowhere left to go',
    videosAfter.mediaSrc !== videosBefore.mediaSrc || !creatorNextAvailable,
    `${videosAfter.mediaSrc === videosBefore.mediaSrc ? 'did not move' : 'moved'}, next available: ${creatorNextAvailable}`);
  check('the Videos tab is still open after the swipe', Boolean(videosAfter.panel));
  await shot(page, 'popup-07-videos-tab-after.png');

  // -------------------------------------------- 5. Comments tab: disabled
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[data-post-detail-popup] nav button')]
      .find((element) => element.textContent.trim() === 'Comments');
    if (tab) tab.click();
  });
  await page.waitForTimeout(1100);
  const commentsBefore = await readPopup(page);
  await drag(page, { dy: -Math.round(stageHeight * 0.5) });
  const commentsAfter = await readPopup(page);
  check('the Comments tab disables swipe navigation',
    commentsAfter.mediaSrc === commentsBefore.mediaSrc,
    `${commentsAfter.mediaSrc === commentsBefore.mediaSrc ? 'unchanged' : 'CHANGED'}`);
  check('the stage did not move at all in a disabled context',
    Math.abs(transformY(commentsAfter.current?.transform)) < 0.5,
    `${transformY(commentsAfter.current?.transform)}`);
  await shot(page, 'popup-08-comments-disabled.png');

  // ------------------------- 6. Messages open: panel scrolling must not move
  await page.locator('button[aria-label*="message" i]').first().click({ timeout: 6000 }).catch(() => null);
  await page.waitForTimeout(1000);
  const messagesBefore = await readPopup(page);
  // A drag that starts inside the Messages column.
  await drag(page, { dy: -Math.round(stageHeight * 0.5), x: W - 60 });
  const messagesAfter = await readPopup(page);
  check('dragging the Messages column never navigates the popup',
    messagesAfter.mediaSrc === messagesBefore.mediaSrc,
    `${messagesAfter.mediaSrc === messagesBefore.mediaSrc ? 'unchanged' : 'CHANGED'}`);
  await shot(page, 'popup-09-messages-open.png');

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 4).forEach((error) => console.log(`    ! ${error}`));
  console.log(`\n  frames: ${frames.join(', ')}`);

  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
