/**
 * Control bar — measured against the real visible intersection, at rest.
 *
 * "bottom === innerHeight" is not evidence on its own: a clipping ancestor, a
 * header overlay or a safe-area inset can put the true visible bottom higher.
 * So the assertion is the intersection of the browser viewport with every
 * clipping ancestor of the bar:
 *
 *   visibleTop    = max(viewportTop,    clippingAncestor.tops)
 *   visibleBottom = min(viewportBottom, clippingAncestor.bottoms)
 *
 * Captures at T+0 / T+1 / T+3 and after `canplay`, and never scrolls, focuses,
 * drags or mutates scrollTop before capturing.
 *
 *   node browser-verify/33-control-bar-visible-intersection.js 440 956
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

/** Everything the height equation needs, plus the clipping chain. */
const measure = () => {
  const popup = document.querySelector('[data-post-detail-popup]');
  const scope = popup || document.querySelector('[data-testid="post-drag-viewport"]') || document;
  const seek = scope.querySelector('input[aria-label="Seek video"]');
  const bar = seek ? seek.closest('div[class*="absolute"][class*="bottom-0"]') : null;

  const box = (el) => (el ? {
    top: Math.round(el.getBoundingClientRect().top),
    bottom: Math.round(el.getBoundingClientRect().bottom),
    height: Math.round(el.getBoundingClientRect().height)
  } : null);

  const header = document.querySelector('header') || document.querySelector('[class*="app-header"]');
  const shell = document.querySelector('#main-content') || document.body.firstElementChild;
  const routeContent = document.querySelector('[class*="w-[calc(100%-var(--app-shell-nav-width)"]');
  const surface = document.querySelector('[data-feed-surface]')
    || document.querySelector('[data-testid="post-drag-viewport"]')?.parentElement;
  const dragViewport = document.querySelector('[data-testid="post-drag-viewport"]');
  const stage = document.querySelector('[data-testid="post-drag-current"]');
  const media = scope.querySelector('video, img');
  const caption = scope.querySelector('[class*="bottom-20"], [class*="bottom-[76px]"]');

  // The visible intersection: viewport ∩ every clipping ancestor of the bar.
  let visibleTop = 0;
  let visibleBottom = window.innerHeight;
  const clippers = [];
  if (bar) {
    let node = bar.parentElement;
    while (node && node !== document.documentElement.parentElement) {
      const style = getComputedStyle(node);
      const clips = ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY);
      if (clips) {
        const rect = node.getBoundingClientRect();
        visibleTop = Math.max(visibleTop, Math.round(rect.top));
        visibleBottom = Math.min(visibleBottom, Math.round(rect.bottom));
        clippers.push({
          tag: node.tagName.toLowerCase(),
          cls: (node.className || '').toString().slice(0, 40),
          overflowY: style.overflowY,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom)
        });
      }
      node = node.parentElement;
    }
  }

  const safeBottom = (() => {
    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;bottom:0;height:env(safe-area-inset-bottom);width:0;';
    document.body.appendChild(probe);
    const value = probe.getBoundingClientRect().height;
    probe.remove();
    return Math.round(value);
  })();

  return {
    hasVideo: Boolean(scope.querySelector('video')),
    readyState: scope.querySelector('video')?.readyState ?? null,
    innerHeight: window.innerHeight,
    docClientHeight: document.documentElement.clientHeight,
    visualHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    visualOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : null,
    scrollHeight: document.scrollingElement ? document.scrollingElement.scrollHeight : null,
    safeBottom,
    header: box(header),
    shell: box(shell),
    routeContent: box(routeContent),
    surface: box(surface),
    dragViewport: box(dragViewport),
    stage: box(stage),
    media: box(media),
    caption: box(caption),
    bar: box(bar),
    visibleTop,
    visibleBottom,
    clippers
  };
};

