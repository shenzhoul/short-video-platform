/**
 * Account menu previews — animation and data acceptance pass.
 *
 * Drives a real Chromium against the local production build, signed in as a
 * demo account that has liked posts and posts of its own.
 *
 * ## Why this file was rewritten (2026-09-11)
 *
 * The first version reported 28/28 while a person watching the menu saw the
 * previews appear instantly. It asserted that an animation *existed* — a class,
 * a keyframe name, the sign of one transform sample — and never measured what
 * the eye sees. Two things dominated: the rows below jumped the full 152px
 * preview height in a single frame, and the strip itself travelled 10px starting
 * fully transparent. So this pass measures motion, not configuration:
 *
 *   - every animation in the menu is paused through the Web Animations API and
 *     stepped to 0ms, 130ms and its end; transform, opacity and the rows' real
 *     on-screen positions are read at each step and a screenshot is taken;
 *   - an unpaused run samples every frame, so the progression and the actual
 *     duration are measured in real time;
 *   - the rows must *start* where they were and glide, not jump;
 *   - ten switches in each direction must each create new animations;
 *   - a stationary pointer must not make the sections toggle.
 *
 *   PLAYWRIGHT_PATH=<playwright> node browser-verify/46-account-menu-previews.js
 *
 * Env: PLAYWRIGHT_PATH (required, see lib/harness.js), USER_APP, API,
 * MENU_ACCOUNT, MENU_PROFILE.
 */

const path = require('path');
const fs = require('fs');
const {
  chromium, USER_APP, API, SHOT_DIR, signIn, check, summarise, routeMediaOrigin
} = require('./lib/harness');

const ACCOUNT = process.env.MENU_ACCOUNT || 'maitran.eats@demo.invalid';
const PROFILE = process.env.MENU_PROFILE || 'maitran.eats';
const SHOTS = path.join(SHOT_DIR, 'account-menu-animation');
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'output', 'playwright', 'account-menu-animation');

const PREVIEW_PATHS = ['/posts/liked', '/posts/creator-posts'];
const isPreviewRequest = (url) => PREVIEW_PATHS.some((part) => url.includes(part)) && url.includes('limit=3');

const evidence = { steps: {}, realtime: {}, restarts: {}, notes: [] };

function watchPage(page) {
  const log = {
    consoleProblems: [], previewRequests: [], previewResponses: [], failed: [], authorization: null
  };
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' || message.type() === 'warning' || /hydrat|unique "key"|unmounted component/i.test(text)) {
      log.consoleProblems.push(`${message.type()}: ${text.slice(0, 200)}`);
    }
  });
  page.on('pageerror', (error) => log.consoleProblems.push(`pageerror: ${error.message.slice(0, 200)}`));
  page.on('request', (request) => {
    const url = request.url();
    if (!isPreviewRequest(url)) return;
    log.previewRequests.push({ url, at: Date.now() });
    const header = request.headers().authorization;
    if (header) log.authorization = header;
  });
  page.on('requestfailed', (request) => {
    if (PREVIEW_PATHS.some((part) => request.url().includes(part))) log.failed.push(`${request.url()} ${request.failure()?.errorText}`);
  });
  page.on('response', async (response) => {
    const url = response.url();
    if (!isPreviewRequest(url)) return;
    if (response.status() >= 400) log.failed.push(`${response.status()} ${url}`);
    try {
      const json = await response.json();
      const rows = json?.data?.data || [];
      log.previewResponses.push({ url, count: rows.length, ids: rows.map((row) => row._id) });
    } catch {
      log.previewResponses.push({ url, count: -1, ids: [] });
    }
  });
  return log;
}

async function shot(page, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, name) });
  return path.join(SHOTS, name);
}

const panel = (page) => page.locator('[data-account-menu]');
const rowButton = (page, name) => panel(page).getByRole('button', { name });
const tilesIn = (page, section) => panel(page).locator(`[data-account-menu-section="${section}"] button[aria-label^="Open post"]`);

