/**
 * Following — column allocation and expanded creator rail.
 *
 * Measures the four columns the compact Following layout has to fit:
 *
 *   [primary rail] [expanded creator rail] [remaining media strip] [detail panel]
 *
 * and reports them as a table so a change can be compared against the previous
 * run rather than eyeballed.
 *
 *   node browser-verify/24-following-columns.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SHOOT=1,
 * PREFIX (screenshot name prefix, default `following`).
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const path = require('path');
const fs = require('fs');
// Following is an authenticated surface: signed out it renders the login
// dialog, and every column measures as absent.
const { signIn } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const SHOTS = path.resolve(__dirname, '..', '..', 'output', 'screenshots');
const SHOOT = process.env.SHOOT === '1';
const PREFIX = process.env.PREFIX || 'following';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
// A leading slash in an env var is rewritten to a Windows path by Git Bash, so
// the route is named without one and normalised here.
const ROUTE = `/${(process.env.ROUTE || 'following').replace(/^.*[/\\]/, '')}`;
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

/*
 * Targets measured off `douyin-following-comments-reference.png` (516x902).
 *
 * Of that capture's ~467px of app width: primary rail ~37, creator rail ~93,
 * media strip ~111, comments panel ~226 — the panel is 52% of everything after
 * the primary rail. Scaled to our 440px viewport, whose primary rail is pinned
 * at 48px by the accepted shell, that is the table below.
 *
 * The panel target is the important one. Ours was 100.3px, which is what forced
 * the shared five-tab strip down to 6px and still ran the labels together with
 * a 0px gap: the tabs were being crushed to compensate for a panel less than
 * half the width the reference gives it.
 */
const TARGETS = {
  creatorRailExpanded: { target: 88, tol: 3 },
  creatorRailCollapsed: { target: 28, tol: 2 },
  panel: { target: 206, tol: 4 },
  mediaStripWithPanel: { target: 98, tol: 6 }
};

/*
 * The pixel targets above are the reference viewport's, and only the reference
 * viewport's.
 *
 * The creator rail is a fixed width, so at a narrower viewport it is a larger
 * share of the content and every other column shifts. Asserting 440's numbers
 * at 390 would report a correctly-scaling layout as a defect — the same mistake
 * as asserting compact numbers at desktop. Elsewhere this suite asserts the
 * structure and the invariant instead: the panel keeps one width whatever the
 * rail is doing, the tab strip fits, and nothing overflows its column.
 */
const REFERENCE_VIEWPORT = 440;
const COMPACT = W < 1024;
/** The band the Following panel override applies in — see `globals.css`. */
const NARROW = W < 600;
const AT_REFERENCE = W === REFERENCE_VIEWPORT;

let pass = 0;
let fail = 0;
const rows = [];

const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const measure = (label, actual, { target, tol }) => {
  const shown = actual === null ? '—' : Math.round(actual * 10) / 10;
  if (!AT_REFERENCE) {
    rows.push({ label, target: `${target} @440`, actual: shown, tol, pass: 'n/a' });
    console.log(`  \u25cb ${label} — ${shown}px (reference target applies at 440 only)`);
    return;
  }
  const ok = actual !== null && Math.abs(actual - target) <= tol;
  rows.push({ label, target, actual: shown, tol, pass: ok });
  check(label, ok, `${shown}px vs ${target}px ±${tol}`);
};

/** Compact-only structural expectation; at desktop the numbers differ by design. */
const checkCompact = (label, ok, detail) => {
  if (!COMPACT) { console.log(`  \u25cb ${label} (compact-only, skipped at desktop)`); return; }
  check(label, ok, detail);
};

