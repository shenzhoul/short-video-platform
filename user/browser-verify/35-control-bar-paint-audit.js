/**
 * Why is the transport row not painted, when its rectangle is inside the
 * viewport?
 *
 * Geometry was never the question. This enumerates EVERY seek input under the
 * popup, resolves which one belongs to the active post, walks its ancestor
 * chain multiplying opacity, and hit-tests the bar with `elementsFromPoint`.
 * It then captures State A (at rest, bar missing) and State B (after the
 * smallest interaction that reveals it) and diffs them.
 *
 *   node browser-verify/35-control-bar-paint-audit.js 440 956 <modal_id>
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SHOOT=1.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium, devices } = require(PW);
const path = require('path');
const fs = require('fs');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const SHOTS = path.resolve(__dirname, '..', '..', 'output', 'screenshots');
const SHOOT = process.env.SHOOT === '1';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const MODAL_ID = process.argv[4] || null;

/** Runs in the page: everything about every candidate transport row. */
const audit = () => {
  const describe = (el) => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName,
      cls: (typeof el.className === 'string' ? el.className : String(el.className)).slice(0, 70),
      rect: {
        top: Math.round(r.top), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height)
      },
      display: cs.display,
      visibility: cs.visibility,
      opacity: cs.opacity,
      pointerEvents: cs.pointerEvents,
      position: cs.position,
      zIndex: cs.zIndex,
      transform: cs.transform === 'none' ? 'none' : 'set',
      contentVisibility: cs.contentVisibility,
      ariaHidden: el.getAttribute('aria-hidden'),
      inert: el.inert === true,
      hidden: el.hidden === true
    };
  };

  const popup = document.querySelector('[data-post-detail-popup]');
  const modalId = new URL(location.href).searchParams.get('modal_id');
  const seeks = [...document.querySelectorAll('input[aria-label="Seek video"]')];

  const results = seeks.map((seek, index) => {
    const bar = seek.closest('div[class*="absolute"][class*="bottom-0"]') || seek.parentElement;
    let node = seek;
    let effectiveOpacity = 1;
    const chain = [];
    let inActivePopup = false;
    let slidePosition = null;
    while (node) {
      const item = describe(node);
      effectiveOpacity *= Number(item.opacity || 1);
      chain.push(item);
      if (node === popup) inActivePopup = true;
      const tid = node.getAttribute && node.getAttribute('data-testid');
      if (tid === 'post-drag-current') slidePosition = 'current';
      if (tid === 'post-drag-preview-next') slidePosition = 'next-preview';
      if (tid === 'post-drag-preview-previous') slidePosition = 'previous-preview';
      node = node.parentElement;
    }

    // What is actually painted on top of the bar?
    const r = bar.getBoundingClientRect();
    const points = [
      [Math.round(r.left + 20), Math.round(r.top + r.height / 2)],
      [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)],
      [Math.round(r.right - 20), Math.round(r.top + r.height / 2)]
    ].filter(([x, y]) => x >= 0 && x < innerWidth && y >= 0 && y < innerHeight);

    const video = bar.closest('.group')?.querySelector('video')
      || bar.parentElement?.querySelector('video');

    return {
      index,
      inActivePopup,
      slidePosition,
      videoSrc: video ? (video.getAttribute('src') || '').slice(-26) : null,
      videoPaused: video ? video.paused : null,
      videoReadyState: video ? video.readyState : null,
      effectiveOpacity: Number(effectiveOpacity.toFixed(3)),
      seek: describe(seek),
      bar: describe(bar),
      offsetParentExists: Boolean(seek.offsetParent),
      // Which ancestor introduced the transparency, if any.
      transparentAncestor: chain.find((item) => Number(item.opacity) < 1) || null,
      hitStack: points.map(([x, y]) => ({
        point: `${x},${y}`,
        top3: document.elementsFromPoint(x, y).slice(0, 3).map((el) => {
          const d = describe(el);
          return `${d.tag}.${d.cls.slice(0, 30)}`;
        })
      }))
    };
  });

  return {
    modalId,
    popupPresent: Boolean(popup),
    seekCount: seeks.length,
    // Does the browser report a hover-capable pointer? `group-hover` needs one.
    hoverCapable: window.matchMedia('(hover: hover)').matches,
    pointerCoarse: window.matchMedia('(pointer: coarse)').matches,
    centrePlayVisible: Boolean(document.querySelector('button[aria-label="Play video"], button[aria-label="Pause video"]')),
    results
  };
};

