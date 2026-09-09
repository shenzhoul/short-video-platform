/**
 * Control-bar placement — measure the whole ancestor chain before editing.
 *
 * Walks from the transport bar up to `<html>`, recording the box, the scroll
 * geometry and every sizing property, so the element that is actually too tall
 * (or actually scrolling) is identified rather than guessed at.
 *
 *   node browser-verify/32-stage-ancestor-audit.js 440 956 for-you
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085).
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const { signIn } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const SURFACE = process.argv[4] || 'for-you';
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

const audit = () => {
  const scope = document.querySelector('[data-post-detail-popup]')
    || document.querySelector('[data-testid="post-drag-viewport"]')
    || document;
  const seek = scope.querySelector('input[aria-label="Seek video"]');
  const bar = seek
    ? seek.closest('div[class*="absolute"][class*="bottom-0"]') || seek.parentElement?.parentElement
    : null;

  const viewport = {
    innerHeight: window.innerHeight,
    docClientHeight: document.documentElement.clientHeight,
    visualHeight: window.visualViewport ? Math.round(window.visualViewport.height) : null,
    visualOffsetTop: window.visualViewport ? Math.round(window.visualViewport.offsetTop) : null,
    scrollTop: document.scrollingElement ? document.scrollingElement.scrollTop : null,
    scrollHeight: document.scrollingElement ? document.scrollingElement.scrollHeight : null,
    clientHeight: document.scrollingElement ? document.scrollingElement.clientHeight : null,
    appViewportToken: getComputedStyle(document.documentElement)
      .getPropertyValue('--app-viewport-height').trim()
  };

  if (!bar) return { viewport, bar: null, chain: [], hasVideo: Boolean(scope.querySelector('video')) };

  const chain = [];
  let node = bar;
  while (node && node !== document.documentElement.parentElement && chain.length < 18) {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    chain.push({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      cls: (node.className || '').toString().slice(0, 58),
      data: node.dataset ? Object.keys(node.dataset).slice(0, 3).join(',') : '',
      top: Math.round(rect.top),
      bottom: Math.round(rect.bottom),
      height: Math.round(rect.height),
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      scrollTop: node.scrollTop,
      cssHeight: style.height,
      minHeight: style.minHeight,
      maxHeight: style.maxHeight,
      overflowY: style.overflowY,
      position: style.position,
      display: style.display,
      flex: style.flex,
      transform: style.transform === 'none' ? 'none' : 'set',
      // The signature of the defect: a box taller than the viewport that can scroll.
      overflowsViewport: rect.bottom > window.innerHeight + 1,
      scrollsY: node.scrollHeight > node.clientHeight + 1
    });
    node = node.parentElement;
  }

  return {
    viewport,
    bar: { top: Math.round(bar.getBoundingClientRect().top), bottom: Math.round(bar.getBoundingClientRect().bottom) },
    chain,
    hasVideo: Boolean(scope.querySelector('video'))
  };
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  const page = await context.newPage();
  await signIn({ page }, ACCOUNT);

  if (SURFACE === 'popup') {
    await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('article[data-post-id]')]
        .find((element) => /\d\d:\d\d/.test(element.textContent || ''));
      (card || document.querySelector('article[data-post-id]'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  } else {
    await page.goto(`${USER_APP}/${SURFACE}`, { waitUntil: 'networkidle' });
  }
  // No scroll, no drag, no scrollIntoView — this is the initial rest state.
  await page.waitForTimeout(3200);

  const result = await page.evaluate(audit);

  console.log(`\n=== ${SURFACE} @ ${W}x${H} — ancestor audit at initial rest ===\n`);
  console.log('  viewport:', JSON.stringify(result.viewport, null, 1).replace(/\n/g, ' '));
  if (!result.bar) {
    console.log(`\n  no transport bar (hasVideo=${result.hasVideo}) — nothing to place`);
    await browser.close();
    return;
  }
  console.log(`\n  control bar: top ${result.bar.top}, bottom ${result.bar.bottom} (viewport ${result.viewport.innerHeight})`);
  console.log(`  VERDICT: ${result.bar.bottom <= result.viewport.innerHeight + 1 ? 'inside the viewport' : 'BELOW THE VIEWPORT'}`);

  console.log('\n  | # | element | top | bottom | h | client | scroll | ovfY | pos | cssH | minH | over? | scrolls? |');
  console.log('  |---|---|---|---|---|---|---|---|---|---|---|---|---|');
  result.chain.forEach((node, index) => {
    console.log(`  | ${index} | ${node.tag}${node.id ? `#${node.id}` : ''}.${node.cls.slice(0, 26)} | ${node.top} | ${node.bottom} | ${node.height} | ${node.clientHeight} | ${node.scrollHeight} | ${node.overflowY} | ${node.position} | ${node.cssHeight} | ${node.minHeight} | ${node.overflowsViewport ? 'YES' : ''} | ${node.scrollsY ? 'YES' : ''} |`);
  });

  const offenders = result.chain.filter((node) => node.overflowsViewport);
  const scrollers = result.chain.filter((node) => node.scrollsY);
  console.log(`\n  ancestors extending past the viewport: ${offenders.length}`);
  offenders.forEach((node) => console.log(`    ${node.tag}.${node.cls} — bottom ${node.bottom} vs ${result.viewport.innerHeight}, cssHeight ${node.cssHeight}`));
  console.log(`  ancestors that can scroll vertically: ${scrollers.length}`);
  scrollers.forEach((node) => console.log(`    ${node.tag}.${node.cls} — ${node.clientHeight} client / ${node.scrollHeight} scroll, overflowY ${node.overflowY}`));

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
