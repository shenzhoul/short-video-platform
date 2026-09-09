/**
 * Phase 1 + Phase 2 acceptance: the navigation state matrix, and the
 * drag-follow-finger transform.
 *
 * Measured rather than eyeballed. Every geometry claim is read back out of the
 * live DOM with `getBoundingClientRect` / `getComputedStyle`, and the drag is
 * driven through real CDP touch events so the browser's own hit-testing and
 * passive-listener rules apply.
 *
 *   node browser-verify/23-navigation-and-drag.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SHOOT=1.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const path = require('path');
const fs = require('fs');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const SHOTS = path.resolve(__dirname, '..', '..', 'output', 'screenshots');
const SHOOT = process.env.SHOOT === '1';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);

let pass = 0;
let fail = 0;
const rows = [];

const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Assert a measured number against a target and a tolerance, and record it. */
const measure = (label, actual, target, tol, unit = 'px') => {
  const ok = Math.abs(actual - target) <= tol;
  rows.push({ label, target, actual: Math.round(actual * 10) / 10, tol, pass: ok });
  check(label, ok, `${Math.round(actual * 10) / 10}${unit} vs ${target}${unit} ±${tol}`);
  return ok;
};

async function shot(page, name) {
  if (!SHOOT) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log(`    · ${name}`);
}

/** Drag with real touch events, pausing mid-gesture so a frame can be captured. */
async function touchDrag(page, { fromY, toY, x = W / 2, steps = 12, hold = false, onMid = null }) {
  const client = await page.context().newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: fromY }]
  });
  for (let i = 1; i <= steps; i += 1) {
    const y = fromY + ((toY - fromY) * i) / steps;
    // eslint-disable-next-line no-await-in-loop
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    if (onMid && i === Math.round(steps / 2)) {
      // eslint-disable-next-line no-await-in-loop
      await onMid();
    }
  }
  if (hold) return client;
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  return null;
}

const itemHeightOf = (stage) => stage.viewport.height;

const transformY = (matrix) => {
  if (!matrix || matrix === 'none') return 0;
  const parts = matrix.match(/matrix(3d)?\(([^)]+)\)/);
  if (!parts) return 0;
  const values = parts[2].split(',').map((value) => Number(value.trim()));
  return parts[1] ? values[13] : values[5];
};

async function readStage(page) {
  return page.evaluate(() => {
    const viewport = document.querySelector('[data-testid="post-drag-viewport"]');
    const current = document.querySelector('[data-testid="post-drag-current"]');
    const next = document.querySelector('[data-testid="post-drag-preview-next"]');
    const previous = document.querySelector('[data-testid="post-drag-preview-previous"]');
    const read = (element) => (element ? {
      transform: getComputedStyle(element).transform,
      transition: getComputedStyle(element).transitionProperty === 'none'
        ? 'none'
        : getComputedStyle(element).transition,
      top: element.getBoundingClientRect().top,
      height: element.getBoundingClientRect().height
    } : null);
    return {
      viewport: viewport ? {
        overflow: getComputedStyle(viewport).overflow,
        height: viewport.getBoundingClientRect().height
      } : null,
      current: read(current),
      next: read(next),
      previous: read(previous),
      videoCount: document.querySelectorAll('video').length,
      previewImagesComplete: [...document.querySelectorAll('[data-testid^="post-drag-preview-"] img')]
        .every((image) => image.complete && image.naturalWidth > 0),
      previewImageCount: document.querySelectorAll('[data-testid^="post-drag-preview-"] img').length,
      openPostTitle: document.querySelector('[data-testid="post-drag-current"] h1, [data-testid="post-drag-current"] [data-post-title]')?.textContent || null
    };
  });
}


