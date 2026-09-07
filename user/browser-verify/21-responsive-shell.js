/**
 * Responsive shell — acceptance pass.
 *
 * Drives a real Chromium over every route the compact shell touches, at four
 * viewports.
 *
 * ## Why this file grew geometry assertions
 *
 * Its first version asserted only absence of failure: no horizontal overflow,
 * no console error, the element is present, the token resolves. All 83 of those
 * checks passed against a shell whose header was nearly twice the reference
 * height, whose rail was 8px too wide, and whose Following stage was 90px too
 * narrow with the video cropped to a third of its frame. None of that is
 * detectable by "does it fit and does it error".
 *
 * So every measurement below is compared against a number **measured off the
 * supplied Douyin screenshots**, with a stated tolerance. The captures are
 * 423px wide for a 440px viewport, so an image pixel is 440/423 = 1.040 CSS px.
 *
 * It also proves the liked-post pagination end to end: "I like it" reports 67
 * in the account menu, and the grid must reach 67 by paging, not by asking for
 * one enormous page.
 *
 *   node browser-verify/21-responsive-shell.js
 *
 * Env: PLAYWRIGHT_PATH (required, see lib/harness.js), USER_APP, API.
 */

const path = require('path');
const fs = require('fs');
const {
  chromium, USER_APP, SHOT_DIR, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const PROFILE = process.env.RECO_PROFILE_A || 'maitran.eats';

/**
 * The viewports under test.
 *
 * `compact` marks the ones below the 1024px reflow point, which is what decides
 * whether the compact rail or the labelled one is expected.
 */
const VIEWPORTS = [
  { label: '440x956', width: 440, height: 956, compact: true, primary: true },
  { label: '390x844', width: 390, height: 844, compact: true },
  { label: '768x1024', width: 768, height: 1024, compact: true },
  { label: '1440x900', width: 1440, height: 900, compact: false }
];

const ROUTES = [
  { name: 'home', path: '/' },
  { name: 'for-you', path: '/for-you' },
  { name: 'following', path: '/following' },
  { name: 'friends', path: '/friend' },
  { name: 'profile', path: `/${PROFILE}` },
  { name: 'profile-liked', path: `/${PROFILE}?tab=liked` }
];

/**
 * Document-level horizontal overflow, with the elements responsible.
 *
 * `scrollWidth > clientWidth` on the root element is the only definition that
 * matches what a person sees; an element merely being wider than the viewport
 * is fine if something above it clips.
 */
async function horizontalOverflow(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const overflowing = root.scrollWidth > root.clientWidth + 1;
    const offenders = [];
    if (overflowing) {
      document.querySelectorAll('body *').forEach((element) => {
        const box = element.getBoundingClientRect();
        if (!box.width || !box.height) return;
        if (box.right > root.clientWidth + 1 || box.left < -1) {
          offenders.push(`${element.tagName.toLowerCase()}.${String(element.className).slice(0, 60)} [${Math.round(box.left)}..${Math.round(box.right)}]`);
        }
      });
    }
    return { overflowing, scrollWidth: root.scrollWidth, clientWidth: root.clientWidth, offenders: offenders.slice(0, 6) };
  });
}

/**
 * The measured reference geometry, in CSS pixels at a 440px viewport.
 *
 * `tolerance` is how far the implementation may sit from the reference before
 * the check fails. It is deliberately tight for the shell chrome — those are
 * single numbers driven by one token each — and looser for a stage width, which
 * is a remainder and therefore carries the rounding of everything before it.
 */
const REFERENCE_440 = {
  headerHeight: { target: 32, tolerance: 4 },
  railWidth: { target: 48, tolerance: 3 },
  followingStripWidth: { target: 28, tolerance: 4 },
  forYouStageWidth: { target: 392, tolerance: 12 },
  followingStageWidth: { target: 364, tolerance: 12 },
  detailPanelRatio: { target: 0.38, tolerance: 0.03 }
};

const near = (value, spec) => typeof value === 'number' && Math.abs(value - spec.target) <= spec.tolerance;

/**
 * Whether a media element is showing its whole frame.
 *
 * The rendered aspect ratio of a `contain` element does not equal the intrinsic
 * one — the element is letterboxed *inside* its box — so the test is on the
 * computed `object-fit`, plus a check that the element is not being scaled or
 * pushed outside its container by a transform or a negative offset.
 */
function mediaContainment(page, selector) {
  return page.evaluate((sel) => {
    const stage = document.querySelector(sel);
    const el = stage?.querySelector('video, img');
    if (!el) return { found: false };
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const parent = el.parentElement.getBoundingClientRect();
    const intrinsicW = el.tagName === 'VIDEO' ? el.videoWidth : el.naturalWidth;
    const intrinsicH = el.tagName === 'VIDEO' ? el.videoHeight : el.naturalHeight;
    return {
      found: true,
      tag: el.tagName.toLowerCase(),
      objectFit: style.objectFit,
      transform: style.transform,
      minWidth: style.minWidth,
      intrinsic: intrinsicW && intrinsicH ? intrinsicW / intrinsicH : null,
      // Both horizontal edges inside the container it is drawn in.
      insideContainer: box.left >= parent.left - 1 && box.right <= parent.right + 1,
      renderedRatio: box.height ? box.width / box.height : null
    };
  }, selector);
}

