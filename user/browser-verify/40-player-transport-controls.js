/**
 * Phase 1 — the compact player's transport row.
 *
 * Two claims, both measured rather than eyeballed:
 *
 *   1. Picture-in-Picture is *gone* at the compact breakpoint — not merely
 *      invisible. Not painted, not hit-testable, not focusable, not in the tab
 *      order, and not present as an active hidden control. Desktop keeps it.
 *   2. The mute glyph occupies the same visual box as the transport glyphs
 *      beside it, in both its muted and unmuted states, without shrinking the
 *      button's touch target.
 *
 * The size of a glyph is not its font-size and not its element box — every icon
 * here is `1em` on a 32x32 viewBox, so those agree while the artwork inside
 * does not. `getBBox()` is the ink, which is what a person actually sees, and
 * it is the only measurement that catches this.
 */
const fs = require('fs');
const path = require('path');

const {
  chromium, USER_APP, signIn, SHOT_DIR, routeMediaOrigin
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const PHASE = process.env.PHASE || 'after';

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

const POPUP = '[data-post-detail-popup]';

/**
 * Every transport control in the open player, with its button box, its icon
 * element box, and the icon's *ink* box.
 */
const transportRow = (page, root) => page.evaluate((sel) => {
  const scope = sel ? document.querySelector(sel) : document;
  if (!scope) return { present: false };
  const buttons = [...scope.querySelectorAll('button[aria-label]')].filter((b) => /^(Play|Pause|Mute|Unmute|Toggle fullscreen|Picture in picture|Add to watch later)$/
    .test(b.getAttribute('aria-label') || ''));
  if (!buttons.length) return { present: false };

  const read = (button) => {
    const br = button.getBoundingClientRect();
    const svg = button.querySelector('svg');
    let iconBox = null;
    let ink = null;
    if (svg) {
      const sr = svg.getBoundingClientRect();
      iconBox = { width: sr.width, height: sr.height };
      try {
        // Ink bounds in user units, scaled to CSS pixels by the viewBox ratio.
        const bb = svg.getBBox();
        const vb = (svg.getAttribute('viewBox') || '0 0 32 32').split(/\s+/).map(Number);
        const scale = sr.width / (vb[2] || 32);
        ink = { width: bb.width * scale, height: bb.height * scale };
      } catch { ink = null; }
    }
    const style = getComputedStyle(button);
    return {
      label: button.getAttribute('aria-label'),
      x: br.x,
      y: br.y,
      right: br.right,
      hitBox: { width: br.width, height: br.height },
      fontSize: style.fontSize,
      iconBox,
      ink,
      // Everything that decides whether a control is really gone.
      painted: br.width > 0 && br.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0',
      tabIndex: button.tabIndex,
      disabled: button.disabled,
      ariaHidden: button.closest('[aria-hidden="true"]') !== null,
      inert: button.closest('[inert]') !== null
    };
  };

  const rows = buttons.map(read).sort((a, b) => a.x - b.x);
  // Gaps between adjacent controls in the right-hand cluster.
  const gaps = [];
  for (let i = 1; i < rows.length; i += 1) gaps.push(rows[i].x - rows[i - 1].right);
  return { present: true, rows, gaps };
}, root);

/** Is anything anywhere on the page a PiP control? */
const pipAnywhere = (page) => page.evaluate(() => {
  const nodes = [...document.querySelectorAll('[aria-label="Picture in picture"]')];
  return nodes.map((el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      width: r.width,
      height: r.height,
      display: s.display,
      visibility: s.visibility,
      opacity: s.opacity,
      tabIndex: el.tabIndex
    };
  });
});

/** Can the pointer reach a PiP control at its own coordinates? */
const pipHitTest = (page, root) => page.evaluate((sel) => {
  const scope = (sel && document.querySelector(sel)) || document;
  const el = scope.querySelector('[aria-label="Picture in picture"]');
  if (!el) return { present: false };
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return { present: true, zeroBox: true };
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { present: true, zeroBox: false, reachable: el.contains(hit) || el === hit };
}, root);

/** Walk the real tab order and report whether PiP is in it. */
const tabOrderHasPip = async (page, limit = 40) => {
  await page.evaluate(() => {
    const first = document.querySelector('body');
    if (first) first.focus?.();
    document.activeElement?.blur?.();
  });
  const seen = [];
  for (let i = 0; i < limit; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Tab');
    // eslint-disable-next-line no-await-in-loop
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return el.getAttribute('aria-label') || el.tagName.toLowerCase();
    });
    if (label) seen.push(label);
  }
  return { seen, hasPip: seen.includes('Picture in picture') };
};

/** Open the popup detail on a video post from Home. */
async function openVideoPopup(page) {
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await page.waitForSelector(POPUP, { timeout: 20000 });
  await page.waitForTimeout(2200);
  for (let i = 0; i < 20; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const layout = await page.evaluate((sel) => document.querySelector(sel)?.getAttribute('data-post-detail-popup'), POPUP);
    if (layout === 'video') return true;
    // eslint-disable-next-line no-await-in-loop
    const moved = await page.evaluate((sel) => {
      const b = document.querySelector(`${sel} button[aria-label="Next post"]`);
      if (!b || b.disabled) return false;
      b.click();
      return true;
    }, POPUP);
    if (!moved) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1400);
  }
  return false;
}

