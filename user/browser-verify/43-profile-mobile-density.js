/**
 * Phase 1 — the compact Profile's remaining density problems, measured.
 *
 * Four things, each stated as CSS geometry rather than as an impression, and
 * each read at the real CSS viewport (390/440/768/1440) rather than off a
 * screenshot that a DevTools zoom has already scaled:
 *
 *   1.1 the account dropdown is too wide and covers the profile grid
 *   1.2 "Download the PC client" must be gone on mobile
 *   1.3 "Save login" belongs on the right of the profile header
 *   1.4 header and profile type is still larger than the reference
 *
 * Run with `PHASE=before` / `PHASE=after`.
 */
const fs = require('fs');
const path = require('path');

const {
  chromium, USER_APP, signIn, SHOT_DIR, routeMediaOrigin
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const PROFILE = process.env.PROFILE || 'maitran.eats';
const PHASE = process.env.PHASE || 'before';

const VIEWPORTS = [
  { label: '390x844', width: 390, height: 844, compact: true },
  { label: '440x956', width: 440, height: 956, compact: true },
  { label: '768x1024', width: 768, height: 1024, compact: true },
  { label: '1440x900', width: 1440, height: 900, compact: false }
];

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const r1 = (n) => (typeof n === 'number' ? Math.round(n * 10) / 10 : n);

/**
 * The app content column — everything right of the fixed rail. The dropdown is
 * measured against *this*, not against the viewport: "flush to the right of the
 * content" and "not over the rail" are both statements about this box.
 */
const contentBox = (page) => page.evaluate(() => {
  const rail = document.querySelector('[data-app-nav-rail]');
  const railRect = rail ? rail.getBoundingClientRect() : { right: 0, width: 0 };
  const width = document.documentElement.clientWidth;
  return {
    railRight: Math.round(railRect.right),
    railWidth: Math.round(railRect.width),
    left: Math.round(railRect.right),
    right: width,
    width: Math.round(width - railRect.right),
    viewportWidth: width
  };
});

const dropdownBox = (page) => page.evaluate(() => {
  const menu = document.querySelector('[data-account-menu]');
  if (!menu) return null;
  const b = menu.getBoundingClientRect();
  const c = getComputedStyle(menu);
  // The positioned wrapper is what actually carries the width.
  const panel = menu.parentElement;
  const pb = panel ? panel.getBoundingClientRect() : b;
  const rows = [...menu.querySelectorAll('button')].map((el) => {
    const rb = el.getBoundingClientRect();
    const rc = getComputedStyle(el);
    return { height: Math.round(rb.height * 10) / 10, fontSize: rc.fontSize };
  }).filter((row) => row.height > 0);
  const avatar = menu.querySelector('img');
  const icons = [...menu.querySelectorAll('svg')].map((el) => {
    const ib = el.getBoundingClientRect();
    return Math.round(ib.width * 10) / 10;
  }).filter((w) => w > 0);
  const header = menu.firstElementChild;
  return {
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    right: Math.round(b.right * 10) / 10,
    bottom: Math.round(b.bottom * 10) / 10,
    width: Math.round(pb.width * 10) / 10,
    height: Math.round(b.height * 10) / 10,
    padding: c.padding,
    maxHeight: c.maxHeight,
    overflowY: c.overflowY,
    rowHeights: [...new Set(rows.map((x) => x.height))].sort((a, z) => a - z),
    rowFontSizes: [...new Set(rows.map((x) => x.fontSize))],
    avatarWidth: avatar ? Math.round(avatar.getBoundingClientRect().width * 10) / 10 : null,
    headerHeight: header ? Math.round(header.getBoundingClientRect().height * 10) / 10 : null,
    iconWidths: [...new Set(icons)].sort((a, z) => a - z).slice(0, 6)
  };
});

/** Open the account menu by really hovering its trigger (the last header button). */
async function openAccountMenu(page) {
  const target = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('header button')];
    const trigger = buttons[buttons.length - 1];
    if (!trigger) return null;
    const b = trigger.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  if (!target) return false;
  await page.mouse.move(10, 400);
  await page.waitForTimeout(250);
  await page.mouse.move(target.x, target.y);
  await page.waitForTimeout(1400);
  return page.evaluate(() => Boolean(document.querySelector('[data-account-menu]')));
}

async function closeAccountMenu(page) {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await page.mouse.move(10, 500);
  await page.waitForTimeout(400);
}

/** "Download the PC client" / "Download": present, painted, hit-testable, focusable? */
const downloadState = (page) => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('div, a, button')]
    .filter((el) => /^(Download the PC client|Download)$/.test((el.textContent || '').trim()));
  return nodes.map((el) => {
    const b = el.getBoundingClientRect();
    const c = getComputedStyle(el);
    let reachable = null;
    if (b.width > 0 && b.height > 0) {
      const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      reachable = Boolean(hit && (el.contains(hit) || el === hit));
    }
    return {
      text: (el.textContent || '').trim().slice(0, 30),
      width: Math.round(b.width * 10) / 10,
      height: Math.round(b.height * 10) / 10,
      display: c.display,
      rendered: el.getClientRects().length > 0,
      reachable,
      tabIndex: el.tabIndex
    };
  });
});