async function shot(page, name) {
  if (!SHOOT) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${PREFIX}-${name}.png`) });
  console.log(`    · ${PREFIX}-${name}.png`);
}

/** Read the four column boxes plus the tab typography, in one pass. */
async function readColumns(page) {
  return page.evaluate(() => {
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left * 10) / 10,
        right: Math.round(rect.right * 10) / 10,
        width: Math.round(rect.width * 10) / 10
      };
    };
    const primaryRail = document.querySelector('nav[aria-label], aside nav')?.closest('aside, nav')
      || document.querySelector('[data-app-nav]');
    const creatorRail = document.querySelector('[data-following-creator-rail]')
      || [...document.querySelectorAll('aside')].find((element) => element.querySelector('img') && element.getBoundingClientRect().height > 300 && element.getBoundingClientRect().left < 300);
    const media = document.querySelector('[data-testid="post-drag-viewport"]');
    const panel = document.querySelector('[data-post-detail-panel]')
      || document.querySelector('[class*="detailpanel"]');

    const tabStrip = panel?.querySelector('button')?.parentElement || null;
    const tabs = tabStrip
      ? [...tabStrip.querySelectorAll('button')].map((button) => ({
        label: button.textContent.trim(),
        fontSize: getComputedStyle(button).fontSize,
        width: Math.round(button.getBoundingClientRect().width * 10) / 10,
        left: Math.round(button.getBoundingClientRect().left * 10) / 10,
        right: Math.round(button.getBoundingClientRect().right * 10) / 10
      }))
      : [];

    // Do the tab labels fit inside the strip, and do any two of them touch?
    const stripBox = box(tabStrip);
    const fits = stripBox && tabs.length
      ? tabs[0].left >= stripBox.left - 0.5 && tabs[tabs.length - 1].right <= stripBox.right + 0.5
      : null;
    let minGap = null;
    for (let i = 1; i < tabs.length; i += 1) {
      const gap = Math.round((tabs[i].left - tabs[i - 1].right) * 10) / 10;
      minGap = minGap === null ? gap : Math.min(minGap, gap);
    }

    return {
      primaryRail: box(primaryRail),
      creatorRail: box(creatorRail),
      media: box(media),
      panel: box(panel),
      tabs,
      tabStrip: stripBox,
      fits,
      minGap,
      viewportWidth: window.innerWidth
    };
  });
}

function table(label, columns) {
  console.log(`\n  ${label}`);
  console.log('  | column | left | right | width |');
  console.log('  |---|---|---|---|');
  [['primary rail', columns.primaryRail], ['creator rail', columns.creatorRail],
    ['media strip', columns.media], ['detail panel', columns.panel]].forEach(([name, boxed]) => {
    console.log(`  | ${name} | ${boxed ? boxed.left : '—'} | ${boxed ? boxed.right : '—'} | ${boxed ? boxed.width : '—'} |`);
  });
  if (columns.tabs.length) {
    console.log(`  tabs: ${columns.tabs.map((tab) => `${tab.label}@${tab.fontSize}/${tab.width}px`).join('  ')}`);
    console.log(`  fits: ${columns.fits}   minGap: ${columns.minGap}px`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  console.log(`\n=== Following columns @ ${W}x${H} (${ROUTE}) ===`);

  await signIn({ page }, ACCOUNT);
  await page.goto(`${USER_APP}${ROUTE}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const collapsed = await readColumns(page);
  table('1. collapsed (no panel)', collapsed);
  await shot(page, '1-collapsed');

  // Expand the creator rail, whatever the affordance is called.
  const expand = page.locator(
    'button[aria-label*="expand" i], button[aria-label*="creators" i], button[title*="expand" i]'
  ).first();
  if (await expand.count()) {
    await expand.click().catch(() => null);
    await page.waitForTimeout(800);
  }
  const expanded = await readColumns(page);
  table('2. expanded creator rail', expanded);
  await shot(page, '2-expanded');

  // Open the reading panel on top of the expanded rail — the four-column case.
  const comments = page.locator('button[aria-label*="comment" i], button:has-text("Comments")').first();
  if (await comments.count()) {
    await comments.click().catch(() => null);
    await page.waitForTimeout(1000);
  }
  const withPanel = await readColumns(page);
  table('3. expanded rail + detail panel', withPanel);
  await shot(page, '3-expanded-comments');

  // Collapsing the rail with the panel open: the panel must NOT change width.
  // It is the column with a floor (a five-tab strip and a comment thread); the
  // media strip is the one that should absorb the 60px the rail gave back.
  const collapse = page.locator('button[aria-label*="collapse" i]').first();
  if (await collapse.count()) {
    await collapse.click().catch(() => null);
    await page.waitForTimeout(800);
  }
  const collapsedWithPanel = await readColumns(page);
  table('4. collapsed rail + detail panel', collapsedWithPanel);
  await shot(page, '4-collapsed-comments');

  console.log('\n  --- assertions against the Douyin reference ---\n');
  measure('expanded creator rail width', expanded.creatorRail?.width ?? null, TARGETS.creatorRailExpanded);
  measure('collapsed creator rail width', collapsed.creatorRail?.width ?? null, TARGETS.creatorRailCollapsed);
  measure('detail panel width (rail expanded)', withPanel.panel?.width ?? null, TARGETS.panel);
  measure(
    'media strip width (rail expanded)',
    withPanel.panel && withPanel.creatorRail ? withPanel.panel.left - withPanel.creatorRail.right : null,
    TARGETS.mediaStripWithPanel
  );
  measure('detail panel holds its width when the rail collapses', collapsedWithPanel.panel?.width ?? null, TARGETS.panel);

  /*
   * The design goal, independent of viewport: collapsing the rail gives its
   * width to the media strip, never to the panel. The panel is the column with
   * a floor — a five-tab strip and a comment thread — and it was letting the
   * rail decide how much room the tabs got.
   */
  const panelDrift = withPanel.panel && collapsedWithPanel.panel
    ? Math.abs(withPanel.panel.width - collapsedWithPanel.panel.width)
    : null;
  /*
   * Exact at the reference viewport, which the two ratios are solved for; a few
   * pixels of drift elsewhere, because the rail is a fixed width and so is a
   * different share of every viewport. Outside the narrow band the override
   * does not apply at all and the panel is simply the accepted share.
   */
  const driftTolerance = AT_REFERENCE ? 1 : 8;
  if (NARROW) {
    check('the panel keeps one width whatever the rail does',
      panelDrift !== null && panelDrift <= driftTolerance,
      `${withPanel.panel?.width} -> ${collapsedWithPanel.panel?.width} (drift ${Math.round((panelDrift ?? 0) * 10) / 10}px, tol ${driftTolerance})`);
  } else {
    console.log(`  \u25cb the panel keeps one width whatever the rail does (narrow-band only; drift ${Math.round((panelDrift ?? 0) * 10) / 10}px)`);
  }

  const mediaExpanded = withPanel.panel && withPanel.creatorRail
    ? withPanel.panel.left - withPanel.creatorRail.right : null;
  const mediaCollapsed = collapsedWithPanel.panel && collapsedWithPanel.creatorRail
    ? collapsedWithPanel.panel.left - collapsedWithPanel.creatorRail.right : null;
  check('the media strip is what absorbs the rail collapsing',
    mediaExpanded !== null && mediaCollapsed !== null && mediaCollapsed > mediaExpanded,
    `${Math.round(mediaExpanded)} -> ${Math.round(mediaCollapsed)}`);

  // Compact only: desktop reserves `--feed-nav-gutter` (68px) to the right of
  // the panel for the up/down capsule, so the panel deliberately stops short of
  // the viewport edge there.
  checkCompact('the four columns tile the viewport with no overlap',
    Boolean(withPanel.creatorRail && withPanel.panel)
    && withPanel.creatorRail.left === 48
    && withPanel.creatorRail.right <= withPanel.panel.left
    && withPanel.panel.right === withPanel.viewportWidth,
    withPanel.creatorRail && withPanel.panel
      ? `48 | ${withPanel.creatorRail.right} | ${withPanel.panel.left} | ${withPanel.panel.right}`
      : 'missing');

  // Both are compact expectations. At desktop the tab row is a different,
  // already-accepted design (16px labels, padding rather than gaps), and its
  // own overflow at the widest rail state predates this pass -- filed as
  // `.agents/bug-tracker/bug-following-desktop-tab-overflow.md`.
  checkCompact('the shared tab strip fits without being crushed', withPanel.fits === true, `fits=${withPanel.fits}`);
  checkCompact('no two tabs touch', (withPanel.minGap ?? -1) > 0, `minGap=${withPanel.minGap}px`);
  checkCompact('tab type is no longer the 6px emergency size',
    withPanel.tabs.every((tab) => parseFloat(tab.fontSize) >= 8),
    withPanel.tabs.map((tab) => tab.fontSize).join(' '));

  const railFits = await page.evaluate(() => {
    const rail = document.querySelector('aside');
    if (!rail) return null;
    const railRight = rail.getBoundingClientRect().right;
    const overflowing = [...rail.querySelectorAll('*')]
      .filter((element) => element.getBoundingClientRect().width > 0)
      .filter((element) => element.getBoundingClientRect().right > railRight + 0.5)
      .map((element) => `${element.tagName.toLowerCase()}:${Math.round(element.getBoundingClientRect().right)}`);
    return { railRight, overflowing: overflowing.slice(0, 4) };
  });
  check('nothing in the creator rail overflows its column',
    railFits && railFits.overflowing.length === 0,
    railFits ? railFits.overflowing.join(', ') || 'clean' : 'no rail');

  console.log('\n  | measurement | reference target | after | tol | pass |');
  console.log('  |---|---|---|---|---|');
  rows.forEach((row) => {
    const verdict = row.pass === 'n/a' ? 'n/a' : (row.pass ? 'PASS' : 'FAIL');
    console.log(`  | ${row.label} | ${row.target} | ${row.actual} | ±${row.tol} | ${verdict} |`);
  });

  console.log(`\n  ${pass} passed, ${fail} failed`);
  console.log(`  console errors: ${consoleErrors.length}`);
  consoleErrors.slice(0, 5).forEach((error) => console.log(`    ! ${error}`));

  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