async function hoverCentre(page, locator) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
}

/**
 * Hover a row and freeze the switch it causes.
 *
 * Waits (in the page) for the new strip to mount, pauses every animation in the
 * menu at that instant, and returns a handle for stepping them. The rows' tops
 * are read before the hover so the glide can be compared with the jump it
 * replaced.
 */
async function hoverAndFreeze(page, rowName, section) {
  const before = await page.evaluate(() => {
    const body = document.querySelector('[data-account-menu]');
    return [...body.querySelectorAll('[data-account-menu-block]')].map((node) => node.getBoundingClientRect().top);
  });
  await hoverCentre(page, rowButton(page, rowName));
  const frozen = await page.evaluate(async (target) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const strip = document.querySelector(`[data-account-menu-strip="${target}"]`);
      if (strip && strip.getAnimations().length) {
        const body = document.querySelector('[data-account-menu]');
        const animations = document.getAnimations().filter((animation) => body.contains(animation.effect?.target));
        const firstSeenAt = Math.round(Number(strip.getAnimations()[0].currentTime));
        animations.forEach((animation) => animation.pause());
        window.__menuFrozen = animations;
        return {
          firstSeenAt,
          count: animations.length,
          // Classified by what each animation really is. A hovered row also has a
          // Tailwind `transition` (a CSSTransition on its background), which is
          // neither the strip nor the glide and must not be counted as either.
          kinds: animations.map((animation) => {
            let kind = `waapi:${animation.id}`;
            if (typeof CSSTransition !== 'undefined' && animation instanceof CSSTransition) {
              kind = `transition:${animation.transitionProperty}`;
            } else if (typeof CSSAnimation !== 'undefined' && animation instanceof CSSAnimation) {
              kind = `css:${animation.animationName}`;
            }
            return {
              kind,
              target: animation.effect?.target?.getAttribute?.('data-account-menu-strip')
                || (animation.effect?.target?.hasAttribute?.('data-account-menu-block') ? 'block' : animation.effect?.target?.tagName),
              duration: animation.effect.getComputedTiming().duration,
              easing: animation.effect.getTiming().easing
            };
          })
        };
      }
      // eslint-disable-next-line no-await-in-loop
      await frame();
    }
    return null;
  }, section);
  return { before, frozen };
}

/** Step every frozen animation to `time` (ms, or 'end') and read the composition. */
async function stepFrozen(page, section, time) {
  return page.evaluate(({ target, at }) => {
    const animations = window.__menuFrozen || [];
    animations.forEach((animation) => {
      if (at === 'end') animation.finish();
      else animation.currentTime = at;
    });
    const strip = document.querySelector(`[data-account-menu-strip="${target}"]`);
    const region = document.querySelector(`[data-account-menu-section="${target}"]`);
    const style = getComputedStyle(strip);
    const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
    const body = document.querySelector('[data-account-menu]');
    const blocks = [...body.querySelectorAll('[data-account-menu-block]')];
    const stripAnimation = strip.getAnimations()[0];
    return {
      at,
      stripAnimationName: style.animationName,
      stripAnimationDuration: style.animationDuration,
      stripPlayState: stripAnimation ? stripAnimation.playState : 'none',
      stripTranslateY: Math.round(matrix.m42 * 100) / 100,
      stripOpacity: Math.round(Number(style.opacity) * 1000) / 1000,
      regionClipPath: getComputedStyle(region).clipPath,
      blockTops: blocks.map((node) => Math.round(node.getBoundingClientRect().top * 10) / 10),
      blockTransforms: blocks.map((node) => getComputedStyle(node).transform),
      sectionsMounted: document.querySelectorAll('[data-account-menu-section]').length,
      menuOverflow: body.scrollHeight - body.clientHeight
    };
  }, { target: section, at: time });
}

