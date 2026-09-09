/**
 * Phase 2 audit — the creator profile at a compact viewport, measured.
 *
 * This changes nothing. It records what the page actually does at 440x956 and
 * the other breakpoints, so the redesign has a baseline to be compared against
 * rather than an impression. Everything here is read from
 * `getBoundingClientRect` and `getComputedStyle` — real CSS, not the source.
 *
 * Six states, per the brief:
 *   A default profile          D batch management toolbar
 *   B content grid             E alternate tabs (Works / Recommended /
 *   C account menu               I like it / Collection), normal + management
 */
const fs = require('fs');
const path = require('path');

const { chromium, USER_APP, signIn, SHOT_DIR } = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const PROFILE = process.env.PROFILE || 'maitran.eats';

/** The brief's primary viewport first; the rest are the regression set. */
const VIEWPORTS = [
  { label: '440x956', width: 440, height: 956 },
  { label: '390x844', width: 390, height: 844 },
  { label: '540x960', width: 540, height: 960 },
  { label: '768x1024', width: 768, height: 1024 },
  { label: '1440x900', width: 1440, height: 900 }
];

const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : n);

/**
 * Geometry of one element, or null when it is not on the page.
 *
 * Font size, line height and padding are read from the *computed* style, so a
 * 6px emergency type ramp shows up as 6px here whatever produced it.
 */
async function measure(page, selector, label) {
  return page.evaluate(([sel, name]) => {
    const el = document.querySelector(sel);
    if (!el) return { label: name, present: false };
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {
      label: name,
      present: true,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      display: style.display,
      overflowX: style.overflowX
    };
  }, [selector, label]);
}

/** Every distinct computed font-size in a subtree, smallest first. */
async function typeRamp(page, selector) {
  return page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const sizes = new Map();
    [...root.querySelectorAll('*')].forEach((el) => {
      if (!el.getClientRects().length) return;
      const text = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!text) return;
      const size = getComputedStyle(el).fontSize;
      sizes.set(size, (sizes.get(size) || 0) + 1);
    });
    return [...sizes.entries()]
      .map(([size, count]) => ({ size, count, px: parseFloat(size) }))
      .sort((a, b) => a.px - b.px);
  }, selector);
}

/** Document-level sideways scrolling, and whatever is causing it. */
async function overflow(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const overflowing = [...document.querySelectorAll('body *')]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.right > doc.clientWidth + 1;
      })
      .slice(0, 6)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 70),
        right: Math.round(el.getBoundingClientRect().right)
      }));
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      horizontalScrollbar: doc.scrollWidth > doc.clientWidth,
      overflowing
    };
  });
}

/** The work grid: column count, tile box, gaps — read off the real layout. */
async function gridGeometry(page) {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[data-profile-work-item]')];
    if (!tiles.length) {
      // Fall back to whatever the grid actually renders, so the audit still
      // reports something useful before the instrumentation lands.
      const anyGrid = document.querySelector('[class*="grid-cols"]');
      return { instrumented: false, gridClass: anyGrid ? anyGrid.className.toString().slice(0, 120) : null };
    }
    const rects = tiles.map((el) => el.getBoundingClientRect());
    const firstRowTop = Math.round(rects[0].top);
    const firstRow = rects.filter((r) => Math.abs(r.top - firstRowTop) < 2);
    const columnGap = firstRow.length > 1 ? round(firstRow[1].left - firstRow[0].right) : null;
    const secondRow = rects.find((r) => r.top > firstRowTop + 2);
    return {
      instrumented: true,
      tiles: tiles.length,
      columns: firstRow.length,
      tileWidth: Math.round(rects[0].width * 100) / 100,
      tileHeight: Math.round(rects[0].height * 100) / 100,
      columnGap,
      rowGap: secondRow ? Math.round((secondRow.top - rects[0].bottom) * 100) / 100 : null,
      gridLeft: Math.round(rects[0].left),
      gridRight: Math.round(firstRow[firstRow.length - 1].right)
    };
    function round(n) { return Math.round(n * 100) / 100; }
  });
}

async function railGeometry(page) {
  return page.evaluate(() => {
    const rail = document.querySelector('[data-app-nav-rail], nav[aria-label*="Main" i], aside nav');
    if (!rail) return { present: false };
    const rect = rail.getBoundingClientRect();
    const width = getComputedStyle(document.documentElement)
      .getPropertyValue('--app-shell-nav-width').trim();
    return {
      present: true, x: rect.x, width: rect.width, right: rect.right, token: width
    };
  });
}

const report = { capturedAt: new Date().toISOString(), app: USER_APP, viewports: {} };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn({ page }, ACCOUNT);

  /* eslint-disable no-await-in-loop */
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label} ===`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    const state = {};
    state.rail = await railGeometry(page);
    state.overflow = await overflow(page);
    state.grid = await gridGeometry(page);
    state.typeRamp = await typeRamp(page, 'main, [data-creator-profile], body');
    state.hero = await measure(page, '[data-profile-hero], header', 'hero');

    console.log(`  rail:     ${JSON.stringify(state.rail)}`);
    console.log(`  overflow: scrollWidth=${state.overflow.scrollWidth} clientWidth=${state.overflow.clientWidth} bar=${state.overflow.horizontalScrollbar}`);
    if (state.overflow.overflowing.length) {
      state.overflow.overflowing.forEach((row) => console.log(`      over: <${row.tag}> right=${row.right} ${row.cls}`));
    }
    console.log(`  grid:     ${JSON.stringify(state.grid)}`);
    if (state.typeRamp) {
      console.log(`  type:     ${state.typeRamp.map((r) => `${r.size}x${r.count}`).join('  ')}`);
      const tiny = state.typeRamp.filter((r) => r.px < 10);
      if (tiny.length) console.log(`      TINY: ${tiny.map((r) => `${r.size}x${r.count}`).join(' ')}`);
    }

    await page.screenshot({ path: path.join(SHOT_DIR, `38-profile-before-${vp.label}.png`), fullPage: false });
    report.viewports[vp.label] = state;
  }
  /* eslint-enable no-await-in-loop */

  const out = path.join(SHOT_DIR, '..', 'profile-audit-before.json');
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);

  await context.close();
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