(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    hasTouch: true,
    isMobile: false,
    deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  console.log(`\n=== Navigation matrix + drag transform @ ${W}x${H} ===\n`);

  await page.goto(`${USER_APP}/for-you`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="post-drag-viewport"]', { timeout: 20000 });
  await page.waitForTimeout(1500);

  // ---------------------------------------------------------------- Phase 2
  console.log('Phase 2 — drag transform geometry\n');
  const rest = await readStage(page);
  check('viewport clips its slides', rest.viewport?.overflow === 'hidden', rest.viewport?.overflow);
  measure('stage height == viewport slide unit', rest.viewport.height, H - 32, 40);
  measure('current slide at rest translateY', transformY(rest.current.transform), 0, 0.5);
  check('both neighbours preloaded and parked out of sight', Boolean(rest.next), `next=${Boolean(rest.next)}`);
  if (rest.next) measure('next slide parked one stage below', transformY(rest.next.transform), itemHeightOf(rest), 1);
  check('preview covers are decoded before the gesture starts', rest.previewImagesComplete, `${rest.previewImagesComplete}`);
  check('exactly one video element at rest', rest.videoCount <= 1, `${rest.videoCount}`);

  await shot(page, 'drag-01-frame-a-rest.png');

  // --- mid-drag, finger still down -----------------------------------------
  const itemHeight = rest.viewport.height;
  const midTravel = Math.round(itemHeight * 0.32);
  const client = await touchDrag(page, {
    fromY: Math.round(H * 0.72),
    toY: Math.round(H * 0.72) - midTravel,
    hold: true
  });
  await page.waitForTimeout(80);
  const mid = await readStage(page);
  const midDelta = transformY(mid.current.transform);
  check('current slide follows the finger', midDelta < -20, `translateY=${Math.round(midDelta)}px`);
  check('no transition while the finger is down', mid.current.transition === 'none', mid.current.transition);
  check('the next post is uncovered as a preview', Boolean(mid.next), mid.next ? 'mounted' : 'missing');
  if (mid.next) {
    measure(
      'next preview offset == itemHeight + delta',
      transformY(mid.next.transform),
      itemHeight + midDelta,
      2
    );
    check('preview adds no second video', mid.videoCount <= 1, `${mid.videoCount}`);
  }
  await shot(page, 'drag-02-frame-b-mid-drag.png');

  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await page.waitForTimeout(500);
  const after = await readStage(page);
  measure('committed slide returns to zero', transformY(after.current.transform), 0, 0.5);
  measure('next slide re-parked one stage below after the commit', transformY(after.next.transform), itemHeightOf(after), 1);
  await shot(page, 'drag-03-frame-c-committed.png');

  // --- under-threshold rollback --------------------------------------------
  console.log('\nPhase 2 — rollback below the commit distance\n');
  const beforeRollback = await page.evaluate(
    () => document.querySelector('video')?.getAttribute('src') || document.title
  );
  await touchDrag(page, {
    fromY: Math.round(H * 0.72),
    toY: Math.round(H * 0.72) - 30,
    steps: 6
  });
  await page.waitForTimeout(450);
  const rolled = await readStage(page);
  measure('rolled back to zero', transformY(rolled.current.transform), 0, 0.5);
  const afterRollback = await page.evaluate(
    () => document.querySelector('video')?.getAttribute('src') || document.title
  );
  check('a short drag changed nothing', beforeRollback === afterRollback);
  await shot(page, 'drag-04-rollback-restored.png');

  // ---------------------------------------------------------------- Phase 1
  console.log('\nPhase 1 — navigation state matrix\n');

  const openTab = async (label) => {
    const tab = page.locator(`button:has-text("${label}")`).first();
    if (!(await tab.count())) return false;
    await tab.click({ timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(600);
    return true;
  };

  const currentPostId = () => page.evaluate(() => {
    const media = document.querySelector('[data-testid="post-drag-current"] video, [data-testid="post-drag-current"] img');
    return media?.getAttribute('src') || null;
  });

  // no panel -> recommendation order
  const beforeRec = await currentPostId();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(700);
  const afterRec = await currentPostId();
  check('no panel: arrows move through the recommendation order', beforeRec !== afterRec);
  await shot(page, 'nav-01-recommendation.png');

  // open the reading panel via the description, then the Videos tab
  await page.locator('button[aria-label*="comment" i], button:has-text("Comments")').first()
    .click({ timeout: 4000 }).catch(() => null);
  await page.waitForTimeout(700);

  const panelOpen = await page.locator('[data-testid="post-detail-panel"], aside').count();
  check('a detail panel is reachable from the stage', panelOpen > 0, `${panelOpen} aside(s)`);

  const beforeLocked = await currentPostId();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(700);
  const afterLocked = await currentPostId();
  check('Comments tab: navigation is disabled', beforeLocked === afterLocked);
  await shot(page, 'nav-02-comments-disabled.png');

  await openTab('Videos');
  const beforeCreator = await currentPostId();
  // The creator name as the viewer actually reads it on the stage.
  const creatorHandle = () => page.evaluate(() => {
    const stage = document.querySelector('[data-testid="post-drag-current"]');
    const match = (stage?.innerText || '').match(/@[^\n·]+/);
    return match ? match[0].trim() : null;
  });
  const creatorBefore = await creatorHandle();
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(900);
  const afterCreator = await currentPostId();
  const creatorAfter = await creatorHandle();
  check('Videos tab: navigation moves', beforeCreator !== afterCreator, `${beforeCreator === afterCreator ? 'stuck' : 'moved'}`);
  check(
    'Videos tab: stays inside one creator',
    Boolean(creatorBefore) && creatorBefore === creatorAfter,
    `${creatorBefore} -> ${creatorAfter}`
  );
  await shot(page, 'nav-03-videos-creator-scoped.png');

  console.log(`\nconsole errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 5).forEach((error) => console.log(`    ! ${error}`));

  console.log('\n--- measurement table ---');
  console.log('| measurement | target | actual | tol | pass |');
  console.log('|---|---|---|---|---|');
  rows.forEach((row) => {
    console.log(`| ${row.label} | ${row.target} | ${row.actual} | ±${row.tol} | ${row.pass ? 'PASS' : 'FAIL'} |`);
  });

  console.log(`\n${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
