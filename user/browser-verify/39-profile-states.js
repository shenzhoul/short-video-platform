/**
 * Phase 2 — the six profile states, captured and measured.
 *
 * Run with `PHASE=before` (default) or `PHASE=after`; the file names carry the
 * phase so the pairs sit next to each other in `output/screenshots`. Nothing
 * here reads the source: every number is `getBoundingClientRect` /
 * `getComputedStyle` against the running production build.
 *
 *   A default profile        D batch management
 *   B content grid           E alternate tabs, normal + management
 *   C account menu
 */
const fs = require('fs');
const path = require('path');

const { chromium, USER_APP, signIn, SHOT_DIR } = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const PROFILE = process.env.PROFILE || 'maitran.eats';
const PHASE = process.env.PHASE || 'before';
const W = Number(process.env.W || 440);
const H = Number(process.env.H || 956);

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const round = (n) => Math.round(n * 100) / 100;

/** Document-level sideways scrolling, and the widest offenders inside a root. */
const overflowOf = (page, rootSelector) => page.evaluate((sel) => {
  const doc = document.documentElement;
  const root = sel ? document.querySelector(sel) : document.body;
  const limit = root ? root.getBoundingClientRect().right : doc.clientWidth;
  const offenders = root
    ? [...root.querySelectorAll('*')]
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        // Ignore things that are not painted — hover panels are positioned
        // off-box while hidden and are not what "the toolbar overflows" means.
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.opacity === '0') return false;
        return rect.width > 0 && rect.right > limit + 1;
      })
      .slice(0, 5)
      .map((el) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 30),
        right: Math.round(el.getBoundingClientRect().right)
      }))
    : [];
  return {
    pageScrollWidth: doc.scrollWidth,
    pageClientWidth: doc.clientWidth,
    horizontalScrollbar: doc.scrollWidth > doc.clientWidth,
    limit: Math.round(limit),
    offenders
  };
}, rootSelector);

/** Do any two painted boxes in this row actually overlap? */
const overlapsIn = (page, rootSelector) => page.evaluate((sel) => {
  const root = document.querySelector(sel);
  if (!root) return { present: false };
  // Leaf elements that carry their own text — the things that visually
  // "concatenate" when a row runs out of width.
  const leaves = [...root.querySelectorAll('*')].filter((el) => {
    if (!el.getClientRects().length) return false;
    return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  });
  const hits = [];
  for (let i = 0; i < leaves.length; i += 1) {
    for (let j = i + 1; j < leaves.length; j += 1) {
      const a = leaves[i];
      const b = leaves[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = a.getBoundingClientRect();
      const rb = b.getBoundingClientRect();
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapX > 1 && overlapY > 1) {
        hits.push({
          a: (a.textContent || '').trim().slice(0, 22),
          b: (b.textContent || '').trim().slice(0, 22),
          overlapX: Math.round(overlapX)
        });
      }
    }
  }
  return { present: true, count: hits.length, hits: hits.slice(0, 6) };
}, rootSelector);

/** Grid geometry, read off the rendered tiles. */
const gridOf = (page) => page.evaluate(() => {
  const list = document.querySelector('ul.grid');
  if (!list) return { present: false };
  const tiles = [...list.children];
  if (!tiles.length) return { present: false };
  const rects = tiles.map((el) => el.getBoundingClientRect());
  const top = Math.round(rects[0].top);
  const firstRow = rects.filter((r) => Math.abs(r.top - top) < 2);
  const second = rects.find((r) => r.top > top + 2);
  const style = getComputedStyle(list);
  return {
    present: true,
    tiles: tiles.length,
    columns: firstRow.length,
    tileWidth: Math.round(rects[0].width * 100) / 100,
    tileHeight: Math.round(rects[0].height * 100) / 100,
    columnGap: style.columnGap,
    rowGap: style.rowGap,
    left: Math.round(rects[0].left),
    right: Math.round(firstRow[firstRow.length - 1].right),
    firstRowTop: top,
    secondRowTop: second ? Math.round(second.top) : null
  };
});

/** Smallest painted text size inside a subtree, and the whole ramp. */
const rampOf = (page, sel) => page.evaluate((selector) => {
  const root = document.querySelector(selector);
  if (!root) return null;
  const sizes = new Map();
  [...root.querySelectorAll('*')].forEach((el) => {
    if (!el.getClientRects().length) return;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const size = getComputedStyle(el).fontSize;
    sizes.set(size, (sizes.get(size) || 0) + 1);
  });
  return [...sizes.entries()]
    .map(([size, count]) => ({ size, count, px: parseFloat(size) }))
    .sort((a, b) => a.px - b.px);
}, sel);

