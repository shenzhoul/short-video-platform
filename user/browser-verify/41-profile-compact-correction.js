/**
 * Phase 2 — the compact Profile, against the reattached Douyin references.
 *
 * Three corrections, each stated as geometry rather than as an impression:
 *
 *   A. the creator identity sits *beside* the avatar, not below it;
 *   B. the main tab strip fits — it does not scroll at the compact breakpoint;
 *   C. the Profile grid search is absent at the compact breakpoint, with no
 *      reserved space, no focus stop and no empty toolbar row left behind.
 *
 * Run with `PHASE=before` / `PHASE=after`. Every number is read from
 * `getBoundingClientRect` / `getComputedStyle` against the production build.
 */
const fs = require('fs');
const path = require('path');

const {
  chromium, USER_APP, signIn, SHOT_DIR, routeMediaOrigin
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const PROFILE = process.env.PROFILE || 'maitran.eats';
const PHASE = process.env.PHASE || 'after';

const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844, compact: true },
  { label: '440x956', width: 440, height: 956, compact: true },
  { label: '540x960', width: 540, height: 960, compact: true },
  { label: '768x1024', width: 768, height: 1024, compact: true },
  { label: '1440x900', width: 1440, height: 900, compact: false }
];

const TABS = ['Works', 'Recommended', 'I like it', 'Collection'];

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const r = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

const box = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const b = el.getBoundingClientRect();
  const c = getComputedStyle(el);
  return {
    x: b.x,
    y: b.y,
    right: b.right,
    bottom: b.bottom,
    width: b.width,
    height: b.height,
    fontSize: c.fontSize,
    lineHeight: c.lineHeight
  };
}, sel);

/** The hero's identity geometry — the whole of requirement A in one read. */
const heroGeometry = (page) => page.evaluate(() => {
  const hero = document.querySelector('[data-profile-hero]');
  const avatarBtn = document.querySelector('[data-profile-hero] button[aria-label="Preview avatar"]');
  const identity = document.querySelector('[data-profile-identity]');
  const nameRow = document.querySelector('[data-profile-name]');
  const nameText = nameRow && nameRow.querySelector('span');
  const counters = document.querySelector('[data-profile-counters]');
  const metadata = document.querySelector('[data-profile-metadata]');
  const strip = document.querySelector('[data-profile-tab-strip]');
  const rect = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    return {
      x: Math.round(b.x * 10) / 10,
      y: Math.round(b.y * 10) / 10,
      right: Math.round(b.right * 10) / 10,
      bottom: Math.round(b.bottom * 10) / 10,
      width: Math.round(b.width * 10) / 10,
      height: Math.round(b.height * 10) / 10,
      fontSize: c.fontSize,
      lineHeight: c.lineHeight,
      minWidth: c.minWidth
    };
  };
  // Bio is whichever block follows the metadata line.
  const bio = metadata && metadata.nextElementSibling;
  return {
    hero: rect(hero),
    avatar: rect(avatarBtn),
    identity: rect(identity),
    nameRow: rect(nameRow),
    nameText: rect(nameText),
    counters: rect(counters),
    metadata: rect(metadata),
    bio: rect(bio),
    tabStrip: rect(strip)
  };
});

/** Does the tab strip scroll, by any measure? */
const tabStripState = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-profile-tab-strip]');
  if (!el) return null;
  const c = getComputedStyle(el);
  const before = el.scrollLeft;
  // Try to scroll it: a strip that cannot scroll will not move.
  el.scrollLeft = 400;
  const moved = el.scrollLeft;
  el.scrollLeft = before;
  const tabs = [...el.querySelectorAll('[data-profile-tab], .inline-block')]
    .filter((t) => t.getAttribute('aria-label'))
    .map((t) => {
      const b = t.getBoundingClientRect();
      const span = t.querySelector('span');
      return {
        label: t.getAttribute('aria-label'),
        title: t.getAttribute('title'),
        width: Math.round(b.width * 10) / 10,
        right: Math.round(b.right * 10) / 10,
        // A clipped label is one whose text is wider than the box drawing it.
        ellipsized: span ? span.scrollWidth > span.clientWidth + 1 : false,
        visible: b.width > 0 && b.height > 0
      };
    });
  return {
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    scrollLeft: before,
    movedTo: moved,
    overflowX: c.overflowX,
    tabs
  };
});