async function captureSurface(page, label) {
  const shots = [];
  const at = async (name, waitMs) => {
    if (waitMs) await page.waitForTimeout(waitMs);
    const data = await page.evaluate(measure);
    shots.push({ name, ...data });
    return data;
  };

  await at('T+0', 400);
  await at('T+1', 700);
  const final = await at('T+3', 2000);

  console.log(`\n  --- ${label} ---`);
  console.log(`  video: ${final.hasVideo} (readyState ${final.readyState}) · scrollTop ${final.scrollTop} · safeBottom ${final.safeBottom}`);
  console.log('  | t | bar.top | bar.bottom | visibleTop | visibleBottom | inside? |');
  console.log('  |---|---|---|---|---|---|');
  shots.forEach((shot) => {
    const inside = shot.bar ? (shot.bar.top >= shot.visibleTop - 0.5 && shot.bar.bottom <= shot.visibleBottom + 0.5) : null;
    console.log(`  | ${shot.name} | ${shot.bar ? shot.bar.top : '—'} | ${shot.bar ? shot.bar.bottom : '—'} | ${shot.visibleTop} | ${shot.visibleBottom} | ${inside === null ? 'no bar' : inside} |`);
  });

  if (final.bar) {
    console.log('\n  height equation:');
    console.log(`    viewport            ${final.innerHeight}`);
    console.log(`    header              ${final.header ? final.header.height : 0}`);
    console.log(`    route content       ${final.routeContent ? `${final.routeContent.top}..${final.routeContent.bottom} (${final.routeContent.height})` : '—'}`);
    console.log(`    drag viewport       ${final.dragViewport ? `${final.dragViewport.top}..${final.dragViewport.bottom} (${final.dragViewport.height})` : '—'}`);
    console.log(`    stage               ${final.stage ? `${final.stage.top}..${final.stage.bottom} (${final.stage.height})` : '—'}`);
    console.log(`    caption             ${final.caption ? `${final.caption.top}..${final.caption.bottom}` : '—'}`);
    console.log(`    control bar         ${final.bar.top}..${final.bar.bottom} (${final.bar.height})`);
    console.log(`    safe-area bottom    ${final.safeBottom}`);
    console.log(`    visible band        ${final.visibleTop}..${final.visibleBottom}`);
    console.log(`  clipping ancestors: ${final.clippers.map((c) => `${c.tag}[${c.overflowY}] ${c.top}..${c.bottom}`).join(' | ') || 'none'}`);
  }

  rows.push({ surface: label, ...final });

  if (final.bar) {
    check(`${label}: controlBar.bottom <= visibleBottom - safeArea`,
      final.bar.bottom <= final.visibleBottom - final.safeBottom + 0.5,
      `${final.bar.bottom} <= ${final.visibleBottom - final.safeBottom}`);
    check(`${label}: controlBar.top >= visibleTop`,
      final.bar.top >= final.visibleTop - 0.5,
      `${final.bar.top} >= ${final.visibleTop}`);
    check(`${label}: nothing was scrolled to achieve it`, final.scrollTop === 0, `scrollTop ${final.scrollTop}`);
    if (final.caption) {
      check(`${label}: caption clears the bar`,
        final.caption.bottom <= final.bar.top + 0.5,
        `caption ${final.caption.bottom} vs bar ${final.bar.top}`);
    }
  } else {
    console.log(`  ○ ${label}: active post is a photo — no transport bar to place`);
  }

  if (SHOOT) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `rest-${W}-${label}.png`) });
    console.log(`    · rest-${W}-${label}.png (captured before any scroll)`);
  }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  console.log(`\n=== Control bar vs the real visible band @ ${W}x${H} — ${USER_APP} ===`);
  await signIn({ page }, ACCOUNT);

  for (const surface of ['for-you', 'following', 'friend']) {
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`${USER_APP}/${surface}`, { waitUntil: 'networkidle' });
    // eslint-disable-next-line no-await-in-loop
    await captureSurface(page, surface);
  }

  // Popup: open a post that certainly has a video.
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('article[data-post-id]')]
      .find((element) => /\d\d:\d\d/.test(element.textContent || ''));
    (card || document.querySelector('article[data-post-id]'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 }).catch(() => null);
  await captureSurface(page, 'popup');

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