const report = { phase: PHASE, surfaces: {} };

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

    // ---------------------------------------------------- Popup Detail
    const opened = await openVideoPopup(page);
    check(`${vp.label}: popup opens on a video post`, opened);
    if (!opened) continue;

    const row = await transportRow(page, POPUP);
    const pip = await pipAnywhere(page);
    const hit = await pipHitTest(page, POPUP);

    if (row.present) {
      row.rows.forEach((c) => console.log(
        `    ${c.label.padEnd(22)} hit=${r1(c.hitBox.width)}x${r1(c.hitBox.height)} `
        + `icon=${c.iconBox ? `${r1(c.iconBox.width)}x${r1(c.iconBox.height)}` : 'n/a'} `
        + `ink=${c.ink ? `${r1(c.ink.width)}x${r1(c.ink.height)}` : 'n/a'} font=${c.fontSize}`
      ));
      console.log(`    gaps: [${row.gaps.map(r1).join(', ')}]`);
    }

    if (vp.compact) {
      /*
        The control is hidden with `display: none`, not unmounted, so the bar
        is every route a person could reach it by — paint, pointer, focus,
        keyboard and the accessibility tree — rather than "absent from the DOM".
        Each is measured; none is assumed from the fact that CSS was used.
      */
      const painted = pip.filter((c) => c.display !== 'none' && c.visibility !== 'hidden'
        && c.opacity !== '0' && c.width > 0 && c.height > 0);
      check(`${vp.label}: PiP is not displayed`, painted.length === 0,
        pip.length ? `display=${pip[0].display} box=${pip[0].width}x${pip[0].height}` : 'no element');
      check(`${vp.label}: PiP occupies no box`, pip.every((c) => c.width === 0 && c.height === 0),
        pip.length ? `${pip[0].width}x${pip[0].height}` : 'no element');
      check(`${vp.label}: PiP is not hit-testable`, hit.present === false || hit.zeroBox === true,
        hit.present ? `reachable=${hit.reachable} zeroBox=${hit.zeroBox}` : 'no element');

      // `.focus()` is the strongest test: a display:none element refuses it.
      const focusable = await page.evaluate(() => {
        const el = document.querySelector('[aria-label="Picture in picture"]');
        if (!el) return { present: false };
        el.focus();
        return { present: true, tookFocus: document.activeElement === el };
      });
      check(`${vp.label}: PiP cannot take focus`, !focusable.present || focusable.tookFocus === false,
        focusable.present ? `tookFocus=${focusable.tookFocus}` : 'no element');

      const tab = await tabOrderHasPip(page);
      check(`${vp.label}: PiP is not in the tab order`, !tab.hasPip,
        `${tab.seen.length} stops walked, pip=${tab.hasPip}`);

      // Not exposed as a hidden-but-active control either.
      const exposed = await page.evaluate(() => {
        const el = document.querySelector('[aria-label="Picture in picture"]');
        if (!el) return { present: false };
        return {
          present: true,
          // `display: none` takes an element out of the a11y tree entirely.
          rendered: el.getClientRects().length > 0,
          ariaHidden: el.getAttribute('aria-hidden')
        };
      });
      check(`${vp.label}: PiP is not exposed as an active hidden control`,
        !exposed.present || exposed.rendered === false,
        exposed.present ? `rendered=${exposed.rendered}` : 'no element');
    } else {
      check(`${vp.label}: PiP control is present on desktop`, pip.length > 0,
        pip.length ? `${pip.length} control(s)` : 'MISSING');
      check(`${vp.label}: desktop PiP is reachable`, hit.present && hit.reachable === true,
        `reachable=${hit.reachable}`);
    }

    // --- the mute glyph agrees with its neighbours ------------------------
    if (row.present) {
      const byLabel = (re) => row.rows.find((c) => re.test(c.label));
      const mute = byLabel(/^(Mute|Unmute)$/);
      const others = row.rows.filter((c) => !/^(Mute|Unmute)$/.test(c.label)
        && c.ink && c.painted && c.ink.width > 0);
      if (mute && mute.ink && others.length) {
        const widths = others.map((c) => c.ink.width);
        const heights = others.map((c) => c.ink.height);
        const avgW = widths.reduce((a, b) => a + b, 0) / widths.length;
        const avgH = heights.reduce((a, b) => a + b, 0) / heights.length;
        const maxW = Math.max(...widths);
        const maxH = Math.max(...heights);
        check(`${vp.label}: mute ink width matches its neighbours (<=2px)`,
          Math.abs(mute.ink.width - avgW) <= 2,
          `mute=${r1(mute.ink.width)} avg=${r1(avgW)} max=${r1(maxW)} delta=${r1(mute.ink.width - avgW)}`);
        check(`${vp.label}: mute ink height matches its neighbours (<=2px)`,
          Math.abs(mute.ink.height - avgH) <= 2,
          `mute=${r1(mute.ink.height)} avg=${r1(avgH)} max=${r1(maxH)} delta=${r1(mute.ink.height - avgH)}`);
        check(`${vp.label}: mute keeps a full-size hit target`,
          mute.hitBox.width >= Math.min(...others.map((c) => c.hitBox.width)) - 0.5,
          `mute=${r1(mute.hitBox.width)}x${r1(mute.hitBox.height)}`);
      }

      // --- toggling must not move anything --------------------------------
      const before = row.rows.map((c) => ({ label: c.label, x: r1(c.x), w: r1(c.hitBox.width) }));
      await page.evaluate((sel) => {
        document.querySelector(`${sel} button[aria-label="Mute"], ${sel} button[aria-label="Unmute"]`)?.click();
      }, POPUP);
      await page.waitForTimeout(700);
      const afterRow = await transportRow(page, POPUP);
      const after = afterRow.present
        ? afterRow.rows.map((c) => ({ label: c.label, x: r1(c.x), w: r1(c.hitBox.width) }))
        : [];
      const positionsHeld = before.length === after.length
        && before.every((b, i) => Math.abs(b.x - after[i].x) < 0.6 && Math.abs(b.w - after[i].w) < 0.6);
      check(`${vp.label}: toggling mute shifts no control`, positionsHeld,
        positionsHeld ? 'every x and width held' : `${JSON.stringify(before)} -> ${JSON.stringify(after)}`);

      const toggled = afterRow.present && afterRow.rows.find((c) => /^(Mute|Unmute)$/.test(c.label));
      const muteBefore = row.rows.find((c) => /^(Mute|Unmute)$/.test(c.label));
      if (toggled && muteBefore) {
        check(`${vp.label}: both mute states occupy the same box`,
          Math.abs(toggled.ink.width - muteBefore.ink.width) <= 2
          && Math.abs(toggled.ink.height - muteBefore.ink.height) <= 2,
          `${muteBefore.label} ink=${r1(muteBefore.ink.width)}x${r1(muteBefore.ink.height)} -> `
          + `${toggled.label} ink=${r1(toggled.ink.width)}x${r1(toggled.ink.height)}`);
        check(`${vp.label}: the accessible name still says what it does`,
          /^(Mute|Unmute)$/.test(toggled.label) && toggled.label !== muteBefore.label,
          `${muteBefore.label} -> ${toggled.label}`);
      }
      // Put it back.
      await page.evaluate((sel) => {
        document.querySelector(`${sel} button[aria-label="Mute"], ${sel} button[aria-label="Unmute"]`)?.click();
      }, POPUP);
      await page.waitForTimeout(400);
    }

    await page.screenshot({ path: path.join(SHOT_DIR, `40-${PHASE}-popup-${vp.label}.png`) });
    report.surfaces[`popup@${vp.label}`] = { row, pip, hit };
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
  }

  // ------------------------------------------ the other shared surfaces
  console.log('\n=== other player surfaces @ 440x956 ===');
  await page.setViewportSize({ width: 440, height: 956 });
  for (const route of ['/for-you', '/following', '/friend']) {
    await page.goto(`${USER_APP}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    const pip = await pipAnywhere(page);
    const hit = await pipHitTest(page, null);
    const row = await transportRow(page, null);
    // Absent from the DOM *or* hidden with `display: none` — both are "gone".
    const painted = pip.filter((c) => c.display !== 'none' && c.width > 0 && c.height > 0);
    check(`${route}: no PiP control is displayed at 440x956`, painted.length === 0,
      pip.length ? `${pip.length} in DOM, display=${pip[0].display} box=${pip[0].width}x${pip[0].height}` : 'absent');
    check(`${route}: PiP is not hit-testable`, hit.present === false || hit.zeroBox === true,
      `present=${hit.present} zeroBox=${hit.zeroBox}`);
    const routeFocus = await page.evaluate(() => {
      const el = document.querySelector('[aria-label="Picture in picture"]');
      if (!el) return { present: false };
      el.focus();
      return { present: true, tookFocus: document.activeElement === el };
    });
    check(`${route}: PiP cannot take focus`, !routeFocus.present || routeFocus.tookFocus === false,
      routeFocus.present ? `tookFocus=${routeFocus.tookFocus}` : 'no element');
    if (row.present) {
      const mute = row.rows.find((c) => /^(Mute|Unmute)$/.test(c.label));
      const others = row.rows.filter((c) => !/^(Mute|Unmute)$/.test(c.label)
        && c.ink && c.painted && c.ink.width > 0);
      if (mute && mute.ink && others.length) {
        const avgW = others.reduce((a, c) => a + c.ink.width, 0) / others.length;
        check(`${route}: mute ink matches its neighbours`, Math.abs(mute.ink.width - avgW) <= 2,
          `mute=${r1(mute.ink.width)} avg=${r1(avgW)}`);
      }
    }
    report.surfaces[`${route}@440x956`] = { row, pip };
    await page.screenshot({ path: path.join(SHOT_DIR, `40-${PHASE}-${route.slice(1)}-440x956.png`) });
  }
  /* eslint-enable no-await-in-loop */

  const out = path.join(SHOT_DIR, '..', `player-transport-${PHASE}.json`);
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