/** Geometry of the shell chrome, as the browser resolves it. */
async function shellGeometry(page) {
  return page.evaluate(() => {
    const navWidth = getComputedStyle(document.documentElement).getPropertyValue('--app-shell-nav-width').trim();
    const rail = document.querySelector('div.fixed.left-0.top-0');
    const header = document.querySelector('header');
    const box = (element) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height)
      };
    };
    return { navWidth, rail: box(rail), header: box(header), viewport: window.innerWidth };
  });
}

async function signInOnce(page) {
  await signIn({ page }, ACCOUNT);
}

/** Every listed nav destination reachable, and inside the viewport. */
async function navDestinationsVisible(page) {
  return page.evaluate(() => {
    const labels = ['Topick', 'For You', 'Following', 'Friends', 'Profile', 'Games'];
    const rail = document.querySelector('div.fixed.left-0.top-0');
    if (!rail) return { ok: false, missing: labels };
    const text = rail.innerText;
    const missing = labels.filter((label) => !text.includes(label));
    const box = rail.getBoundingClientRect();
    return { ok: missing.length === 0 && box.bottom <= window.innerHeight + 1, missing, bottom: Math.round(box.bottom) };
  });
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 200));
  });
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`));
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url().slice(0, 140)}`);
  });

  await signInOnce(page);

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    for (const route of ROUTES) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`${USER_APP}${route.path}`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(3500);

      // eslint-disable-next-line no-await-in-loop
      const overflow = await horizontalOverflow(page);
      check(
        `${viewport.label} ${route.name}: no document-level horizontal overflow`,
        !overflow.overflowing,
        overflow.overflowing ? `${overflow.scrollWidth}>${overflow.clientWidth} — ${overflow.offenders.join(' | ')}` : ''
      );

      // eslint-disable-next-line no-await-in-loop
      const geometry = await shellGeometry(page);
      const expectedNav = viewport.compact ? '48px' : '160px';
      check(
        `${viewport.label} ${route.name}: navigation is ${expectedNav}`,
        geometry.navWidth === expectedNav && geometry.rail?.width === Number(expectedNav.replace('px', '')),
        `token=${geometry.navWidth} rail=${geometry.rail?.width}`
      );
      check(
        `${viewport.label} ${route.name}: header starts beside the rail and ends at the viewport`,
        geometry.header != null
          && Math.abs(geometry.header.left - Number(expectedNav.replace('px', ''))) <= 1
          && Math.abs(geometry.header.right - viewport.width) <= 1,
        `header=${geometry.header?.left}..${geometry.header?.right} viewport=${viewport.width}`
      );

      if (route.name === 'home') {
        // eslint-disable-next-line no-await-in-loop
        const nav = await navDestinationsVisible(page);
        check(
          `${viewport.label}: every navigation destination is present and on screen`,
          nav.ok,
          nav.missing?.length ? `missing ${nav.missing.join(',')}` : `bottom=${nav.bottom}`
        );
      }

      if (viewport.primary) {
        const file = path.join(SHOT_DIR, `responsive-440-${ROUTES.indexOf(route) + 1}-${route.name}.png`);
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: file });
      }
    }
  }

  // ---- Stage geometry and media containment, at the primary viewport -------
  await page.setViewportSize({ width: 440, height: 956 });

  await page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const forYou = await page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10;
    const stage = document.querySelector('section > div[style*="width"]');
    const capsule = document.querySelector('aside[aria-label="Video navigation"]');
    const cb = capsule?.getBoundingClientRect();
    return {
      stageWidth: stage ? round(stage.getBoundingClientRect().width) : null,
      stageRight: stage ? round(stage.getBoundingClientRect().right) : null,
      capsuleVisible: Boolean(cb && cb.width > 0 && cb.height > 0)
    };
  });
  check(
    `440 for-you: stage width matches the reference (${REFERENCE_440.forYouStageWidth.target}px)`,
    near(forYou.stageWidth, REFERENCE_440.forYouStageWidth),
    `measured ${forYou.stageWidth}px, right edge ${forYou.stageRight}`
  );
  check(
    '440 for-you: the stage runs to the right edge, with no reserved nav column',
    Math.abs((forYou.stageRight ?? 0) - 440) <= 1 && !forYou.capsuleVisible,
    `right=${forYou.stageRight} capsule=${forYou.capsuleVisible}`
  );
  const forYouMedia = await mediaContainment(page, 'section > div[style*="width"]');
  check(
    '440 for-you: media is contained, not cropped to fill the stage',
    forYouMedia.found && forYouMedia.objectFit === 'contain' && forYouMedia.insideContainer,
    JSON.stringify(forYouMedia)
  );
  check(
    '440 for-you: nothing scales or offsets the media out of its container',
    forYouMedia.transform === 'none' && ['auto', '0px'].includes(forYouMedia.minWidth),
    `transform=${forYouMedia.transform} minWidth=${forYouMedia.minWidth}`
  );

  await page.goto(`${USER_APP}/following`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const following = await page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10;
    const strip = document.querySelector('aside[class*="border-r"]');
    const stage = document.querySelector('section > div[style*="width"]');
    return {
      stripWidth: strip ? round(strip.getBoundingClientRect().width) : null,
      stageWidth: stage ? round(stage.getBoundingClientRect().width) : null,
      stageLeft: stage ? round(stage.getBoundingClientRect().left) : null,
      stageRight: stage ? round(stage.getBoundingClientRect().right) : null
    };
  });
  check(
    `440 following: creator strip matches the reference (${REFERENCE_440.followingStripWidth.target}px)`,
    near(following.stripWidth, REFERENCE_440.followingStripWidth),
    `measured ${following.stripWidth}px`
  );
  check(
    `440 following: stage width matches the reference (${REFERENCE_440.followingStageWidth.target}px)`,
    near(following.stageWidth, REFERENCE_440.followingStageWidth),
    `measured ${following.stageWidth}px (${following.stageLeft}..${following.stageRight})`
  );
  const followingMedia = await mediaContainment(page, 'section > div[style*="width"]');
  check(
    '440 following: media is contained, not cropped to fill the stage',
    followingMedia.found && followingMedia.objectFit === 'contain' && followingMedia.insideContainer,
    JSON.stringify(followingMedia)
  );

  // ---- Topic grid ----------------------------------------------------------
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const topic = await page.evaluate(() => {
    const round = (n) => Math.round(n * 10) / 10;
    const grid = document.querySelector('#home-feed-scroll .grid');
    if (!grid) return null;
    const cards = Array.from(grid.children).slice(0, 3).map((el) => {
      const b = el.getBoundingClientRect();
      return { x: round(b.x), w: round(b.width), y: round(b.y) };
    });
    return {
      columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      width: round(grid.getBoundingClientRect().width),
      cards
    };
  });
  check('440 topic: two columns', topic?.columns === 2, `${topic?.columns} columns`);
  check(
    '440 topic: the first card does not span both columns',
    topic != null && Math.abs(topic.cards[0].w - topic.cards[1].w) <= 1 && topic.cards[0].w < topic.width - 20,
    JSON.stringify(topic?.cards)
  );
  check(
    '440 topic: the first two cards sit side by side on row one',
    topic != null && topic.cards[0].x < topic.cards[1].x && Math.abs(topic.cards[0].y - topic.cards[1].y) <= 1,
    JSON.stringify(topic?.cards)
  );

  // ---- Profile hero --------------------------------------------------------
  await page.goto(`${USER_APP}/${PROFILE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  const profile = await page.evaluate(() => {
    const grid = document.querySelector('ul.grid');
    return {
      gridTop: grid ? Math.round(grid.getBoundingClientRect().y) : null,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(' ') : null
    };
  });
  check(
    '440 profile: the grid begins in the upper half of the viewport',
    typeof profile.gridTop === 'number' && profile.gridTop < 478,
    `first row at y=${profile.gridTop} of 956`
  );
  check(
    '440 profile: three equal columns',
    profile.columns?.length === 3
      && Math.abs(parseFloat(profile.columns[0]) - parseFloat(profile.columns[2])) <= 1,
    (profile.columns || []).join(' ')
  );

  // ---- Detail popup --------------------------------------------------------
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4500);
  await page.locator('.home-feed-card-media').nth(1).click({ timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Comment' }).first().click();
  await page.waitForTimeout(3000);
  const detail = await page.evaluate(() => {
    const round = (n) => Math.round(n * 1000) / 1000;
    const overlay = document.querySelector('div[class*="z-120"]');
    const panel = document.querySelector('aside[class*="border-l"]');
    const nav = panel?.querySelector('nav');
    const close = panel?.querySelector('button[aria-label="Close details panel"]');
    const nb = nav?.getBoundingClientRect();
    const v = overlay?.querySelector('video');
    const first = nav?.querySelector('button');
    const fr = first?.getBoundingClientRect();
    const cr = close?.getBoundingClientRect();
    return {
      overlayWidth: overlay ? Math.round(overlay.getBoundingClientRect().width) : null,
      panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : null,
      mediaWidth: overlay && panel
        ? Math.round(overlay.getBoundingClientRect().width - panel.getBoundingClientRect().width) : null,
      ratio: overlay && panel
        ? round(panel.getBoundingClientRect().width / overlay.getBoundingClientRect().width) : null,
      firstTabVisible: Boolean(fr && nb && fr.left >= nb.left - 0.5 && fr.right <= nb.right + 0.5),
      closeVisible: Boolean(cr && cr.width > 0 && cr.right <= window.innerWidth + 0.5),
      // Either media kind can be at this index — the feed is a ranked session,
      // so asserting on `video` alone made this check depend on which post the
      // recommendation happened to place second.
      mediaFit: (() => {
        const el = overlay?.querySelector('video') || overlay?.querySelector('img[class*="object-"]');
        return el ? { tag: el.tagName.toLowerCase(), fit: getComputedStyle(el).objectFit } : null;
      })()
    };
  });
  check(
    `440 detail: media/panel split matches the reference (${REFERENCE_440.detailPanelRatio.target})`,
    near(detail.ratio, REFERENCE_440.detailPanelRatio),
    `panel ${detail.panelWidth}px / media ${detail.mediaWidth}px = ${detail.ratio}`
  );
  check(
    '440 detail: the media side is the wider one',
    (detail.mediaWidth ?? 0) > (detail.panelWidth ?? 0),
    `${detail.mediaWidth} vs ${detail.panelWidth}`
  );
  check('440 detail: the first tab is not clipped', detail.firstTabVisible, `firstTabVisible=${detail.firstTabVisible}`);
  check('440 detail: the close control is reachable', detail.closeVisible, `closeVisible=${detail.closeVisible}`);
  check(
    '440 detail: the stage media is contained',
    detail.mediaFit != null && detail.mediaFit.fit === 'contain',
    JSON.stringify(detail.mediaFit)
  );
  await page.screenshot({ path: path.join(SHOT_DIR, 'responsive-440-detail-comments.png') });
  await page.getByRole('button', { name: /close (video|graphic details)/i }).first().click()
    .catch(() => page.keyboard.press('Escape'));
  await page.waitForTimeout(1200);

  // ---- Detail tab row: every tab drawn, on one line, never scrolling -------
  //
  // The row used to be `overflow-x-auto` with a `pr` reservation guessed
  // against an absolutely-positioned close button: five English labels needed
  // ~190px of a 167px panel, so it scrolled, `Details` was pushed under the
  // left edge and `Ask AI` rendered as the single letter "A". These assertions
  // are on the geometry, because "the element exists" was true throughout.
  for (const [width, height] of [[440, 956], [390, 844]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.setViewportSize({ width, height });
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(4200);
    // eslint-disable-next-line no-await-in-loop
    await page.locator('.home-feed-card-media').nth(1).click({ timeout: 15000 });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2400);
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name: 'Comment' }).first().click();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2600);

    const states = ['Details', 'Videos', 'Comments', 'Related', 'Ask AI'];
    const seen = [];
    for (const state of states) {
      // eslint-disable-next-line no-await-in-loop
      await page.locator(`nav[aria-label="Video details"] button[aria-label="${state}"]`).click();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(1200);
      // eslint-disable-next-line no-await-in-loop
      const m = await page.evaluate(() => {
        const round = (n) => Math.round(n * 10) / 10;
        const panel = document.querySelector('aside[class*="border-l"]');
        const nav = panel?.querySelector('nav');
        const close = panel?.querySelector('button[aria-label="Close details panel"]');
        if (!panel || !nav || !close) return null;
        const nb = nav.getBoundingClientRect();
        const pb = panel.getBoundingClientRect();
        const cb = close.getBoundingClientRect();
        const btns = Array.from(nav.querySelectorAll('button'));
        const tabs = btns.map((b) => {
          const bb = b.getBoundingClientRect();
          const span = Array.from(b.querySelectorAll('span')).find((el) => el.offsetParent !== null) || b;
          return {
            label: span.textContent,
            w: round(bb.width),
            left: round(bb.left),
            right: round(bb.right),
            truncated: span.scrollWidth > span.clientWidth + 1,
            inside: bb.left >= nb.left - 0.5 && bb.right <= nb.right + 0.5
          };
        });
        return {
          count: tabs.length,
          tabs,
          fontSize: btns.length ? getComputedStyle(btns[0]).fontSize : null,
          rowHeight: round(nb.height),
          scrollLeft: nav.scrollLeft,
          fits: nav.scrollWidth <= nav.clientWidth + 1,
          firstInside: tabs[0].left >= round(nb.left) - 0.5,
          lastBeforeClose: tabs[tabs.length - 1].right <= round(cb.left) + 0.5,
          closeInsidePanel: cb.right <= pb.right + 0.5,
          closeWidth: round(cb.width),
          panelWidth: round(pb.width)
        };
      });
      seen.push({ state, m });
      const clipped = m ? m.tabs.filter((t) => !t.inside || t.truncated).map((t) => t.label) : ['<no panel>'];
      check(
        `${width} detail tabs [${state}]: all five drawn, none clipped or truncated`,
        Boolean(m) && m.count === 5 && clipped.length === 0,
        m ? `${m.tabs.map((t) => `${t.label}(${t.w})`).join(' ')}${clipped.length ? ` clipped: ${clipped.join(',')}` : ''}` : 'panel not found'
      );
      check(
        `${width} detail tabs [${state}]: one line, no horizontal scrolling`,
        Boolean(m) && m.fits && m.scrollLeft === 0,
        m ? `scrollLeft=${m.scrollLeft} fits=${m.fits} font=${m.fontSize} rowH=${m.rowHeight}` : ''
      );
      check(
        `${width} detail tabs [${state}]: first tab inside, last clears the close, close inside the panel`,
        Boolean(m) && m.firstInside && m.lastBeforeClose && m.closeInsidePanel,
        m ? `first=${m.firstInside} lastBeforeClose=${m.lastBeforeClose} closeInside=${m.closeInsidePanel} close=${m.closeWidth}px panel=${m.panelWidth}px` : ''
      );
    }
    // Switching tabs must not move the row.
    const geometries = seen.map((entry) => (entry.m ? entry.m.tabs.map((t) => `${t.left}:${t.right}`).join('|') : 'x'));
    check(
      `${width} detail tabs: geometry is identical in all five states`,
      new Set(geometries).size === 1,
      `${new Set(geometries).size} distinct layouts`
    );
    check(
      `${width} detail tabs: no state scrolled the row`,
      seen.every((entry) => entry.m && entry.m.scrollLeft === 0),
      seen.map((entry) => `${entry.state}=${entry.m?.scrollLeft}`).join(' ')
    );
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name: /close (video|graphic details)/i }).first().click()
      .catch(() => page.keyboard.press('Escape'));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1000);
  }

  // ---- Shared header composition -------------------------------------------
  //
  // The search was `flex-1`, so it took every pixel the action group did not
  // and the bar read as one field with the icons crushed against the edge. It
  // is a fixed compact block anchored left now, matching the reference.
  const HEADER_SEARCH = { target: 168, tolerance: 8 };
  for (const [width, height, compact] of [[440, 956, true], [390, 844, true], [768, 1024, true], [1440, 900, false]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.setViewportSize({ width, height });
    for (const route of ['/', '/for-you', '/following', `/${PROFILE}`]) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`${USER_APP}${route}`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(3200);
      // eslint-disable-next-line no-await-in-loop
      const h = await page.evaluate(() => {
        const round = (n) => Math.round(n * 10) / 10;
        const header = document.querySelector('header');
        const hb = header.getBoundingClientRect();
        const search = header.querySelector('input')?.closest('div[class*="transition-all"]');
        const sb = search?.getBoundingClientRect();
        // The right-hand action group only; the search field has controls of
        // its own that are not header actions.
        const group = header.querySelector('div.float-right > div');
        const gb = group?.getBoundingClientRect();
        const named = (root, selector) => Array.from(root.querySelectorAll(selector))
          .filter((el) => {
            const b = el.getBoundingClientRect();
            return b.width > 0 && b.height > 0;
          })
          .map((el) => el.getAttribute('aria-label'));
        return {
          headerLeft: round(hb.left), headerRight: round(hb.right),
          searchLeft: sb ? round(sb.left) : null,
          searchWidth: sb ? round(sb.width) : null,
          searchRight: sb ? round(sb.right) : null,
          groupLeft: gb ? round(gb.left) : null,
          groupRight: gb ? round(gb.right) : null,
          actions: group ? named(group, 'a[aria-label], button[aria-label], span[aria-label]') : [],
          overflowTriggers: group ? named(group, 'button[aria-label="More"]').length : 0,
          docOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
        };
      });

      const direct = h.actions.filter((label) => !['More', 'Mai Tran'].includes(label));
      if (compact) {
        check(
          `${width} ${route}: search is the compact left-anchored block (${HEADER_SEARCH.target}px)`,
          Math.abs(h.searchWidth - HEADER_SEARCH.target) <= HEADER_SEARCH.tolerance
            && Math.abs(h.searchLeft - h.headerLeft) <= 8,
          `width=${h.searchWidth} left=${h.searchLeft} headerLeft=${h.headerLeft}`
        );
        check(
          `${width} ${route}: the action group is right-aligned, clear of the search`,
          h.groupRight != null && Math.abs(h.groupRight - h.headerRight) <= 8 && h.groupLeft > h.searchRight,
          `group ${h.groupLeft}..${h.groupRight}, header right ${h.headerRight}, search right ${h.searchRight}`
        );
        check(
          `${width} ${route}: exactly three direct actions plus one overflow and one avatar`,
          direct.length === 3 && h.overflowTriggers === 1 && h.actions.includes('Mai Tran'),
          `direct=[${direct.join(',')}] overflow=${h.overflowTriggers} all=[${h.actions.join(',')}]`
        );
        check(
          `${width} ${route}: the promotional actions are not directly visible`,
          !h.actions.some((label) => ['Top-up', 'Client', 'Wallpaper'].includes(label)),
          `[${h.actions.join(',')}]`
        );
      } else {
        check(
          `${width} ${route}: desktop still shows the promotional actions inline`,
          ['Top-up', 'Client', 'Wallpaper'].every((label) => h.actions.includes(label)),
          `[${h.actions.join(',')}]`
        );
      }
      check(`${width} ${route}: no document-level horizontal overflow`, !h.docOverflow, '');
    }
  }

  // Overflow menu behaviour, at the primary viewport.
  await page.setViewportSize({ width: 440, height: 956 });
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3800);
  const moreTrigger = page.locator('header button[aria-label="More"]');
  check(
    'header overflow: the trigger is a focusable button with popup semantics',
    (await moreTrigger.evaluate((el) => el.tagName.toLowerCase())) === 'button'
      && (await moreTrigger.getAttribute('aria-haspopup')) === 'menu'
      && (await moreTrigger.evaluate((el) => { el.focus(); return document.activeElement === el; })),
    ''
  );
  await moreTrigger.click();
  await page.waitForTimeout(700);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('header [role="menu"]');
    if (!m) return null;
    const b = m.getBoundingClientRect();
    return {
      items: Array.from(m.querySelectorAll('[role="menuitem"]')).map((i) => i.textContent.trim()),
      inViewport: b.left >= -0.5 && b.right <= window.innerWidth + 0.5
    };
  });
  check(
    'header overflow: holds exactly the actions removed from the bar, inside the viewport',
    Boolean(menu) && menu.inViewport
      && ['Top-up', 'Client', 'Wallpaper'].every((label) => menu.items.includes(label))
      && !menu.items.some((label) => ['Notification', 'Message', 'Upload'].includes(label)),
    JSON.stringify(menu)
  );
  check(
    'header overflow: aria-expanded tracks the open state',
    (await moreTrigger.getAttribute('aria-expanded')) === 'true',
    ''
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  check(
    'header overflow: Escape closes it',
    !(await page.evaluate(() => Boolean(document.querySelector('header [role="menu"]')))),
    ''
  );
  await moreTrigger.click();
  await page.waitForTimeout(600);
  await page.mouse.click(220, 620);
  await page.waitForTimeout(600);
  check(
    'header overflow: an outside click closes it',
    !(await page.evaluate(() => Boolean(document.querySelector('header [role="menu"]')))),
    ''
  );

  // ---- Post-detail visual convergence --------------------------------------
  //
  // Geometry and computed styles, not visibility. Every value below was wrong
  // in a build that passed the visibility checks: the image was 36px off centre
  // because the media column reserved 72px for an *overlaying* action rail; the
  // message button sat 17.5px inside the panel because it read the panel width
  // from a variable declared on a sibling and silently used the 28.5714%
  // fallback; and Messages overlaid the post entirely because a fullscreen
  // surface was treated as an ordinary page below 1280px.
  const POPUP_PHOTO = process.env.POPUP_PHOTO_ID || '6a99a429e27e75360f9832df';
  const POPUP_VIDEO = process.env.POPUP_VIDEO_ID || '6a99a429e27e75360f9832e3';

  for (const [width, height] of [[440, 956], [390, 844]]) {
    // eslint-disable-next-line no-await-in-loop
    await page.setViewportSize({ width, height });

    // Media centring, both media kinds, panel closed and open.
    for (const [id, label] of [[POPUP_PHOTO, 'photo'], [POPUP_VIDEO, 'video']]) {
      for (const openPanel of [false, true]) {
        // eslint-disable-next-line no-await-in-loop
        await page.goto(`${USER_APP}/?modal_id=${id}`, { waitUntil: 'domcontentloaded' });
        // eslint-disable-next-line no-await-in-loop
        await page.waitForTimeout(5000);
        if (openPanel) {
          // eslint-disable-next-line no-await-in-loop
          await page.getByRole('button', { name: 'Comment' }).first().click().catch(() => {});
          // eslint-disable-next-line no-await-in-loop
          await page.waitForTimeout(2200);
        }
        // eslint-disable-next-line no-await-in-loop
        const m = await page.evaluate(() => {
          const r = (n) => Math.round(n * 10) / 10;
          const overlay = document.querySelector('div[class*="z-120"]');
          const panel = document.querySelector('aside[class*="border-l"]');
          const media = overlay.querySelector('video') || overlay.querySelector('main img:not([aria-hidden])');
          if (!media) return null;
          const ob = overlay.getBoundingClientRect();
          const pb = panel ? panel.getBoundingClientRect() : null;
          const mb = media.getBoundingClientRect();
          const iw = media.tagName === 'VIDEO' ? media.videoWidth : media.naturalWidth;
          const ih = media.tagName === 'VIDEO' ? media.videoHeight : media.naturalHeight;
          const canvasLeft = ob.left;
          const canvasRight = pb ? pb.left : ob.right;
          // Where the contained frame actually paints inside its element box.
          const painted = iw / ih > mb.width / mb.height ? mb.width : mb.height * (iw / ih);
          const paintedCentre = mb.left + (mb.width - painted) / 2 + painted / 2;
          return {
            canvasCentre: r((canvasLeft + canvasRight) / 2),
            paintedCentre: r(paintedCentre),
            fit: getComputedStyle(media).objectFit,
            intrinsic: `${iw}x${ih}`
          };
        });
        check(
          `${width} popup [${label}, panel ${openPanel ? 'open' : 'closed'}]: media is centred in the media canvas`,
          Boolean(m) && Math.abs(m.paintedCentre - m.canvasCentre) <= 2 && m.fit === 'contain',
          m ? `canvas centre ${m.canvasCentre}, painted centre ${m.paintedCentre}, ${m.intrinsic} ${m.fit}` : 'no media'
        );
      }
    }

    // Message button: inside the media column, clear of the panel, hit-testable.
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`${USER_APP}/?modal_id=${POPUP_VIDEO}`, { waitUntil: 'domcontentloaded' });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(5000);
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name: 'Comment' }).first().click();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2400);
    // eslint-disable-next-line no-await-in-loop
    const btn = await page.evaluate(() => {
      const overlay = document.querySelector('div[class*="z-120"]');
      const panel = document.querySelector('aside[class*="border-l"]');
      const el = overlay.querySelector('button[aria-label="Open messages"]');
      if (!el || !panel) return null;
      const b = el.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const o = overlay.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {
        left: Math.round(b.left), right: Math.round(b.right),
        panelLeft: Math.round(p.left), overlayLeft: Math.round(o.left),
        gap: Math.round(p.left - b.right),
        hit: Boolean(hit && (hit === el || el.contains(hit)))
      };
    });
    check(
      `${width} popup: the message button sits inside the media column, clear of the panel`,
      Boolean(btn) && btn.right <= btn.panelLeft - 6 && btn.left >= btn.overlayLeft && btn.hit,
      btn ? `button ${btn.left}..${btn.right}, panel at ${btn.panelLeft}, gap ${btn.gap}, hit-test ${btn.hit}` : 'not found'
    );

    // Messages reflows into a third column instead of covering the post.
    // eslint-disable-next-line no-await-in-loop
    await page.locator('button[aria-label="Open messages"]').click();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2800);
    // eslint-disable-next-line no-await-in-loop
    const cols = await page.evaluate(() => {
      const r = (n) => Math.round(n * 10) / 10;
      const overlay = document.querySelector('div[class*="z-120"]');
      const panel = document.querySelector('aside[class*="border-l"]');
      const ws = document.querySelector('aside[aria-label="Messages"]');
      const inner = ws ? ws.querySelector('div') : null;
      if (!overlay || !panel || !inner) return null;
      const o = overlay.getBoundingClientRect();
      const p = panel.getBoundingClientRect();
      const w = inner.getBoundingClientRect();
      return {
        mediaLeft: r(o.left), mediaRight: r(p.left),
        detailLeft: r(p.left), detailRight: r(p.right),
        msgLeft: r(w.left), msgRight: r(w.right),
        scrim: Boolean(document.querySelector('button[aria-label="Close messages"][class*="bg-black/40"]')),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    });
    check(
      `${width} popup: Messages is a third column, not an overlay`,
      Boolean(cols)
        && cols.mediaRight - cols.mediaLeft > 0 && cols.detailRight - cols.detailLeft > 0 && cols.msgRight - cols.msgLeft > 0
        && cols.mediaRight <= cols.detailLeft + 0.5
        && cols.detailRight <= cols.msgLeft + 0.5
        && cols.msgRight <= width + 0.5
        && !cols.scrim && !cols.overflow,
      cols ? `media ${cols.mediaLeft}..${cols.mediaRight} | detail ${cols.detailLeft}..${cols.detailRight} | messages ${cols.msgLeft}..${cols.msgRight} | scrim ${cols.scrim}` : 'not found'
    );
    // eslint-disable-next-line no-await-in-loop
    await page.locator('button[aria-label="Close messages"]').first().click().catch(() => {});
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1600);
    // eslint-disable-next-line no-await-in-loop
    const restored = await page.evaluate(() => {
      const overlay = document.querySelector('div[class*="z-120"]');
      const panel = document.querySelector('aside[class*="border-l"]');
      return {
        overlayRight: overlay ? Math.round(overlay.getBoundingClientRect().right) : null,
        panelPresent: Boolean(panel),
        activeTab: panel ? (panel.querySelector('[data-panel-tab="active"]') || {}).textContent : null
      };
    });
    check(
      `${width} popup: closing Messages restores the two-column layout and keeps the tab`,
      restored.overlayRight === width && restored.panelPresent && restored.activeTab === 'Comments',
      `overlay right ${restored.overlayRight}, panel ${restored.panelPresent}, active tab ${restored.activeTab}`
    );

    // Typography of the four dense regions.
    // eslint-disable-next-line no-await-in-loop
    const typo = await page.evaluate(() => {
      const f = (el) => (el ? getComputedStyle(el).fontSize : null);
      const lh = (el) => (el ? getComputedStyle(el).lineHeight : null);
      const overlay = document.querySelector('div[class*="z-120"]');
      const panel = document.querySelector('aside[class*="border-l"]');
      const desc = overlay.querySelector('div[class*="drop-shadow"][class*="bottom-"]');
      const like = panel.querySelector('[data-testid^="comment-likes-"]');
      const row = like ? like.closest('div[class*="group"]') : null;
      return {
        descAuthor: f(desc ? desc.querySelector('div') : null),
        commentName: f(row ? row.querySelector('[class*="font-semibold"]') : null),
        commentBody: f(row ? row.querySelector('p') : null),
        commentBodyLh: lh(row ? row.querySelector('p') : null),
        commentAvatar: row ? Math.round(row.querySelector('img').getBoundingClientRect().width) : null
      };
    });
    check(
      `${width} popup: comment typography is the dense scale`,
      typo.commentName === '10px' && typo.commentBody === '10px' && typo.commentBodyLh === '13px' && typo.commentAvatar === 20,
      JSON.stringify(typo)
    );

    // Videos tab: the Follow control stays inside the panel and the tiles stay equal.
    // eslint-disable-next-line no-await-in-loop
    await page.locator('nav[aria-label="Video details"] button[aria-label="Videos"]').click();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2600);
    // eslint-disable-next-line no-await-in-loop
    const videos = await page.evaluate(() => {
      const r = (n) => Math.round(n * 10) / 10;
      const panel = document.querySelector('aside[class*="border-l"]');
      const follow = Array.from(panel.querySelectorAll('button')).find((b) => /Follow/i.test(b.textContent));
      const grid = panel.querySelector('div[class*="grid-cols-3"]');
      const widths = grid ? Array.from(grid.children).slice(0, 3).map((c) => r(c.getBoundingClientRect().width)) : [];
      const pinned = panel.querySelector('span[class*="face15"]');
      const tile = pinned ? pinned.closest('button') : null;
      return {
        followRight: follow ? r(follow.getBoundingClientRect().right) : null,
        followFont: follow ? getComputedStyle(follow).fontSize : null,
        panelRight: r(panel.getBoundingClientRect().right),
        widths,
        equal: widths.length === 3 && Math.abs(widths[0] - widths[2]) <= 0.5,
        pinnedFitsTile: pinned && tile
          ? pinned.getBoundingClientRect().right <= tile.getBoundingClientRect().right + 0.5 : null,
        pinnedFont: pinned ? getComputedStyle(pinned).fontSize : null
      };
    });
    check(
      `${width} popup: the Follow control stays inside the panel`,
      videos.followRight === null || videos.followRight <= videos.panelRight + 0.5,
      `follow right ${videos.followRight}, panel right ${videos.panelRight}, font ${videos.followFont}`
    );
    check(
      `${width} popup: three equal video tiles, pinned badge inside its tile`,
      videos.equal && videos.pinnedFitsTile !== false,
      `${videos.widths.join('/')} pinnedFits=${videos.pinnedFitsTile} pinnedFont=${videos.pinnedFont}`
    );
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name: /close (video|graphic details)/i }).first().click()
      .catch(() => page.keyboard.press('Escape'));
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1200);
  }

  // ---- Liked pagination, at the primary viewport ---------------------------
  await page.setViewportSize({ width: 440, height: 956 });
  await page.goto(`${USER_APP}/${PROFILE}?tab=liked`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const likedRequests = [];
  page.on('response', (response) => {
    if (response.url().includes('/posts/liked')) likedRequests.push(new URL(response.url()).search);
  });

  const countTiles = () => page.evaluate(() => document.querySelectorAll('li[data-post-id]').length);
  const firstPage = await countTiles();
  check('liked: first page is one page, not the whole collection', firstPage > 0 && firstPage <= 20, `${firstPage} tiles`);

  // Scroll the profile's own scroller to the bottom repeatedly, the way a
  // reader does, and let the sentinel do the paging.
  let tiles = firstPage;
  let stable = 0;
  for (let step = 0; step < 30 && stable < 3; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const scroller = Array.from(document.querySelectorAll('div')).find((element) => element.scrollHeight > element.clientHeight + 100 && element.className.includes('overflow-auto'));
      (scroller || document.scrollingElement).scrollTop = (scroller || document.scrollingElement).scrollHeight;
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1200);
    // eslint-disable-next-line no-await-in-loop
    const next = await countTiles();
    stable = next === tiles ? stable + 1 : 0;
    tiles = next;
  }

  const distinct = await page.evaluate(() => new Set(
    Array.from(document.querySelectorAll('li[data-post-id]')).map((element) => element.getAttribute('data-post-id'))
  ).size);
  check('liked: the grid reaches every liked post', tiles === 67, `${tiles} tiles (expected 67)`);
  check('liked: no post appears twice', distinct === tiles, `${distinct} distinct of ${tiles}`);
  check(
    'liked: reached by paging, not by one oversized request',
    likedRequests.length > 0 && likedRequests.every((search) => /limit=20(&|$)/.test(search)),
    likedRequests.join(' ') || 'no /posts/liked request observed after first paint'
  );
  const endState = await page.evaluate(() => document.body.innerText.includes('No more for now'));
  check('liked: the terminal message appears only at the end', endState);
  await page.screenshot({ path: path.join(SHOT_DIR, 'responsive-440-7-profile-liked-paged.png') });

  check('no console errors across the pass', consoleErrors.length === 0, consoleErrors.slice(0, 4).join(' | '));
  check('no failed network requests across the pass', failedRequests.length === 0, failedRequests.slice(0, 4).join(' | '));

  await browser.close();
  process.exit(summarise('responsive shell'));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