/** Unpaused: hover and sample one frame at a time for 400ms. */
async function realtimeSwitch(page, rowName, section) {
  await hoverCentre(page, rowButton(page, rowName));
  return page.evaluate(async (target) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const samples = [];
    const started = performance.now();
    let firstAnimated = null;
    let lastAnimated = null;
    while (performance.now() - started < 450) {
      // eslint-disable-next-line no-await-in-loop
      await frame();
      const strip = document.querySelector(`[data-account-menu-strip="${target}"]`);
      if (!strip) continue;
      const style = getComputedStyle(strip);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      const now = Math.round(performance.now() - started);
      const moving = Math.abs(matrix.m42) > 0.05 || Number(style.opacity) < 0.999;
      if (moving && firstAnimated === null) firstAnimated = now;
      if (moving) lastAnimated = now;
      const history = [...document.querySelectorAll('[data-account-menu] button')]
        .find((node) => node.textContent.includes('Watch history'));
      samples.push({
        t: now,
        y: Math.round(matrix.m42 * 100) / 100,
        opacity: Math.round(Number(style.opacity) * 1000) / 1000,
        historyTop: Math.round(history.getBoundingClientRect().top),
        sections: document.querySelectorAll('[data-account-menu-section]').length
      });
    }
    return { samples, visibleMotionMs: firstAnimated === null ? 0 : lastAnimated - firstAnimated };
  }, section);
}

