/**
 * 2.5 — the lazy-image intervention: browser notice, or a real blank frame?
 *
 * Edge/Chromium logs `[Intervention] Images loaded lazily and replaced with
 * placeholders` whenever a page uses `loading="lazy"`. That is a browser
 * notice, not an app error — but it is only harmless if no image the viewer is
 * actually looking at is blank when they look at it.
 *
 * So this does not argue about the message. It measures the two moments where a
 * blank frame would be visible and would matter:
 *
 *   - the post that is open in the popup;
 *   - the previous/next previews at the instant a drag begins.
 *
 * `complete && naturalWidth > 0` is the test: an <img> that has not decoded yet
 * answers false, and that is exactly the blank the report is about.
 */
const fs = require('fs');
const path = require('path');

const {
  chromium, USER_APP, signIn, SHOT_DIR, routeMediaOrigin
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const W = Number(process.env.W || 440);
const H = Number(process.env.H || 956);

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const POPUP = '[data-post-detail-popup]';

/** Every painted <img>, with its loading strategy and whether it has decoded. */
const imageState = (page, root) => page.evaluate((sel) => {
  const scope = sel ? document.querySelector(sel) : document;
  if (!scope) return { present: false, images: [] };
  const images = [...scope.querySelectorAll('img')]
    .filter((img) => {
      const b = img.getBoundingClientRect();
      // Only images the viewer can actually see right now.
      return b.width > 4 && b.height > 4 && b.bottom > 0 && b.top < window.innerHeight;
    })
    .map((img) => ({
      loading: img.loading,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      decoded: img.complete && img.naturalWidth > 0,
      width: Math.round(img.getBoundingClientRect().width),
      src: (img.currentSrc || img.src || '').slice(-46)
    }));
  return { present: true, images };
}, root);

const interventions = [];

async function openPopup(page) {
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  const card = page.locator('article[data-post-id]').first();
  if (!(await card.count())) return false;
  await card.click({ position: { x: 30, y: 60 } });
  await page.waitForSelector(POPUP, { timeout: 20000 }).catch(() => null);
  await page.waitForTimeout(2200);
  return page.evaluate((s) => Boolean(document.querySelector(s)), POPUP);
}

/** Step forward until the popup is showing a photo post. */
async function reachPhotoPost(page) {
  for (let i = 0; i < 22; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const layout = await page.evaluate((s) => document.querySelector(s)?.getAttribute('data-post-detail-popup'), POPUP);
    if (layout === 'graphic') return true;
    // eslint-disable-next-line no-await-in-loop
    const moved = await page.evaluate((s) => {
      const b = document.querySelector(`${s} button[aria-label="Next post"]`);
      if (!b || b.disabled) return false;
      b.click();
      return true;
    }, POPUP);
    if (!moved) return false;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1400);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (/Intervention|loaded lazily/i.test(msg.text())) interventions.push(msg.text().slice(0, 160));
  });
  await signIn({ page }, ACCOUNT);

  console.log(`\n=== lazy-image intervention @ ${W}x${H} ===`);

  // ------------------------------------------------- the Home grid itself
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const grid = await imageState(page, null);
  const lazyInGrid = grid.images.filter((i) => i.loading === 'lazy');
  const blankInView = grid.images.filter((i) => !i.decoded);
  console.log(`  home grid: ${grid.images.length} visible images, ${lazyInGrid.length} lazy`);
  check('no visible Home image is blank', blankInView.length === 0,
    blankInView.length ? blankInView.slice(0, 3).map((i) => `${i.loading}:${i.src}`).join(' | ') : 'all decoded');
  check('the grid still uses lazy loading (not switched wholesale to eager)',
    lazyInGrid.length > 0, `${lazyInGrid.length} lazy of ${grid.images.length}`);

  // ------------------------------------------------------ the open post
  const opened = await openPopup(page);
  check('popup opens', opened);
  if (opened) {
    const onPhoto = await reachPhotoPost(page);
    await page.waitForTimeout(1200);
    const stage = await imageState(page, POPUP);
    const undecoded = stage.images.filter((i) => !i.decoded);
    console.log(`  popup stage: ${stage.images.length} visible images -> ${JSON.stringify(stage.images.slice(0, 3))}`);
    check('the open post renders no blank image', undecoded.length === 0,
      undecoded.length ? JSON.stringify(undecoded.slice(0, 2)) : 'all decoded');
    check('reached a photo post to test the graphic stage', onPhoto, `graphic=${onPhoto}`);

    // -------------------------------------------- the instant a drag begins
    const stageBox = await page.evaluate((s) => {
      const el = document.querySelector(`${s}`);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, POPUP);
    if (stageBox) {
      await page.mouse.move(stageBox.x, stageBox.y);
      await page.mouse.down();
      await page.mouse.move(stageBox.x, stageBox.y - 40, { steps: 4 });
      // Measure while the drag is still in progress — this is the moment the
      // previous/next previews are revealed.
      const during = await imageState(page, '[data-testid="post-drag-current"], ' + POPUP);
      const blankDuringDrag = during.images.filter((i) => !i.decoded);
      console.log(`  during drag: ${during.images.length} visible images, ${blankDuringDrag.length} undecoded`);
      check('no blank frame is revealed at the start of a drag', blankDuringDrag.length === 0,
        blankDuringDrag.length ? JSON.stringify(blankDuringDrag.slice(0, 2)) : 'all decoded');
      await page.mouse.move(stageBox.x, stageBox.y, { steps: 3 });
      await page.mouse.up();
      await page.waitForTimeout(900);
    }
    await page.screenshot({ path: path.join(SHOT_DIR, `45-lazy-popup-${W}x${H}.png`) });
  }

  console.log(`\n  intervention notices seen: ${interventions.length}`);
  interventions.slice(0, 3).forEach((t) => console.log(`    ${t}`));

  const out = path.join(SHOT_DIR, '..', 'lazy-image-intervention.json');
  fs.writeFileSync(out, JSON.stringify({
    viewport: `${W}x${H}`, grid, interventions
  }, null, 2));
  console.log(`\nwrote ${out}`);

  await context.close();
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