/** The Save login cluster and where it sits relative to the content's right edge. */
const saveLoginBox = (page) => page.evaluate(() => {
  const toggle = document.querySelector('[aria-label="Save login"]');
  if (!toggle) return null;
  // The cluster is the row holding the label and the switch.
  let cluster = toggle.parentElement;
  for (let i = 0; i < 3 && cluster; i += 1) {
    if (/Save login/.test(cluster.textContent || '')) break;
    cluster = cluster.parentElement;
  }
  const b = (cluster || toggle).getBoundingClientRect();
  const tb = toggle.getBoundingClientRect();
  const label = [...(cluster || toggle).querySelectorAll('div, span')]
    .find((el) => /^Save login$/.test((el.textContent || '').trim()));
  return {
    x: Math.round(b.x * 10) / 10,
    y: Math.round(b.y * 10) / 10,
    right: Math.round(b.right * 10) / 10,
    width: Math.round(b.width * 10) / 10,
    height: Math.round(b.height * 10) / 10,
    toggleRight: Math.round(tb.right * 10) / 10,
    labelFontSize: label ? getComputedStyle(label).fontSize : null,
    toggleAriaLabel: toggle.getAttribute('aria-label'),
    toggleTabIndex: toggle.tabIndex
  };
});

/**
 * Computed font-size for the regions the brief names, read from the element
 * that actually paints the text.
 */
const typeByRegion = (page) => page.evaluate(() => {
  const sizeOf = (el) => (el ? getComputedStyle(el).fontSize : null);
  const text = (sel, match) => {
    const nodes = [...document.querySelectorAll(sel)];
    const hit = match
      ? nodes.find((el) => match.test((el.textContent || '').trim()))
      : nodes[0];
    return hit || null;
  };
  const header = document.querySelector('header');
  const identity = document.querySelector('[data-profile-identity]');
  const counters = document.querySelector('[data-profile-counters]');
  const metadata = document.querySelector('[data-profile-metadata]');
  const strip = document.querySelector('[data-profile-tab-strip]');
  const activeTab = strip && strip.querySelector('[data-profile-tab="active"] span');
  const filterChip = document.querySelector('.bg-\\(--active-bg\\), [class*="active-bg"]');
  const batchBar = document.querySelector('[data-batch-toolbar]');
  // The bio's wrapper inherits the body size; the span that paints the text is
  // what "the bio font" means. Reading the wrapper reported 14px for text that
  // was actually 12px.
  const bioWrap = metadata && metadata.nextElementSibling;
  const bio = (bioWrap && bioWrap.querySelector('span, p')) || bioWrap;
  return {
    headerSearch: sizeOf(header && header.querySelector('input, [placeholder]')),
    headerAction: sizeOf(header && text('header span', /^(More|Notification|Messages|Upload)$/)),
    creatorName: sizeOf(document.querySelector('[data-profile-name] span')),
    counters: sizeOf(counters && counters.querySelector('div')),
    metadata: sizeOf(metadata && metadata.querySelector('span')),
    bio: sizeOf(bio),
    activeTab: sizeOf(activeTab),
    filterChip: sizeOf(filterChip),
    batchToolbar: sizeOf(batchBar),
    tileCaption: sizeOf(document.querySelector('ul.grid p'))
  };
});

const overflowState = (page) => page.evaluate(() => {
  const d = document.documentElement;
  return {
    scrollWidth: d.scrollWidth,
    clientWidth: d.clientWidth,
    overflows: d.scrollWidth > d.clientWidth
  };
});

