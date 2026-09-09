/**
 * Phase 2 — the navigation capsule on mobile, and the button/swipe state leak.
 *
 * Two questions:
 *   1. Is the next/previous capsule really gone at a compact viewport — not
 *      just invisible, but with no hit target and no focusable control?
 *   2. Does a *button* press leave the shared drag state in a condition where
 *      the next gesture is ignored?
 *
 *   node browser-verify/29-nav-button-swipe-alternation.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SHOOT=1.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const path = require('path');
const fs = require('fs');
const { signIn, routeMediaOrigin } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const SHOTS = path.resolve(__dirname, '..', '..', 'output', 'screenshots');
const SHOOT = process.env.SHOOT === '1';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const COMPACT = W < 1024;
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function shot(page, name) {
  if (!SHOOT) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log(`    · ${name}`);
}

/** A real touch gesture over the stage. */
async function swipe(page, dy) {
  const client = await page.context().newCDPSession(page);
  const x = Math.round(W * 0.45);
  const y = Math.round(H * 0.55);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 12; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 12 }] });
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await client.detach();
  await page.waitForTimeout(700);
}

/** How the capsule presents itself: painted, hit-testable, focusable. */
async function capsuleState(page, scope) {
  return page.evaluate((selector) => {
    const root = selector ? document.querySelector(selector) : document;
    const buttons = [...(root?.querySelectorAll('button[aria-label="Next post"], button[aria-label="Previous post"]') || [])];
    if (!buttons.length) return { count: 0 };
    return {
      count: buttons.length,
      displayed: buttons.some((button) => {
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(button).display !== 'none';
      }),
      // A `display:none` control is not at any point, and not tabbable.
      hitTestable: buttons.some((button) => {
        const rect = button.getBoundingClientRect();
        if (!rect.width || !rect.height) return false;
        const hit = document.elementFromPoint(
          Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)
        );
        return Boolean(hit && (hit === button || button.contains(hit)));
      }),
      focusable: buttons.some((button) => {
        button.focus();
        return document.activeElement === button;
      })
    };
  }, scope);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  await routeMediaOrigin(context);
  const page = await context.newPage();

  console.log(`\n=== Nav capsule + button/swipe alternation @ ${W}x${H} ===\n`);
  await signIn({ page }, ACCOUNT);

  // ------------------------------------------------------------ the popup
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  await page.waitForTimeout(1800);

  const popupCapsule = await capsuleState(page, '[data-post-detail-popup]');
  console.log(`  popup capsule: ${JSON.stringify(popupCapsule)}`);
  if (COMPACT) {
    check('popup: the capsule is not painted at a compact viewport', popupCapsule.displayed !== true);
    check('popup: the capsule keeps no pointer hit target', popupCapsule.hitTestable !== true);
    check('popup: the capsule is not focusable', popupCapsule.focusable !== true);
  } else {
    check('popup: the capsule is present at desktop', popupCapsule.displayed === true);
  }
  await shot(page, `nav-capsule-${W}-1-popup.png`);

  // --------------------------------------- button -> swipe -> button -> swipe
  const openId = () => page.evaluate(() => new URL(window.location.href).searchParams.get('modal_id'));
  const pressNext = async () => {
    await page.evaluate(() => {
      const button = document.querySelector('[data-post-detail-popup] button[aria-label="Next post"]');
      if (button && !button.disabled) button.click();
    });
    await page.waitForTimeout(850);
  };

  const trail = [await openId()];
  const steps = [];
  for (let cycle = 0; cycle < 4; cycle += 1) {
    // eslint-disable-next-line no-await-in-loop
    await pressNext();
    // eslint-disable-next-line no-await-in-loop
    const afterButton = await openId();
    steps.push({ how: 'button', id: afterButton, moved: afterButton !== trail[trail.length - 1] });
    trail.push(afterButton);

    // eslint-disable-next-line no-await-in-loop
    await swipe(page, -Math.round(H * 0.4));
    // eslint-disable-next-line no-await-in-loop
    const afterSwipe = await openId();
    steps.push({ how: 'swipe', id: afterSwipe, moved: afterSwipe !== trail[trail.length - 1] });
    trail.push(afterSwipe);
  }

  console.log('\n  alternation trail:');
  steps.forEach((step, index) => {
    console.log(`    ${index + 1}. ${step.how.padEnd(6)} -> ${String(step.id).slice(-6)} ${step.moved ? 'moved' : 'STUCK'}`);
  });

  const swipeSteps = steps.filter((step) => step.how === 'swipe');
  const buttonSteps = steps.filter((step) => step.how === 'button');
  check('every button press moved the post', buttonSteps.every((step) => step.moved),
    `${buttonSteps.filter((step) => step.moved).length}/${buttonSteps.length}`);
  check('every swipe after a button press still moved the post',
    swipeSteps.every((step) => step.moved),
    `${swipeSteps.filter((step) => step.moved).length}/${swipeSteps.length}`);
  const dupes = trail.filter((id, index) => trail.indexOf(id) !== index);
  check('alternating never revisited a post', dupes.length === 0, `${dupes.length} repeat(s)`);
  await shot(page, `nav-capsule-${W}-2-after-alternation.png`);

  // -------------------------------------------------------------- For You
  await page.goto(`${USER_APP}/for-you`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  const feedCapsule = await capsuleState(page, null);
  console.log(`\n  for-you capsule: ${JSON.stringify(feedCapsule)}`);
  if (COMPACT) {
    check('for-you: the capsule is not painted at a compact viewport', feedCapsule.displayed !== true);
    check('for-you: the capsule keeps no pointer hit target', feedCapsule.hitTestable !== true);
    check('for-you: the capsule is not focusable', feedCapsule.focusable !== true);
  }

  const feedMedia = () => page.evaluate(() => document
    .querySelector('[data-testid="post-drag-current"] video, [data-testid="post-drag-current"] img')
    ?.getAttribute('src') || null);
  const feedTrail = [await feedMedia()];
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await swipe(page, -Math.round(H * 0.4));
    // eslint-disable-next-line no-await-in-loop
    feedTrail.push(await feedMedia());
  }
  const feedMoves = feedTrail.slice(1).filter((id, index) => id !== feedTrail[index]).length;
  check('for-you: three consecutive swipes each moved the post', feedMoves === 3, `${feedMoves}/3`);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
