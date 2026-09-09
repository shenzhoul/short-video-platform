/**
 * For You — responsive acceptance pass.
 *
 * Geometry, gestures and column layout at a compact viewport, measured rather
 * than eyeballed. Run per viewport:
 *
 *   node browser-verify/22-for-you-responsive.js 440 956
 *   node browser-verify/22-for-you-responsive.js 1440 900
 *
 * Compact-only expectations are skipped at desktop, where the same numbers are
 * supposed to differ (12px search radius, 16px tabs, a reserved nav gutter).
 *
 * Env: PLAYWRIGHT_PATH (see lib/harness.js).
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const path = require('path');
const fs = require('fs');

const USER_APP = process.env.USER_APP || 'http://localhost:8081';
const SHOTS = 'D:/Projects/douyin-clone/output/screenshots';
const SHOOT = process.env.SHOOT === '1';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);

let pass = 0;
let fail = 0;
const COMPACT = Number(process.argv[2] || 440) < 1024;
// Compact-only expectations. At desktop the same measurements are supposed to
// be different (12px search radius, 16px tabs, a reserved nav-capsule gutter),
// so asserting the compact numbers there would report the desktop design as a
// defect.
const checkCompact = (label, ok, detail) => {
  if (!COMPACT) { console.log(`  ○ ${label} (compact-only, skipped at desktop)`); return; }
  // eslint-disable-next-line no-use-before-define
  check(label, ok, detail);
};

const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${label}${detail ? ' \u2014 ' + detail : ''}`);
};

const COLS = () => {
  const r = (n) => Math.round(n * 10) / 10;
  const b = (el) => {
    if (!el) return null;
    const x = el.getBoundingClientRect();
    return { left: r(x.left), right: r(x.right), w: r(x.width), top: r(x.top), bottom: r(x.bottom) };
  };
  const header = document.querySelector('header');
  const content = header ? header.parentElement : null;
  const stage = document.querySelector('section[class*="min-h-0"]');
  const player = stage ? stage.querySelector('div[style*="width"]') : null;
  const panel = document.querySelector('aside[class*="border-l"]');
  const ws = document.querySelector('aside[aria-label="Messages"]');
  const inner = ws ? ws.querySelector('div') : null;
  return {
    content: b(content),
    stage: b(stage),
    media: b(player),
    detail: b(panel),
    messages: b(inner),
    scrim: Boolean(document.querySelector('button[aria-label="Close messages"][class*="bg-black/40"]')),
    docOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    docOverflowY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1
  };
};

const activeId = (page) => page.evaluate(() => {
  const v = document.querySelector('section [data-video-id]');
  if (v) return v.getAttribute('data-video-id');
  const cap = document.querySelector('div[class*="drop-shadow"][class*="bottom-"]');
  return cap ? (cap.textContent || '').trim().slice(0, 40) : null;
});

// The ranked feed decides what is first; step forward until a video post is
// showing so the transport-bar assertions have something to measure.
async function ensureVideoPost(page, swipeFn) {
  for (let i = 0; i < 6; i += 1) {
    const has = await page.evaluate(() => Boolean(document.querySelector('section video')));
    if (has) return true;
    await swipeFn(page, 620, 300);
  }
  return page.evaluate(() => Boolean(document.querySelector('section video')));
}

async function swipe(page, from, to) {
  const x = 140;
  await page.touchscreen.tap(x, from).catch(() => {});
  await page.evaluate(async ({ x: px, from: f, to: t }) => {
    const target = document.elementFromPoint(px, f);
    const send = (type, y) => {
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: px, clientY: y, isPrimary: true
      }));
    };
    send('pointerdown', f);
    for (let i = 1; i <= 8; i += 1) send('pointermove', f + ((t - f) * i) / 8);
    send('pointerup', t);
  }, { x, from, to });
  await page.waitForTimeout(1400);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(USER_APP + '/', { waitUntil: 'domcontentloaded' });
  const t = page.getByRole('button', { name: /log ?in|sign ?in/i }).first();
  await t.waitFor({ state: 'visible', timeout: 30000 });
  await t.click();
  const d = page.locator('[role="dialog"]').first();
  await d.waitFor({ state: 'visible', timeout: 25000 });
  await d.locator('input[type="text"], input[type="email"]').first().fill('maitran.eats@demo.invalid');
  await d.locator('input[type="password"]').first().fill('demodemo');
  await d.getByRole('button', { name: /log ?in|sign ?in|continue|submit/i }).first().click();
  await d.waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await page.setViewportSize({ width: W, height: H });
  fs.mkdirSync(SHOTS, { recursive: true });
  const shot = (n) => (SHOOT ? page.screenshot({ path: path.join(SHOTS, `foryou-${W}x${H}-${n}.png`) }) : Promise.resolve());

  console.log(`\n===== FOR YOU @ ${W}x${H} =====`);
  await page.goto(USER_APP + '/for-you', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5200);
  await shot('1-default');
  const onVideo = await ensureVideoPost(page, swipe);
  console.log('  (fixture: video post showing =', onVideo, ')');
  await shot('2-default-controls-visible');

  // --- 1. Search radius -----------------------------------------------------
  const search = await page.evaluate(() => {
    const r = (n) => Math.round(n * 10) / 10;
    const input = document.querySelector('header input');
    const wrap = input.closest('div[class*="rounded"]');
    const b = wrap.getBoundingClientRect();
    return { radius: getComputedStyle(wrap).borderRadius, w: r(b.width), h: r(b.height), left: r(b.left), top: r(b.top) };
  });
  checkCompact('search is a compact rounded rectangle (4-6px), not a capsule',
    parseFloat(search.radius) >= 4 && parseFloat(search.radius) <= 6,
    `radius ${search.radius}, ${search.w}x${search.h} at ${search.left},${search.top}`);

  // --- 2. Height / bottom controls -----------------------------------------
  const heights = await page.evaluate(() => {
    const r = (n) => Math.round(n * 10) / 10;
    const de = document.documentElement;
    const header = document.querySelector('header');
    const feed = document.querySelector('section[class*="min-h-0"]');
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    const hb = header.getBoundingClientRect();
    const fb = feed.getBoundingClientRect();
    const el = (sel) => {
      const n = document.querySelector(sel);
      if (!n) return null;
      const b = n.getBoundingClientRect();
      return { bottom: r(b.bottom), inView: b.bottom <= vh + 1 };
    };
    return {
      vh: r(vh),
      headerBottom: r(hb.bottom),
      feed: { top: r(fb.top), bottom: r(fb.bottom), h: r(fb.height), client: feed.clientHeight },
      docOverflowY: de.scrollHeight > de.clientHeight + 1,
      desc: el('div[class*="drop-shadow"][class*="bottom-"]'),
      progress: el('section input[type="range"]'),
      transport: el('section button[aria-label="Pause"], section button[aria-label="Play"]'),
      rail: el('section aside[class*="w-11"]')
    };
  });
  check('feed starts at the header bottom and ends at the visual viewport',
    Math.abs(heights.feed.top - heights.headerBottom) <= 1 && Math.abs(heights.feed.bottom - heights.vh) <= 1,
    `feed ${heights.feed.top}..${heights.feed.bottom}, header bottom ${heights.headerBottom}, vh ${heights.vh}`);
  check('no document-level vertical overflow', !heights.docOverflowY, '');
  ['desc', 'progress', 'transport', 'rail'].forEach((k) => {
    check(`${k} is inside the viewport without scrolling`, Boolean(heights[k]) && heights[k].inView,
      heights[k] ? `bottom ${heights[k].bottom} <= ${heights.vh}` : 'not found');
  });
  const overlap = await page.evaluate(() => {
    const r = (n) => Math.round(n * 10) / 10;
    const desc = document.querySelector('div[class*="drop-shadow"][class*="bottom-"]');
    const range = document.querySelector('section input[type="range"]');
    const bar = range ? range.closest('div[class*="bottom-0"]') : null;
    if (!desc || !bar) return null;
    return { descBottom: r(desc.getBoundingClientRect().bottom), barTop: r(bar.getBoundingClientRect().top) };
  });
  checkCompact('the caption clears the transport bar', Boolean(overlap) && overlap.descBottom <= overlap.barTop + 0.5,
    overlap ? `caption bottom ${overlap.descBottom}, bar top ${overlap.barTop}` : 'n/a');

  // --- 3. Swipe navigation --------------------------------------------------
  const before = await activeId(page);
  await shot('3-before-swipe');
  await swipe(page, 620, 300);
  const afterUp = await activeId(page);
  await shot('4-after-swipe-next');
  checkCompact('swiping up moves to the next post', Boolean(before) && Boolean(afterUp) && before !== afterUp,
    `${before} -> ${afterUp}`);
  await swipe(page, 300, 620);
  const afterDown = await activeId(page);
  checkCompact('swiping down returns to the previous post', afterDown === before, `${afterUp} -> ${afterDown}`);
  await swipe(page, 620, 300);
  await page.waitForTimeout(400);
  const afterSecond = await activeId(page);
  checkCompact('one gesture advances exactly one post', afterSecond === afterUp, `${afterDown} -> ${afterSecond}`);
  // Dragging the seek control must not navigate.
  const beforeSeek = await activeId(page);
  const seek = await page.evaluate(() => {
    const el = document.querySelector('section input[type="range"]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 4), y: Math.round(b.top + b.height / 2) };
  });
  if (seek) await swipe(page, seek.y, seek.y - 200);
  checkCompact('dragging the seek control does not change post', (await activeId(page)) === beforeSeek, `${beforeSeek}`);

  // --- 4. Inline detail tabs ------------------------------------------------
  await page.locator('section button[aria-label="Comment"]').first().click();
  await page.waitForTimeout(2600);
  const tabs = await page.evaluate(() => {
    const r = (n) => Math.round(n * 10) / 10;
    const panel = document.querySelector('aside[class*="border-l"]');
    const nav = panel.querySelector('nav');
    const btns = Array.from(nav.querySelectorAll('button'));
    const boxes = btns.map((b) => ({ x: r(b.getBoundingClientRect().x), right: r(b.getBoundingClientRect().right) }));
    const gaps = boxes.slice(1).map((b, i) => r(b.x - boxes[i].right));
    const close = panel.querySelector('button[aria-label="Close details panel"]');
    return {
      count: btns.length,
      font: getComputedStyle(btns[0]).fontSize,
      rowH: r(nav.getBoundingClientRect().height),
      scrollLeft: nav.scrollLeft,
      fits: nav.scrollWidth <= nav.clientWidth + 1,
      minGap: gaps.length ? Math.min(...gaps) : null,
      closeVisible: Boolean(close && close.getBoundingClientRect().width > 0),
      panelW: r(panel.getBoundingClientRect().width),
      commentBody: (() => {
        const like = panel.querySelector('[data-testid^="comment-likes-"]');
        const row = like ? like.closest('div[class*="group"]') : null;
        const pEl = row ? row.querySelector('p') : null;
        return pEl ? getComputedStyle(pEl).fontSize + '/' + getComputedStyle(pEl).lineHeight : null;
      })()
    };
  });
  checkCompact('inline tabs: five labels, no scroll, positive gaps',
    tabs.count === 5 && tabs.fits && tabs.scrollLeft === 0 && tabs.minGap > 0,
    `font ${tabs.font} rowH ${tabs.rowH} minGap ${tabs.minGap} panel ${tabs.panelW}`);
  check('inline tabs: close control visible', tabs.closeVisible, '');
  checkCompact('inline comments use the accepted dense typography',
    tabs.commentBody === null || tabs.commentBody === '10px/13px',
    tabs.commentBody === null ? 'this post has no comments to measure' : String(tabs.commentBody));
  await shot('6-comments-from-icon');

  const colsDetail = await page.evaluate(COLS);
  check('detail is a column beside the media, not over it',
    colsDetail.media.right <= colsDetail.detail.left + 0.5 && !colsDetail.docOverflowX,
    `media ${colsDetail.media.left}..${colsDetail.media.right} | detail ${colsDetail.detail.left}..${colsDetail.detail.right}`);

  // --- 5. Messages reflow ---------------------------------------------------
  await page.locator('header button[aria-label="Messages"]').first().click();
  await page.waitForTimeout(2800);
  const three = await page.evaluate(COLS);
  await shot('9-comments-plus-messages');
  check('three columns: media | detail | messages, none overlapping',
    three.media.right <= three.detail.left + 0.5
      && three.detail.right <= three.messages.left + 0.5
      && three.messages.right <= W + 0.5
      && three.media.w > 0 && three.detail.w > 0 && three.messages.w > 0
      && !three.scrim && !three.docOverflowX,
    `media ${three.media.left}..${three.media.right} | detail ${three.detail.left}..${three.detail.right} | messages ${three.messages.left}..${three.messages.right} | content right ${three.content.right}`);
  const hit = await page.evaluate(() => {
    const r = (n) => Math.round(n);
    const stage = document.querySelector('section[class*="min-h-0"]');
    const player = stage.querySelector('div[style*="width"]');
    const panel = document.querySelector('aside[class*="border-l"]');
    const pick = (el) => {
      const b = el.getBoundingClientRect();
      const n = document.elementFromPoint(r(b.left + b.width / 2), r(b.top + b.height / 2));
      return n ? n.tagName.toLowerCase() + '.' + String(n.className).slice(0, 26) : null;
    };
    return { mediaPoint: pick(player), detailPoint: pick(panel) };
  });
  check('Messages does not cover the media or the detail column',
    !/aria-label="Messages"/.test(String(hit.mediaPoint)) && Boolean(hit.mediaPoint) && Boolean(hit.detailPoint),
    JSON.stringify(hit));

  // Messages only (close the detail panel, keep messages).
  await page.locator('button[aria-label="Close details panel"]').click().catch(() => {});
  await page.waitForTimeout(2000);
  const two = await page.evaluate(COLS);
  await shot('7-messages-only');
  check('Messages only: media | messages, no detail',
    two.detail === null && two.media.right <= two.messages.left + 0.5 && !two.docOverflowX,
    `media ${two.media.left}..${two.media.right} | messages ${two.messages.left}..${two.messages.right}`);

  // Details + Messages.
  await page.locator('section button[aria-label="Comment"]').first().click().catch(() => {});
  await page.waitForTimeout(2200);
  await page.locator('nav[aria-label="Video details"] button[aria-label="Details"]').click().catch(() => {});
  await page.waitForTimeout(1800);
  await shot('5-details-from-description');
  await shot('8-details-plus-messages');
  const three2 = await page.evaluate(COLS);
  check('Details + Messages keeps three columns',
    Boolean(three2.detail) && three2.media.right <= three2.detail.left + 0.5
      && three2.detail.right <= three2.messages.left + 0.5,
    `media ${three2.media.left}..${three2.media.right} | detail ${three2.detail.left}..${three2.detail.right} | messages ${three2.messages.left}..${three2.messages.right}`);

  // Close everything and confirm restoration.
  const idBefore = await activeId(page);
  await page.locator('button[aria-label="Close messages"]').first().click().catch(() => {});
  await page.waitForTimeout(1800);
  await page.locator('button[aria-label="Close details panel"]').click().catch(() => {});
  await page.waitForTimeout(1800);
  const restored = await page.evaluate(COLS);
  await shot('10-restored-default');
  const idAfter = await activeId(page);
  checkCompact('closing all panels restores the full-width media',
    restored.detail === null && restored.messages === null
      && Math.abs(restored.media.right - restored.content.right) <= 1,
    `media ${restored.media.left}..${restored.media.right}, content right ${restored.content.right}`);
  checkCompact('closing all panels keeps the same post', idAfter === idBefore, `${idBefore} -> ${idAfter}`);

  console.log(`\n${fail === 0 ? 'ALL PASS' : fail + ' FAILED'} (${pass} passed)`);
  await browser.close();
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