function summarise(label, snap) {
  console.log(`\n  ===== ${label} =====`);
  console.log(`  modal_id ${snap.modalId} · seek inputs found: ${snap.seekCount} · hover:hover=${snap.hoverCapable} pointer:coarse=${snap.pointerCoarse}`);
  snap.results.forEach((r) => {
    console.log(`\n   [${r.index}] inActivePopup=${r.inActivePopup} slide=${r.slidePosition} video=${r.videoSrc} paused=${r.videoPaused}`);
    console.log(`        bar rect ${r.bar.rect.top}..${r.bar.rect.bottom}  display=${r.bar.display} visibility=${r.bar.visibility} opacity=${r.bar.opacity}`);
    console.log(`        EFFECTIVE OPACITY through ancestors: ${r.effectiveOpacity}`);
    if (r.transparentAncestor) {
      console.log(`        transparency introduced by: ${r.transparentAncestor.tag}.${r.transparentAncestor.cls.slice(0, 46)} opacity=${r.transparentAncestor.opacity}`);
    }
    console.log(`        pointerEvents=${r.bar.pointerEvents} z=${r.bar.zIndex} ariaHidden=${r.bar.ariaHidden} inert=${r.bar.inert}`);
    r.hitStack.forEach((h) => console.log(`        hit ${h.point}: ${h.top3.join('  <  ')}`));
  });
}

(async () => {
  const browser = await chromium.launch();
  // Emulate the user's device: touch, coarse pointer, no hover.
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 3,
    userAgent: devices['iPhone 13 Pro Max'] ? devices['iPhone 13 Pro Max'].userAgent : undefined
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  const url = MODAL_ID ? `${USER_APP}/?modal_id=${MODAL_ID}` : `${USER_APP}/`;
  await page.goto(url, { waitUntil: 'networkidle' });
  if (!MODAL_ID) {
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('article[data-post-id]')]
        .find((el) => /\d\d:\d\d/.test(el.textContent || ''));
      (card || document.querySelector('article[data-post-id]'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  }
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });

  console.log(`\n=== Control-bar paint audit @ ${W}x${H} (touch emulation) — ${USER_APP} ===`);

  // ------------------------------------------------------------- STATE A
  for (const [label, wait] of [['T+0', 500], ['T+1', 700], ['T+3', 2200], ['T+6', 3000]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(wait);
    // eslint-disable-next-line no-await-in-loop
    const snap = await page.evaluate(audit);
    if (label === 'T+6') summarise(`STATE A — ${label} at rest`, snap);
    else {
      const active = snap.results.find((r) => r.slidePosition === 'current') || snap.results[0];
      console.log(`  ${label}: effectiveOpacity=${active ? active.effectiveOpacity : 'n/a'} barOpacity=${active ? active.bar.opacity : 'n/a'} paused=${active ? active.videoPaused : 'n/a'}`);
    }
  }
  if (SHOOT) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `paint-${W}-A-at-rest.png`) });
    console.log(`\n    · paint-${W}-A-at-rest.png`);
  }

  // ------------------------------------------------------------- STATE B
  // The smallest interaction that reveals it: pointer movement over the stage.
  await page.mouse.move(Math.round(W / 2), Math.round(H * 0.5));
  await page.mouse.move(Math.round(W / 2), Math.round(H * 0.55));
  await page.waitForTimeout(600);
  const snapB = await page.evaluate(audit);
  summarise('STATE B — after pointer movement over the stage', snapB);
  if (SHOOT) {
    await page.screenshot({ path: path.join(SHOTS, `paint-${W}-B-after-pointer.png`) });
    console.log(`\n    · paint-${W}-B-after-pointer.png`);
  }

  await browser.close();
})().catch((error) => { console.error(error); process.exit(1); });