async function desktop(browser) {
  console.log('\n--- 1440x900, prefers-reduced-motion: no-preference ---');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  const log = watchPage(page);
  await signIn({ page, context }, ACCOUNT);
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const baselineProblems = log.consoleProblems.length;

  const reduced = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  evidence.reducedMotionMatches = reduced;
  check('matchMedia(prefers-reduced-motion: reduce) is false', reduced === false, `matches=${reduced}`);

  // Open on the default section.
  await hoverCentre(page, page.locator('header button:has(img)').last());
  await tilesIn(page, 'liked').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(700);
  check('menu opens on I like it with one section', await panel(page).locator('[data-account-menu-section]').count() === 1
    && await tilesIn(page, 'liked').count() === 3);
  check('opening sent exactly one liked and one works request', log.previewRequests.length === 2, log.previewRequests.map((row) => row.url).join(' | '));
  await tilesIn(page, 'works').count();

  // ---- liked -> works, frozen ----
  const toWorks = await hoverAndFreeze(page, /My work/, 'works');
  check('works switch produced strip and row animations', Boolean(toWorks.frozen) && toWorks.frozen.count > 1, JSON.stringify(toWorks.frozen));
  const worksStart = await stepFrozen(page, 'works', 0);
  await shot(page, 'works-start.png');
  const worksMid = await stepFrozen(page, 'works', 130);
  await shot(page, 'works-mid.png');
  const worksEnd = await stepFrozen(page, 'works', 'end');
  await page.waitForTimeout(50);
  await shot(page, 'works-end.png');
  evidence.steps.works = {
    blockTopsBeforeHover: toWorks.before, frozen: toWorks.frozen, start: worksStart, mid: worksMid, end: worksEnd
  };
  const stripDurations = (toWorks.frozen?.kinds || []).filter((kind) => kind.kind.startsWith('css:account-menu-strip')).map((kind) => kind.duration);
  const glideDurations = (toWorks.frozen?.kinds || []).filter((kind) => kind.kind === 'waapi:layout-glide').map((kind) => kind.duration);
  check('works strip animation is account-menu-strip-from-below, 260ms', worksStart.stripAnimationName === 'account-menu-strip-from-below' && stripDurations.every((ms) => ms >= 240), `${worksStart.stripAnimationName} ${worksStart.stripAnimationDuration} ${stripDurations}`);
  check('works start: strip translateY >= 18px and opacity ~0.35', worksStart.stripTranslateY >= 18 && worksStart.stripOpacity <= 0.4, `y=${worksStart.stripTranslateY} o=${worksStart.stripOpacity}`);
  check('works mid: translateY positive and smaller, opacity higher', worksMid.stripTranslateY > 0 && worksMid.stripTranslateY < worksStart.stripTranslateY && worksMid.stripOpacity > worksStart.stripOpacity, `y=${worksMid.stripTranslateY} o=${worksMid.stripOpacity}`);
  check('works end: translateY ~0 and opacity 1', Math.abs(worksEnd.stripTranslateY) < 0.5 && worksEnd.stripOpacity === 1, `y=${worksEnd.stripTranslateY} o=${worksEnd.stripOpacity}`);
  check('rows glide for >= 240ms', glideDurations.length > 0 && glideDurations.every((ms) => ms >= 240), `${glideDurations}`);
  // Block 1 is "My collection": it starts where it was, not at its new place.
  check('works start: rows are still drawn where they were (no jump)', Math.abs(worksStart.blockTops[1] - toWorks.before[1]) <= 2, `before=${toWorks.before[1]} start=${worksStart.blockTops[1]} end=${worksEnd.blockTops[1]}`);
  check('works mid: rows are part-way to their new place', worksMid.blockTops[1] < worksStart.blockTops[1] - 20 && worksMid.blockTops[1] > worksEnd.blockTops[1] + 5, `start=${worksStart.blockTops[1]} mid=${worksMid.blockTops[1]} end=${worksEnd.blockTops[1]}`);
  check('works: the whole works card rises from below', worksStart.blockTops[4] > worksEnd.blockTops[4] + 100, `card start=${worksStart.blockTops[4]} end=${worksEnd.blockTops[4]}`);
  check('works: one section mounted at start, mid and end', [worksStart, worksMid, worksEnd].every((step) => step.sectionsMounted === 1));
  check('works: no scrollbar flash while gliding', [worksStart, worksMid, worksEnd].every((step) => step.menuOverflow <= 0), [worksStart, worksMid, worksEnd].map((step) => step.menuOverflow).join(','));
  await page.waitForTimeout(400);

  // ---- works -> liked, frozen ----
  const toLiked = await hoverAndFreeze(page, /I like it/, 'liked');
  check('liked switch produced strip and row animations', Boolean(toLiked.frozen) && toLiked.frozen.count > 1, JSON.stringify(toLiked.frozen));
  const likedStart = await stepFrozen(page, 'liked', 0);
  await shot(page, 'liked-start.png');
  const likedMid = await stepFrozen(page, 'liked', 130);
  await shot(page, 'liked-mid.png');
  const likedEnd = await stepFrozen(page, 'liked', 'end');
  await page.waitForTimeout(50);
  await shot(page, 'liked-end.png');
  evidence.steps.liked = {
    blockTopsBeforeHover: toLiked.before, frozen: toLiked.frozen, start: likedStart, mid: likedMid, end: likedEnd
  };
  check('liked strip animation is account-menu-strip-from-above, 260ms', likedStart.stripAnimationName === 'account-menu-strip-from-above', `${likedStart.stripAnimationName} ${likedStart.stripAnimationDuration}`);
  check('liked start: strip translateY <= -18px and opacity ~0.35', likedStart.stripTranslateY <= -18 && likedStart.stripOpacity <= 0.4, `y=${likedStart.stripTranslateY} o=${likedStart.stripOpacity}`);
  check('liked mid: translateY negative and closer to 0, opacity higher', likedMid.stripTranslateY < 0 && likedMid.stripTranslateY > likedStart.stripTranslateY && likedMid.stripOpacity > likedStart.stripOpacity, `y=${likedMid.stripTranslateY} o=${likedMid.stripOpacity}`);
  check('liked end: translateY ~0 and opacity 1', Math.abs(likedEnd.stripTranslateY) < 0.5 && likedEnd.stripOpacity === 1, `y=${likedEnd.stripTranslateY} o=${likedEnd.stripOpacity}`);
  check('liked start: rows are still drawn where they were (no jump)', Math.abs(likedStart.blockTops[1] - toLiked.before[1]) <= 2, `before=${toLiked.before[1]} start=${likedStart.blockTops[1]} end=${likedEnd.blockTops[1]}`);
  check('liked mid: rows are part-way down', likedMid.blockTops[1] > likedStart.blockTops[1] + 20 && likedMid.blockTops[1] < likedEnd.blockTops[1] - 5, `start=${likedStart.blockTops[1]} mid=${likedMid.blockTops[1]} end=${likedEnd.blockTops[1]}`);
  check('liked: strip is uncovered from the top (clip-path opens)', /inset\(/.test(likedStart.regionClipPath) && likedEnd.regionClipPath !== likedStart.regionClipPath, `start=${likedStart.regionClipPath} mid=${likedMid.regionClipPath} end=${likedEnd.regionClipPath}`);
  check('liked: one section mounted at start, mid and end', [likedStart, likedMid, likedEnd].every((step) => step.sectionsMounted === 1));
  await page.waitForTimeout(400);

  // ---- unpaused, frame by frame ----
  const realWorks = await realtimeSwitch(page, /My work/, 'works');
  await page.waitForTimeout(300);
  const realLiked = await realtimeSwitch(page, /I like it/, 'liked');
  evidence.realtime = { works: realWorks, liked: realLiked };
  const worksYs = realWorks.samples.map((sample) => sample.y);
  const likedYs = realLiked.samples.map((sample) => sample.y);
  check('real time: works strip moves for >= 200ms of visible motion', realWorks.visibleMotionMs >= 200, `${realWorks.visibleMotionMs}ms`);
  check('real time: liked strip moves for >= 200ms of visible motion', realLiked.visibleMotionMs >= 200, `${realLiked.visibleMotionMs}ms`);
  check('real time: works y decreases toward 0 from a positive start', worksYs.some((y) => y > 10) && worksYs[worksYs.length - 1] === 0, worksYs.slice(0, 16).join(','));
  check('real time: liked y increases toward 0 from a negative start', likedYs.some((y) => y < -10) && likedYs[likedYs.length - 1] === 0, likedYs.slice(0, 16).join(','));
  check('real time: never two sections on any frame', [...realWorks.samples, ...realLiked.samples].every((sample) => sample.sections === 1));
  const historyTops = realWorks.samples.map((sample) => sample.historyTop);
  const distinctHistoryTops = new Set(historyTops).size;
  check('real time: Watch history glides through intermediate positions', distinctHistoryTops >= 6, `distinct tops=${distinctHistoryTops}: ${historyTops.slice(0, 14).join(',')}`);

  // ---- ten restarts each way, no requests ----
  await page.waitForTimeout(300);
  const requestsBefore = log.previewRequests.length;
  const restart = await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const rows = {
      liked: [...document.querySelectorAll('[data-account-menu] button')].find((node) => node.textContent.includes('I like it')),
      works: [...document.querySelectorAll('[data-account-menu] button')].find((node) => node.textContent.includes('My work'))
    };
    const seen = new Set();
    const results = [];
    for (let index = 0; index < 20; index += 1) {
      const target = index % 2 === 0 ? 'works' : 'liked';
      rows[target].dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'mouse' }));
      // eslint-disable-next-line no-await-in-loop
      await frame();
      // eslint-disable-next-line no-await-in-loop
      await frame();
      const strip = document.querySelector(`[data-account-menu-strip="${target}"]`);
      const animation = strip?.getAnimations()[0];
      const fresh = Boolean(animation) && !seen.has(animation);
      if (animation) seen.add(animation);
      results.push({
        target,
        fresh,
        currentTime: animation ? Math.round(Number(animation.currentTime)) : null,
        name: animation?.animationName,
        sections: document.querySelectorAll('[data-account-menu-section]').length
      });
      // Let it finish so the next switch is a clean start.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 320));
    }
    return results;
  });
  evidence.restarts = restart;
  check('20 switches (10 each way): every one starts a new animation near 0ms', restart.every((row) => row.fresh && row.currentTime !== null && row.currentTime < 80), restart.map((row) => `${row.target}:${row.currentTime}`).join(' '));
  check('20 switches: the right keyframes each time', restart.every((row) => row.name === (row.target === 'works' ? 'account-menu-strip-from-below' : 'account-menu-strip-from-above')));
  check('20 switches: exactly one section each time', restart.every((row) => row.sections === 1));
  check('switching sections sent no request', log.previewRequests.length === requestsBefore, `before=${requestsBefore} after=${log.previewRequests.length}`);

  // ---- stationary pointer does not toggle ----
  await hoverCentre(page, rowButton(page, /My work/));
  const settle = await page.evaluate(async () => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    const seen = [];
    const started = performance.now();
    while (performance.now() - started < 800) {
      // eslint-disable-next-line no-await-in-loop
      await frame();
      seen.push(document.querySelector('[data-account-menu-section]')?.getAttribute('data-account-menu-section'));
    }
    return [...new Set(seen)];
  });
  check('pointer left on My work: section stays works for 800ms (no hover loop)', settle.length === 1 && settle[0] === 'works', settle.join(','));

  // ---- tile hover scale, neighbours unmoved ----
  await page.waitForTimeout(300);
  const tileRects = async () => tilesIn(page, 'works').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  const beforeRects = await tileRects();
  await tilesIn(page, 'works').nth(1).hover();
  await page.waitForTimeout(260);
  const afterRects = await tileRects();
  const scale = await tilesIn(page, 'works').nth(1).evaluate((node) => {
    const image = node.querySelector('img');
    return image ? image.getBoundingClientRect().width / image.parentElement.getBoundingClientRect().width : null;
  });
  check('hovered tile image scales ~1.04', scale !== null && scale > 1.02 && scale < 1.06, String(scale));
  check('no tile moves or resizes on hover', beforeRects.every((rect, index) => ['x', 'y', 'width', 'height'].every((key) => Math.abs(rect[key] - afterRects[index][key]) <= 0.5)));
  check('section stays works while pointer is on a tile', await panel(page).locator('[data-account-menu-section="works"]').count() === 1);
  await shot(page, 'tile-hover.png');

  // ---- data: order, limits, profile regressions ----
  const likedResponse = log.previewResponses.find((row) => row.url.includes('/posts/liked'));
  const worksResponse = log.previewResponses.find((row) => row.url.includes('/posts/creator-posts'));
  check('preview responses hold at most three posts', log.previewResponses.every((row) => row.count >= 0 && row.count <= 3), log.previewResponses.map((row) => row.count).join(','));
  check('works preview request uses creatorOrder=latest', Boolean(worksResponse) && worksResponse.url.includes('creatorOrder=latest'));
  if (log.authorization) {
    const headers = { authorization: log.authorization };
    const sizes = [];
    const ids = [];
    let cursor = null;
    for (let guard = 0; guard < 6; guard += 1) {
      const query = cursor ? `&cursor=${cursor.id}&lastCreatedAt=${cursor.createdAt}` : '';
      // eslint-disable-next-line no-await-in-loop
      const body = await (await context.request.get(`${API}/posts/liked?limit=20${query}`, { headers })).json();
      sizes.push(body.data.data.length);
      ids.push(...body.data.data.map((row) => row._id));
      cursor = body.data.hasMore ? body.data.nextCursor : null;
      if (!cursor) break;
    }
    check('profile liked pagination still pages 20 + 20 + 20 + 7 distinct posts', JSON.stringify(sizes) === JSON.stringify([20, 20, 20, 7]) && new Set(ids).size === 67, `${sizes.join('+')} distinct=${new Set(ids).size}`);
    check('liked preview = first three likes of the profile list', JSON.stringify(likedResponse?.ids) === JSON.stringify(ids.slice(0, 3)), `preview=${likedResponse?.ids} list=${ids.slice(0, 3)}`);
    const me = new URL(worksResponse.url).searchParams.get('userId');
    const profileBody = await (await context.request.get(`${API}/posts/creator-posts?userId=${me}&limit=20`, { headers })).json();
    const rows = profileBody.data.data;
    const pinnedBlockFirst = rows.findIndex((row) => !row.isPinned) >= rows.filter((row) => row.isPinned).length;
    const newest = [...rows].sort((a, b) => (new Date(b.createdAt) - new Date(a.createdAt)) || (b._id > a._id ? 1 : -1)).slice(0, 3).map((row) => row._id);
    check('profile works (default request) still lists pinned posts first', rows.some((row) => row.isPinned) && pinnedBlockFirst, rows.slice(0, 3).map((row) => `${row._id.slice(-4)}${row.isPinned ? '*' : ''}`).join(','));
    check('works preview = three newest posts by createdAt', JSON.stringify(worksResponse.ids) === JSON.stringify(newest), `preview=${worksResponse.ids} newest=${newest}`);
  } else {
    check('captured the page session for the API comparison', false, 'no authorization header seen');
  }

  // ---- opening posts ----
  const firstWorkId = worksResponse?.ids?.[0];
  await tilesIn(page, 'works').first().click();
  await page.waitForURL(/modal_id=/, { timeout: 10000 });
  await page.waitForTimeout(1500);
  check('works tile opens post detail for that post', new URL(page.url()).searchParams.get('modal_id') === firstWorkId);
  check('post detail is on screen and the menu closed', await page.locator('[data-post-detail-popup]').count() > 0 && await panel(page).count() === 0);

  const box = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);
  check('no horizontal overflow at 1440', box);
  check('no failed preview request', log.failed.length === 0, log.failed.join(' | '));
  const newProblems = log.consoleProblems.slice(baselineProblems);
  check('no new console error or warning', newProblems.length === 0, newProblems.join(' | '));
  await context.close();
}