const tabStripState = (page) => page.evaluate(() => {
  const el = document.querySelector('[data-profile-tab-strip]');
  if (!el) return null;
  return {
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX
  };
});

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

    const content = await contentBox(page);
    const type = await typeByRegion(page);
    const download = await downloadState(page);
    const saveLogin = await saveLoginBox(page);
    const strip = await tabStripState(page);
    const overflow = await overflowState(page);

    console.log(`  content: rail=${content.railWidth} left=${content.left} width=${content.width}`);
    console.log(`  type   : ${JSON.stringify(type)}`);
    console.log(`  saveLogin: ${JSON.stringify(saveLogin)}`);
    console.log(`  download : ${download.length ? JSON.stringify(download) : 'absent'}`);

    // ------------------------------------------------------------- 1.2
    if (vp.compact) {
      const painted = download.filter((d) => d.rendered && d.width > 0);
      check(`${vp.label}: no "Download the PC client" painted`, painted.length === 0,
        download.length ? `${download.length} in DOM, painted=${painted.length}, display=${download[0].display}` : 'absent');
      check(`${vp.label}: Download is not hit-testable`, download.every((d) => d.reachable !== true),
        download.map((d) => `${d.text}:${d.reachable}`).join(', ') || 'absent');
      const focusable = await page.evaluate(() => {
        const el = [...document.querySelectorAll('a, button, [tabindex]')]
          .find((x) => /^(Download the PC client|Download)$/.test((x.textContent || '').trim()));
        if (!el) return { present: false };
        el.focus();
        return { present: true, tookFocus: document.activeElement === el };
      });
      check(`${vp.label}: Download cannot take focus`,
        !focusable.present || focusable.tookFocus === false,
        focusable.present ? `tookFocus=${focusable.tookFocus}` : 'no element');
    } else {
      check(`${vp.label}: desktop keeps the Download control`,
        download.some((d) => d.rendered), `${download.length} node(s)`);
    }

    // ------------------------------------------------------------- 1.3
    if (saveLogin) {
      if (vp.compact) {
        const inset = r1(content.right - saveLogin.right);
        check(`${vp.label}: Save login sits on the right of the content`,
          inset <= 24 && saveLogin.x > content.left + content.width / 2,
          `right=${saveLogin.right} contentRight=${content.right} inset=${inset} left=${saveLogin.x}`);
      }
      check(`${vp.label}: Save login keeps its accessible name`,
        saveLogin.toggleAriaLabel === 'Save login', `aria-label=${saveLogin.toggleAriaLabel}`);
    }

    // ------------------------------------------------------------- 1.1
    const opened = await openAccountMenu(page);
    const menu = opened ? await dropdownBox(page) : null;
    const overflowWithMenu = await overflowState(page);
    if (menu) {
      const ratio = r1((menu.width / content.width) * 100);
      const coverage = r1(((menu.width * menu.height) / (content.width * vp.height)) * 100);
      console.log(`  dropdown: ${JSON.stringify(menu)}`);
      console.log(`  dropdown/content width = ${menu.width}/${content.width} = ${ratio}%`);
      console.log(`  covers ${coverage}% of the profile area`);
      check(`${vp.label}: dropdown does not cover the left rail`, menu.x >= content.railRight,
        `menu.left=${menu.x} rail.right=${content.railRight}`);
      check(`${vp.label}: dropdown is flush to the content's right edge`,
        content.right - menu.right <= 16, `inset=${r1(content.right - menu.right)}`);
      check(`${vp.label}: dropdown fits the viewport height`, menu.height <= vp.height,
        `height=${menu.height} viewport=${vp.height}`);
      check(`${vp.label}: opening the dropdown adds no document overflow`,
        !overflowWithMenu.overflows, `scrollWidth=${overflowWithMenu.scrollWidth}`);
      if (vp.compact) {
        check(`${vp.label}: dropdown takes at most 70% of the content width`, ratio <= 70,
          `${ratio}%`);
        check(`${vp.label}: dropdown covers at most 30% of the profile area`, coverage <= 30,
          `${coverage}%`);
      }
      report.viewports[vp.label] = report.viewports[vp.label] || {};
      report.viewports[vp.label].dropdown = { ...menu, ratio, coverage };
    } else {
      check(`${vp.label}: the account dropdown opens`, false, 'not found');
    }
    await page.screenshot({ path: path.join(SHOT_DIR, `43-${PHASE}-dropdown-${vp.label}.png`) });
    await closeAccountMenu(page);

    // ------------------------------------------------------------- 1.4
    check(`${vp.label}: no horizontal document overflow`, !overflow.overflows,
      `scrollWidth=${overflow.scrollWidth} clientWidth=${overflow.clientWidth}`);
    if (strip && vp.compact) {
      check(`${vp.label}: tab strip still does not scroll`,
        strip.scrollWidth <= strip.clientWidth + 1,
        `${strip.scrollWidth} <= ${strip.clientWidth}`);
    }

    await page.screenshot({ path: path.join(SHOT_DIR, `43-${PHASE}-profile-${vp.label}.png`) });

    // --- the other two states the brief asks to see at every viewport -------
    const openedLiked = await page.evaluate(() => {
      const tab = [...document.querySelectorAll('[data-profile-tab-strip] [aria-label]')]
        .find((el) => (el.getAttribute('aria-label') || '').startsWith('I like it'));
      if (!tab) return false;
      tab.click();
      return true;
    });
    await page.waitForTimeout(2200);
    if (openedLiked) {
      await page.screenshot({ path: path.join(SHOT_DIR, `43-${PHASE}-liked-${vp.label}.png`) });
    }

    await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    const enteredBatch = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')]
        .find((el) => /^Batch management$/.test(el.getAttribute('aria-label') || ''));
      if (!b) return false;
      b.click();
      return true;
    });
    await page.waitForTimeout(1600);
    if (enteredBatch) {
      const batchOverflow = await overflowState(page);
      check(`${vp.label}: batch management adds no horizontal overflow`, !batchOverflow.overflows,
        `scrollWidth=${batchOverflow.scrollWidth}`);
      await page.screenshot({ path: path.join(SHOT_DIR, `43-${PHASE}-batch-${vp.label}.png`) });
    }
    report.viewports[vp.label] = {
      ...(report.viewports[vp.label] || {}), content, type, download, saveLogin, strip, overflow
    };
  }
  /* eslint-enable no-await-in-loop */

  const out = path.join(SHOT_DIR, '..', `profile-mobile-density-${PHASE}.json`);
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
