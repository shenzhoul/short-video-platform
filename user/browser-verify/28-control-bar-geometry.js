/**
 * Video control bar — is it inside the visible viewport at rest?
 *
 * Measures the four surfaces that draw a full-height video stage, immediately
 * after load, with no scrolling and no drag. The bar must be reachable without
 * pulling the post upward.
 *
 *   node browser-verify/28-control-bar-geometry.js 440 956
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
const rows = [];

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

/**
 * The transport bar, the stage it belongs to, and the visible viewport.
 *
 * The bar is found by the seek input it owns, not by a class — that is the one
 * element every surface's transport row certainly contains.
 */
async function readGeometry(page) {
  return page.evaluate(() => {
    /*
     * Scope everything to the surface under test.
     *
     * Home stays mounted behind an open popup, and its cards mount their own
     * `<video>` with their own transport row on hover — so an unscoped
     * `input[aria-label="Seek video"]` found a *grid card's* bar and compared
     * the popup's caption against it. That reported an 81px overlap that did
     * not exist.
     */
    const scope = document.querySelector('[data-post-detail-popup]')
      || document.querySelector('[data-testid="post-drag-viewport"]')
      || document;
    const seek = scope.querySelector('input[aria-label="Seek video"]');
    const bar = seek ? seek.closest('div[class*="absolute"][class*="bottom-0"]') || seek.parentElement?.parentElement : null;
    const stage = scope.querySelector('[data-testid="post-drag-current"]')
      || document.querySelector('[data-testid="post-drag-current"]')
      || document.querySelector('[data-testid="post-drag-viewport"]');
    const caption = scope.querySelector('[class*="bottom-20"], [class*="bottom-[76px]"]');
    const rail = scope.querySelector('aside[class*="flex-col"][class*="items-center"]');
    // A photo post has no transport bar at all; that is not a failure.
    const hasVideo = Boolean(scope.querySelector('video'));
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        top: Math.round(rect.top * 10) / 10,
        bottom: Math.round(rect.bottom * 10) / 10,
        height: Math.round(rect.height * 10) / 10
      };
    };
    const visualHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const safeBottom = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--safe-area-bottom') || '0'
    ) || 0;

    return {
      hasVideo,
      bar: box(bar),
      stage: box(stage),
      caption: box(caption),
      rail: box(rail),
      visualHeight,
      innerHeight: window.innerHeight,
      safeBottom,
      documentScrollsY: document.documentElement.scrollHeight > window.innerHeight + 1,
      // Is the bar's midpoint actually the bar, or is something over it?
      hitAtBar: bar ? (() => {
        const rect = bar.getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + 6));
        return hit ? `${hit.tagName.toLowerCase()}.${(hit.className || '').toString().slice(0, 24)}` : null;
      })() : null
    };
  });
}

function assertSurface(label, geometry) {
  rows.push({ surface: label, ...geometry });
  if (!geometry.bar) {
    if (!geometry.hasVideo) {
      console.log(`  ○ ${label}: the active post is a photo — no transport bar to place`);
      return;
    }
    check(`${label}: transport bar exists`, false, 'video present but no bar found');
    return;
  }
  const limit = geometry.visualHeight - geometry.safeBottom;
  check(`${label}: controlBar.bottom <= visualViewport.height - safeAreaBottom`,
    geometry.bar.bottom <= limit + 0.5,
    `${geometry.bar.bottom} <= ${Math.round(limit * 10) / 10}`);
  if (geometry.stage) {
    check(`${label}: activeStage.bottom <= visible surface bottom`,
      geometry.stage.bottom <= limit + 0.5,
      `${geometry.stage.bottom} <= ${Math.round(limit * 10) / 10}`);
  }
  check(`${label}: no document vertical overflow`, geometry.documentScrollsY === false);
  if (geometry.caption && geometry.bar) {
    check(`${label}: caption does not cover the control bar`,
      geometry.caption.bottom <= geometry.bar.top + 0.5,
      `caption bottom ${geometry.caption.bottom}, bar top ${geometry.bar.top}`);
  }
  check(`${label}: the bar's own row is on top at its position`,
    Boolean(geometry.hitAtBar), geometry.hitAtBar);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();

  console.log(`\n=== Control-bar geometry @ ${W}x${H} ===\n`);
  await signIn({ page }, ACCOUNT);

  // ---------------------------------------------------------------- For You
  await page.goto(`${USER_APP}/for-you`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  assertSurface('for-you', await readGeometry(page));
  await shot(page, `controls-${W}-1-for-you.png`);

  // -------------------------------------------------------------- Following
  await page.goto(`${USER_APP}/following`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  assertSurface('following', await readGeometry(page));
  await shot(page, `controls-${W}-2-following.png`);

  // ----------------------------------------------------------------- Friend
  await page.goto(`${USER_APP}/friend`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  assertSurface('friend', await readGeometry(page));
  await shot(page, `controls-${W}-3-friend.png`);

  // ------------------------------------------------------------ popup detail
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  // Open a *video* post, so a transport bar exists at all.
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('article[data-post-id]')]
      .find((element) => element.querySelector('video') || /\d\d:\d\d/.test(element.textContent || ''));
    (card || document.querySelector('article[data-post-id]'))?.dispatchEvent(
      new MouseEvent('click', { bubbles: true })
    );
  });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(2500);
  assertSurface('popup', await readGeometry(page));
  await shot(page, `controls-${W}-4-popup.png`);

  console.log('\n  | surface | bar top | bar bottom | visual h | safe bottom | doc scrolls |');
  console.log('  |---|---|---|---|---|---|');
  rows.forEach((row) => {
    console.log(`  | ${row.surface} | ${row.bar ? row.bar.top : '—'} | ${row.bar ? row.bar.bottom : '—'} | ${row.visualHeight} | ${row.safeBottom} | ${row.documentScrollsY} |`);
  });

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