const box = (page, sel) => page.evaluate((selector) => {
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const s = getComputedStyle(el);
  return {
    x: Math.round(r.x),
    y: Math.round(r.y),
    width: Math.round(r.width),
    height: Math.round(r.height),
    right: Math.round(r.right),
    bottom: Math.round(r.bottom),
    fontSize: s.fontSize,
    padding: `${s.paddingTop} ${s.paddingRight} ${s.paddingBottom} ${s.paddingLeft}`,
    overflowY: s.overflowY
  };
}, sel);

const railBox = (page) => page.evaluate(() => {
  const rail = document.querySelector('[data-app-nav-rail]');
  if (!rail) return null;
  const r = rail.getBoundingClientRect();
  return {
    x: Math.round(r.x),
    width: Math.round(r.width),
    right: Math.round(r.right),
    token: getComputedStyle(document.documentElement).getPropertyValue('--app-shell-nav-width').trim()
  };
});

const shot = async (page, name) => {
  const file = path.join(SHOT_DIR, `39-${PHASE}-${name}.png`);
  await page.screenshot({ path: file });
  return path.basename(file);
};

const report = { phase: PHASE, viewport: `${W}x${H}`, states: {} };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await signIn({ page }, ACCOUNT);
  await page.setViewportSize({ width: W, height: H });

  console.log(`\n=== profile states @ ${W}x${H} (${PHASE}) ===`);

  // ---------------------------------------------------------------- A + B
  console.log('\n--- A: default profile / B: content grid ---');
  await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const rail = await railBox(page);
  const grid = await gridOf(page);
  const pageOverflow = await overflowOf(page, null);
  const ramp = await rampOf(page, '.bg-profile');
  const heroRamp = await rampOf(page, 'h1');

  console.log(`  rail:  ${JSON.stringify(rail)}`);
  console.log(`  grid:  ${JSON.stringify(grid)}`);
  console.log(`  ramp (works column): ${ramp ? ramp.map((r) => `${r.size}x${r.count}`).join(' ') : 'n/a'}`);

  check('no horizontal page scrollbar', !pageOverflow.horizontalScrollbar,
    `scrollWidth=${pageOverflow.pageScrollWidth} clientWidth=${pageOverflow.pageClientWidth}`);
  check('grid renders three columns', grid.present && grid.columns === 3, `columns=${grid.columns}`);
  check('grid clears the left rail', grid.present && rail && grid.left >= rail.right,
    `gridLeft=${grid.left} railRight=${rail ? rail.right : '?'}`);
  check('grid stays inside the viewport', grid.present && grid.right <= W,
    `gridRight=${grid.right} viewport=${W}`);
  check('column and row gaps agree', grid.present && grid.columnGap === grid.rowGap,
    `column=${grid.columnGap} row=${grid.rowGap}`);
  check('grid starts in the top half of the viewport', grid.present && grid.firstRowTop < H / 2,
    `firstRowTop=${grid.firstRowTop} (${Math.round((grid.firstRowTop / H) * 100)}% of viewport)`);
  const worksFloor = ramp && ramp[0] ? ramp[0].px : null;
  check('no emergency typography in the works column (>= 10px)', worksFloor === null || worksFloor >= 10,
    `smallest=${worksFloor}px`);

  report.states.defaultProfile = {
    rail, grid, pageOverflow, ramp, heroRamp
  };
  report.states.defaultProfile.shot = await shot(page, 'A-default-profile');

  // -------------------------------------------------------------------- C
  console.log('\n--- C: account menu ---');
  const triggerBox = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('header button')];
    const trigger = buttons[buttons.length - 1];
    if (!trigger) return null;
    const r = trigger.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  // A real hover, not a synthesised event: the dropdown opens on `mouseenter`
  // of its own wrapper, and a dispatched event on the inner button does not
  // reach it the way a pointer does.
  if (triggerBox) await page.mouse.move(triggerBox.x, triggerBox.y);
  await page.waitForTimeout(1500);
  const menuOpened = Boolean(triggerBox);
  const menu = await box(page, '[data-account-menu]');
  console.log(`  trigger found=${menuOpened} menu=${JSON.stringify(menu)}`);
  if (menu) {
    check('account menu does not cover the left rail', rail === null || menu.x >= rail.right,
      `menuLeft=${menu.x} railRight=${rail ? rail.right : '?'}`);
    /*
      "Anchored upper-right" is a statement about the panel's right and top
      edges, not its left one: a 304px panel in a 440px viewport legitimately
      starts at x=134, and an earlier `x > W/3` test failed it for being the
      compact width the brief asked for.
    */
    check('account menu is anchored upper-right',
      menu.right <= W + 1 && W - menu.right <= 16 && menu.y <= 64,
      `right=${menu.right} (viewport ${W}, inset ${W - menu.right}) top=${menu.y}`);
    check('account menu fits the viewport height', menu.height <= H,
      `height=${menu.height} viewport=${H}`);
    const coverage = round(((menu.width * menu.height) / (W * H)) * 100);
    check('account menu covers less than half the viewport', coverage < 50, `coverage=${coverage}%`);
    report.states.accountMenu = { menu, coverage };
  } else {
    console.log('  (no [data-account-menu] hook yet — not instrumented)');
    report.states.accountMenu = { menu: null };
  }
  report.states.accountMenu.shot = await shot(page, 'C-account-menu');

  // A panel that cannot be dismissed is worse than one that is slightly wide.
  const menuVisible = () => page.evaluate(() => Boolean(document.querySelector('[data-account-menu]')));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const afterEscape = await menuVisible();
  check('account menu closes on Escape', !afterEscape, `stillOpen=${afterEscape}`);

  /*
    Leave the trigger before returning to it. After Escape the pointer is still
    sitting on the avatar, and moving to the same coordinates fires no new
    `mouseenter` — so a naive re-hover reports "did not reopen" for a menu that
    is behaving correctly. Escape is a dismissal; the panel is meant to stay
    closed until the pointer actually leaves and comes back.
  */
  await page.mouse.move(W / 2, H / 2);
  await page.waitForTimeout(400);
  if (triggerBox) await page.mouse.move(triggerBox.x, triggerBox.y);
  await page.waitForTimeout(1200);
  const reopened = await menuVisible();
  // Move the pointer to the middle of the page, which is "outside" for a
  // hover-opened panel and a click target for a click-opened one.
  await page.mouse.move(W / 2, H - 120);
  await page.mouse.click(W / 2, H - 120);
  await page.waitForTimeout(900);
  const afterOutside = await menuVisible();
  check('account menu closes on an outside click', reopened && !afterOutside,
    `reopened=${reopened} stillOpen=${afterOutside}`);
  await page.waitForTimeout(400);

  // -------------------------------------------------------------------- D
  console.log('\n--- D: batch management ---');
  await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const entered = await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')]
      .find((el) => /batch management/i.test(el.textContent || ''));
    if (!button) return false;
    button.click();
    return true;
  });
  await page.waitForTimeout(1500);
  check('batch management mode opens', entered, `trigger=${entered}`);

  const bar = await box(page, '[data-batch-toolbar]');
  const barOverflow = await overflowOf(page, '[data-batch-toolbar]');
  const barOverlap = await overlapsIn(page, '[data-batch-toolbar]');
  console.log(`  toolbar: ${JSON.stringify(bar)}`);
  if (bar) {
    check('batch toolbar fits its column', barOverflow.offenders.length === 0,
      barOverflow.offenders.map((o) => `${o.text}@${o.right}`).join(' | ') || 'none past the edge');
    check('batch toolbar rows do not overlap', barOverlap.count === 0,
      barOverlap.count ? barOverlap.hits.map((h) => `"${h.a}" x "${h.b}"`).join(' | ') : '0 overlaps');
  } else {
    console.log('  (no [data-batch-toolbar] hook yet — not instrumented)');
  }
  const pageOverflowBatch = await overflowOf(page, null);
  check('batch mode adds no horizontal page scrollbar', !pageOverflowBatch.horizontalScrollbar,
    `scrollWidth=${pageOverflowBatch.pageScrollWidth}`);

  // Checkboxes must sit fully inside their tile.
  const checkboxes = await page.evaluate(() => {
    const list = document.querySelector('ul.grid');
    if (!list) return { present: false };
    const rows = [...list.children].slice(0, 9).map((tile) => {
      const tileRect = tile.getBoundingClientRect();
      const boxEl = tile.querySelector('[data-batch-checkbox]')
        || tile.querySelector('input[type="checkbox"]')
        || tile.querySelector('[role="checkbox"]');
      if (!boxEl) return { hasBox: false };
      const r = boxEl.getBoundingClientRect();
      return {
        hasBox: true,
        inside: r.left >= tileRect.left - 0.5 && r.right <= tileRect.right + 0.5
          && r.top >= tileRect.top - 0.5 && r.bottom <= tileRect.bottom + 0.5,
        topRight: r.right > tileRect.left + tileRect.width / 2 && r.top < tileRect.top + tileRect.height / 2
      };
    });
    return { present: true, rows };
  });
  if (checkboxes.present && checkboxes.rows.some((r) => r.hasBox)) {
    const withBox = checkboxes.rows.filter((r) => r.hasBox);
    check('every selection checkbox is fully inside its tile',
      withBox.every((r) => r.inside), `${withBox.filter((r) => r.inside).length}/${withBox.length}`);
    check('selection checkboxes sit in the tile top-right',
      withBox.every((r) => r.topRight), `${withBox.filter((r) => r.topRight).length}/${withBox.length}`);
  } else {
    console.log('  (no selection checkbox found in the tiles)');
  }
  report.states.batchManagement = {
    bar, barOverflow, barOverlap, checkboxes, shot: await shot(page, 'D-batch-management')
  };

  // -------------------------------------------------------------------- E
  console.log('\n--- E: alternate tabs ---');
  report.states.tabs = {};
  /* eslint-disable no-await-in-loop */
  for (const label of ['Recommended', 'I like it']) {
    await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const switched = await page.evaluate((name) => {
      const tab = [...document.querySelectorAll('[data-profile-tab], .inline-block')]
        .find((el) => (el.textContent || '').trim().startsWith(name));
      if (!tab) return false;
      tab.click();
      return true;
    }, label);
    await page.waitForTimeout(2000);
    const tabOverflow = await overflowOf(page, null);
    const tabGrid = await gridOf(page);
    const key = label.replace(/\s+/g, '-').toLowerCase();
    check(`${label}: opens`, switched, `clicked=${switched}`);
    check(`${label}: no horizontal page scrollbar`, !tabOverflow.horizontalScrollbar,
      `scrollWidth=${tabOverflow.pageScrollWidth}`);
    if (tabGrid.present) {
      check(`${label}: grid keeps three columns`, tabGrid.columns === 3, `columns=${tabGrid.columns}`);
      check(`${label}: grid stays inside the viewport`, tabGrid.right <= W, `right=${tabGrid.right}`);
    }
    report.states.tabs[key] = {
      grid: tabGrid, overflow: tabOverflow, shot: await shot(page, `E-tab-${key}`)
    };
  }
  /* eslint-enable no-await-in-loop */

  // The tab strip itself must scroll rather than clip or wrap.
  await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  const strip = await page.evaluate(() => {
    const el = document.querySelector('[data-profile-tab-strip]')
      || document.querySelector('[data-profile-tab]')?.closest('.flex');
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrolls: el.scrollWidth > el.clientWidth,
      overflowX: s.overflowX,
      flexWrap: s.flexWrap
    };
  });
  console.log(`  tab strip: ${JSON.stringify(strip)}`);
  if (strip) {
    check('the tab strip scrolls rather than wrapping',
      strip.flexWrap === 'nowrap' && (!strip.scrolls || strip.overflowX !== 'visible'),
      `overflowX=${strip.overflowX} wrap=${strip.flexWrap} scrolls=${strip.scrolls}`);
  }
  report.states.tabStrip = strip;

  // ------------------------------------------------------- breakpoints
  console.log('\n--- breakpoint sweep ---');
  report.breakpoints = {};
  /* eslint-disable no-await-in-loop */
  for (const vp of [
    { w: 390, h: 844 }, { w: 440, h: 956 }, { w: 540, h: 960 },
    { w: 768, h: 1024 }, { w: 1440, h: 900 }
  ]) {
    const name = `${vp.w}x${vp.h}`;
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const vpRail = await railBox(page);
    const vpGrid = await gridOf(page);
    const vpOverflow = await overflowOf(page, null);
    const vpRamp = await rampOf(page, '.bg-profile');
    const floor = vpRamp && vpRamp[0] ? vpRamp[0].px : null;
    const expectedColumns = vp.w >= 1024 ? 6 : 3;
    check(`${name}: no horizontal page scrollbar`, !vpOverflow.horizontalScrollbar,
      `scrollWidth=${vpOverflow.pageScrollWidth} clientWidth=${vpOverflow.pageClientWidth}`);
    check(`${name}: ${expectedColumns} columns`, vpGrid.present && vpGrid.columns === expectedColumns,
      `columns=${vpGrid.columns}`);
    check(`${name}: grid clears the rail and fits the viewport`,
      vpGrid.present && vpRail && vpGrid.left >= vpRail.right && vpGrid.right <= vp.w,
      `left=${vpGrid.left} railRight=${vpRail && vpRail.right} right=${vpGrid.right}`);
    check(`${name}: gaps agree`, vpGrid.present && vpGrid.columnGap === vpGrid.rowGap,
      `${vpGrid.columnGap} / ${vpGrid.rowGap}`);
    check(`${name}: type floor >= 10px`, floor === null || floor >= 10, `smallest=${floor}px`);
    report.breakpoints[name] = {
      rail: vpRail, grid: vpGrid, overflow: vpOverflow, typeFloor: floor
    };
    await page.screenshot({ path: path.join(SHOT_DIR, `39-${PHASE}-F-breakpoint-${name}.png`) });
  }
  /* eslint-enable no-await-in-loop */
  await page.setViewportSize({ width: W, height: H });

  const out = path.join(SHOT_DIR, '..', `profile-states-${PHASE}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);

  await context.close();
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