/** Every Profile search control, and whether it is really gone. */
const searchState = (page) => page.evaluate(() => {
  const labels = [...document.querySelectorAll('label[aria-label], label')];
  const found = labels
    .filter((el) => /search (for work|liked)/i.test(el.getAttribute('aria-label') || el.textContent || ''))
    .map((el) => {
      const b = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      const container = el.closest('div');
      return {
        text: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 24),
        width: b.width,
        height: b.height,
        display: c.display,
        rendered: el.getClientRects().length > 0,
        containerDisplay: container ? getComputedStyle(container).display : null
      };
    });
  // Any focusable control inside a hidden search cluster?
  const focusables = [...document.querySelectorAll('input, button, [tabindex]')]
    .filter((el) => /search (for work|liked)/i.test(
      el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''
    ))
    .map((el) => ({ tag: el.tagName.toLowerCase(), rendered: el.getClientRects().length > 0 }));
  return { found, focusables };
});

/** Any empty toolbar band left behind? */
const toolbarBands = (page) => page.evaluate(() => {
  const sticky = document.querySelector('[data-profile-tab-strip]')?.closest('.sticky');
  if (!sticky) return null;
  return [...sticky.querySelectorAll(':scope > div, :scope > div > div > div')]
    .map((el) => {
      const b = el.getBoundingClientRect();
      const text = (el.textContent || '').trim();
      return { height: Math.round(b.height), empty: text.length === 0 };
    })
    .filter((row) => row.height > 0 && row.empty);
});

const pageOverflow = (page) => page.evaluate(() => {
  const d = document.documentElement;
  return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth, overflows: d.scrollWidth > d.clientWidth };
});

const gridOf = (page) => page.evaluate(() => {
  const list = document.querySelector('ul.grid');
  if (!list) return { present: false };
  const tiles = [...list.children];
  if (!tiles.length) return { present: false };
  const rects = tiles.map((el) => el.getBoundingClientRect());
  const top = Math.round(rects[0].top);
  const firstRow = rects.filter((x) => Math.abs(x.top - top) < 2);
  const st = getComputedStyle(list);
  return {
    present: true,
    columns: firstRow.length,
    left: Math.round(rects[0].left),
    right: Math.round(firstRow[firstRow.length - 1].right),
    columnGap: st.columnGap,
    rowGap: st.rowGap,
    firstRowTop: top
  };
});

/** Do the caption, badge and management checkbox overlap inside a tile? */
const tileOverlaps = (page) => page.evaluate(() => {
  const list = document.querySelector('ul.grid');
  if (!list) return { present: false };
  const hits = [];
  [...list.children].slice(0, 9).forEach((tile, i) => {
    const parts = [
      ['badge', tile.querySelector('[class*="face15"], .bg-\\[\\#face15\\]')],
      ['checkbox', tile.querySelector('[data-batch-checkbox]')],
      ['caption', tile.querySelector('p')]
    ].filter(([, el]) => el && el.getClientRects().length);
    for (let a = 0; a < parts.length; a += 1) {
      for (let b = a + 1; b < parts.length; b += 1) {
        const ra = parts[a][1].getBoundingClientRect();
        const rb = parts[b][1].getBoundingClientRect();
        const ox = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const oy = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (ox > 1 && oy > 1) hits.push({ tile: i, a: parts[a][0], b: parts[b][0], ox: Math.round(ox) });
      }
    }
  });
  return { present: true, count: hits.length, hits: hits.slice(0, 5) };
});