/** Normal-speed recording of the hover sequence, for a person to watch. */
async function recordVideo(browser) {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'no-preference',
    recordVideo: { dir: ARTIFACTS, size: { width: 1440, height: 900 } }
  });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  await signIn({ page, context }, ACCOUNT);
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  await hoverCentre(page, page.locator('header button:has(img)').last());
  await tilesIn(page, 'liked').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(900);
  for (let round = 0; round < 3; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await hoverCentre(page, rowButton(page, /My work/));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(900);
    // eslint-disable-next-line no-await-in-loop
    await hoverCentre(page, rowButton(page, /I like it/));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(900);
  }
  const video = page.video();
  await context.close();
  const recorded = await video.path();
  const target = path.join(ARTIFACTS, 'account-menu-hover-1440.webm');
  fs.copyFileSync(recorded, target);
  fs.rmSync(recorded, { force: true });
  evidence.video = target;
}

async function compact(browser) {
  console.log('\n--- 390x844 touch ---');
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference'
  });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  const log = watchPage(page);
  await signIn({ page, context }, ACCOUNT);
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const baselineProblems = log.consoleProblems.length;

  await page.locator('header button:has(img)').last().tap();
  await panel(page).waitFor({ state: 'visible', timeout: 10000 });
  await tilesIn(page, 'liked').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  const box = await panel(page).boundingBox();
  check('compact panel stays inside the viewport', Boolean(box) && box.x >= 0 && box.x + box.width <= 390.5, JSON.stringify(box));
  check('no horizontal overflow at 390 with the menu open', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  await shot(page, 'compact-390.png');
  await rowButton(page, /My work/).tap();
  await page.waitForURL(new RegExp(`/${PROFILE.replace('.', '\\.')}\\?tab=works`), { timeout: 15000 }).catch(() => {});
  check('tapping My work still navigates to the Works tab', /tab=works/.test(page.url()), page.url());
  const newProblems = log.consoleProblems.slice(baselineProblems);
  check('no new console problems on compact', newProblems.length === 0, newProblems.join(' | '));
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    await desktop(browser);
    await recordVideo(browser);
    await compact(browser);
  } finally {
    await browser.close();
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, 'animation-evidence.json'), JSON.stringify(evidence, null, 2));
  }
  process.exit(summarise('account menu previews'));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