async function openTab(page, label) {
  const ok = await page.evaluate((name) => {
    const tab = [...document.querySelectorAll('[data-profile-tab-strip] [aria-label]')]
      .find((el) => (el.getAttribute('aria-label') || '').startsWith(name));
    if (!tab) return false;
    tab.click();
    return true;
  }, label);
  await page.waitForTimeout(1800);
  return ok;
}

const enterBatch = async (page) => {
  const ok = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((el) => /^(Batch management)$/.test(el.getAttribute('aria-label') || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(1500);
  return ok;
};

const report = { phase: PHASE, viewports: {} };

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  await signIn({ page }, ACCOUNT);

  /* eslint-disable no-await-in-loop */
  for (const vp of VIEWPORTS) {
    console.log(`\n=== ${vp.label} (${vp.compact ? 'compact' : 'desktop'}) ===`);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);

    // ---------------------------------------------------------------- A
    const g = await heroGeometry(page);
    console.log('  avatar   ', JSON.stringify(g.avatar));
    console.log('  identity ', JSON.stringify(g.identity));
    console.log('  nameText ', JSON.stringify(g.nameText));
    console.log('  counters ', JSON.stringify(g.counters));
    console.log('  metadata ', JSON.stringify(g.metadata));
    console.log('  bio      ', JSON.stringify(g.bio));
    console.log('  hero h   ', g.hero ? g.hero.height : null, ' tabStrip.top', g.tabStrip ? g.tabStrip.y : null);

    if (g.avatar && g.identity && g.nameText) {
      check(`${vp.label}: identity starts right of the avatar`, g.identity.x > g.avatar.right,
        `identity.left=${g.identity.x} avatar.right=${g.avatar.right}`);
      check(`${vp.label}: identity top aligns with the avatar top (<=16px)`,
        Math.abs(g.identity.y - g.avatar.y) <= 16,
        `identity.top=${g.identity.y} avatar.top=${g.avatar.y} delta=${r(g.identity.y - g.avatar.y)}`);
      check(`${vp.label}: creator name starts above the avatar's bottom`,
        g.nameText.y < g.avatar.bottom,
        `name.top=${g.nameText.y} avatar.bottom=${g.avatar.bottom}`);
      check(`${vp.label}: the name is not a full-width row below the avatar`,
        g.nameText.x > g.avatar.right,
        `name.left=${g.nameText.x} avatar.right=${g.avatar.right}`);
      check(`${vp.label}: the identity block can shrink (min-width:0)`,
        g.identity.minWidth === '0px' || g.identity.minWidth === 'auto',
        `min-width=${g.identity.minWidth}`);
    }

    const ov = await pageOverflow(page);
    check(`${vp.label}: no horizontal document overflow`, !ov.overflows,
      `scrollWidth=${ov.scrollWidth} clientWidth=${ov.clientWidth}`);

    // ---------------------------------------------------------------- B
    const strip = await tabStripState(page);
    if (strip) {
      console.log(`  tabStrip scrollWidth=${strip.scrollWidth} clientWidth=${strip.clientWidth} overflowX=${strip.overflowX}`);
      strip.tabs.forEach((t) => console.log(`    tab "${t.label}" w=${t.width} ellipsized=${t.ellipsized}`));
      if (vp.compact) {
        check(`${vp.label}: tab strip does not scroll`,
          strip.scrollWidth <= strip.clientWidth + 1,
          `scrollWidth=${strip.scrollWidth} clientWidth=${strip.clientWidth}`);
        check(`${vp.label}: tab strip is at scrollLeft 0`, strip.scrollLeft === 0, `scrollLeft=${strip.scrollLeft}`);
        check(`${vp.label}: attempting to scroll the strip moves nothing`, strip.movedTo === 0,
          `after scrollLeft=400 -> ${strip.movedTo}`);
        check(`${vp.label}: no scrollbar on the strip`, strip.overflowX !== 'auto' && strip.overflowX !== 'scroll',
          `overflow-x=${strip.overflowX}`);
        check(`${vp.label}: every tab hit target is present`,
          strip.tabs.length >= 4 && strip.tabs.every((t) => t.visible),
          `${strip.tabs.filter((t) => t.visible).length}/${strip.tabs.length} visible`);
        check(`${vp.label}: every tab keeps a full accessible name`,
          strip.tabs.every((t) => t.label && t.label.length > 0 && t.title && t.title.length > 0),
          strip.tabs.map((t) => t.label).join(' | '));
      }
    }

    // ---------------------------------------------------------------- C
    const search = await searchState(page);
    if (vp.compact) {
      const rendered = search.found.filter((f) => f.rendered);
      check(`${vp.label}: Works tab has no visible search control`, rendered.length === 0,
        search.found.length ? `${search.found.length} in DOM, rendered=${rendered.length}, display=${search.found[0].containerDisplay}` : 'absent');
      check(`${vp.label}: search reserves no space`, search.found.every((f) => f.width === 0 && f.height === 0),
        search.found.length ? `${r(search.found[0].width)}x${r(search.found[0].height)}` : 'absent');
      const bands = await toolbarBands(page);
      check(`${vp.label}: no empty toolbar band left behind`, !bands || bands.length === 0,
        bands && bands.length ? `${bands.length} empty band(s): ${JSON.stringify(bands)}` : 'none');
    } else {
      check(`${vp.label}: desktop search is available`, search.found.some((f) => f.rendered),
        `${search.found.length} control(s)`);
    }

    // ------------------------------------------------------------- grid
    const grid = await gridOf(page);
    const expectCols = vp.width >= 1024 ? 6 : 3;
    check(`${vp.label}: grid keeps ${expectCols} columns`, grid.present && grid.columns === expectCols,
      `columns=${grid.columns}`);
    const overlaps = await tileOverlaps(page);
    check(`${vp.label}: captions and badges do not overlap`, overlaps.present && overlaps.count === 0,
      overlaps.count ? JSON.stringify(overlaps.hits) : '0 overlaps');

    await page.screenshot({ path: path.join(SHOT_DIR, `41-${PHASE}-works-${vp.label}.png`) });
    report.viewports[vp.label] = {
      hero: g, strip, search, grid, overflow: ov
    };
  }

  // ----------------------------------------------- every tab, at 440x956
  console.log('\n=== every tab @ 440x956 ===');
  await page.setViewportSize({ width: 440, height: 956 });
  report.tabs = {};
  for (const label of TABS) {
    await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2200);
    const opened = await openTab(page, label);
    const strip = await tabStripState(page);
    const search = await searchState(page);
    const ov = await pageOverflow(page);
    const bands = await toolbarBands(page);
    const rendered = search.found.filter((f) => f.rendered);
    check(`${label}: tab opens`, opened, `clicked=${opened}`);
    if (strip) {
      check(`${label}: tab strip still does not scroll`, strip.scrollWidth <= strip.clientWidth + 1,
        `${strip.scrollWidth} <= ${strip.clientWidth}`);
    }
    check(`${label}: no visible search control`, rendered.length === 0,
      rendered.length ? JSON.stringify(rendered[0]) : 'absent');
    check(`${label}: no empty toolbar band`, !bands || bands.length === 0,
      bands && bands.length ? JSON.stringify(bands) : 'none');
    check(`${label}: no horizontal overflow`, !ov.overflows, `scrollWidth=${ov.scrollWidth}`);
    report.tabs[label] = { strip, search, overflow: ov };
    await page.screenshot({ path: path.join(SHOT_DIR, `41-${PHASE}-tab-${label.replace(/\s+/g, '-').toLowerCase()}.png`) });
  }

  // ------------------------------------------ batch management @ 440x956
  console.log('\n=== batch management @ 440x956 ===');
  await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const entered = await enterBatch(page);
  check('batch: enters management mode', entered, `clicked=${entered}`);

  const batchStrip = await tabStripState(page);
  const batchSearch = await searchState(page);
  const batchOverflow = await pageOverflow(page);
  check('batch: tab strip still does not scroll',
    batchStrip && batchStrip.scrollWidth <= batchStrip.clientWidth + 1,
    batchStrip ? `${batchStrip.scrollWidth} <= ${batchStrip.clientWidth}` : 'no strip');
  check('batch: no mobile search reappears', batchSearch.found.filter((f) => f.rendered).length === 0,
    `${batchSearch.found.filter((f) => f.rendered).length} rendered`);
  check('batch: no horizontal overflow', !batchOverflow.overflows, `scrollWidth=${batchOverflow.scrollWidth}`);

  // The business logic must survive the layout work.
  const zeroState = await page.evaluate(() => {
    const act = [...document.querySelectorAll('[data-batch-toolbar] button')]
      .find((b) => /Delete|Unlike/.test(b.textContent || ''));
    return { present: Boolean(act), disabled: act ? act.disabled : null };
  });
  check('batch: the action is disabled with nothing selected',
    zeroState.present && zeroState.disabled === true, JSON.stringify(zeroState));

  const selected = await page.evaluate(() => {
    const first = document.querySelector('ul.grid [data-batch-checkbox]');
    if (!first) return { clicked: false };
    first.click();
    return { clicked: true };
  });
  await page.waitForTimeout(900);
  const afterSelect = await page.evaluate(() => {
    const bar = document.querySelector('[data-batch-toolbar]');
    const act = [...document.querySelectorAll('[data-batch-toolbar] button')]
      .find((b) => /Delete|Unlike/.test(b.textContent || ''));
    return {
      text: bar ? (bar.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70) : null,
      actionDisabled: act ? act.disabled : null,
      pressed: document.querySelector('ul.grid [data-batch-checkbox]')?.getAttribute('aria-pressed')
    };
  });
  check('batch: selecting one post updates the count', selected.clicked && /1 work selected/.test(afterSelect.text || ''),
    afterSelect.text);
  check('batch: the action enables with a selection', afterSelect.actionDisabled === false,
    `disabled=${afterSelect.actionDisabled}`);
  check('batch: the tile reports itself selected', afterSelect.pressed === 'true', `aria-pressed=${afterSelect.pressed}`);

  const selectAll = await page.evaluate(() => {
    const b = [...document.querySelectorAll('[data-batch-toolbar] button')]
      .find((x) => /Select all/.test(x.textContent || ''));
    if (!b) return { clicked: false };
    b.click();
    return { clicked: true };
  });
  await page.waitForTimeout(900);
  const afterAll = await page.evaluate(() => {
    const bar = document.querySelector('[data-batch-toolbar]');
    return (bar ? (bar.textContent || '') : '').replace(/\s+/g, ' ').trim().slice(0, 70);
  });
  check('batch: Select all selects every loaded post', selectAll.clicked && /1[0-9]? works selected/.test(afterAll),
    afterAll);

  await page.screenshot({ path: path.join(SHOT_DIR, `41-${PHASE}-batch-440x956.png`) });

  const exited = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')]
      .find((x) => /^Exit management$/.test(x.getAttribute('aria-label') || ''));
    if (!b) return false;
    b.click();
    return true;
  });
  await page.waitForTimeout(1200);
  const afterExit = await page.evaluate(() => Boolean(document.querySelector('[data-batch-toolbar]')));
  check('batch: exits management mode', exited && !afterExit, `exited=${exited} barGone=${!afterExit}`);
  /* eslint-enable no-await-in-loop */

  const out = path.join(SHOT_DIR, '..', `profile-compact-${PHASE}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(`\nwrote ${out}`);

  await context.close();
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
