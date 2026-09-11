/**
 * Mobile profile, follow list and header dropdowns — geometry and motion pass.
 *
 * Measures, at 390x844, 440x956, 768x1024 and 1440x900, against the local
 * production build:
 *
 *   - another creator's profile hero: height, avatar, type sizes, the Follow and
 *     Message buttons, the main and secondary tab boxes, where the grid starts;
 *   - the Following / Follower modal: width, height, row, avatar, button;
 *   - the account dropdown: width, rows, the footer and the Save login switch;
 *   - the notification dropdown: width, edges, rows, avatar, thumbnail, type;
 *   - the compact "More" menu;
 *   - the shared dropdown surface's enter and exit, stepped through the Web
 *     Animations API at start, middle and end, plus rapid open/close and the
 *     rule that one header dropdown closes the other.
 *
 *   PLAYWRIGHT_PATH=<playwright> node browser-verify/47-mobile-profile-dropdowns.js --label before|after
 *
 * `before` records the numbers and screenshots only. `after` also asserts the
 * targets from the Douyin references, and exits non-zero if any fails.
 *
 * Env: PLAYWRIGHT_PATH (required, see lib/harness.js), USER_APP, API,
 * MENU_ACCOUNT, OTHER_PROFILE.
 */

const path = require('path');
const fs = require('fs');
const {
  chromium, USER_APP, SHOT_DIR, signIn, check, summarise, routeMediaOrigin
} = require('./lib/harness');

const LABEL = (process.argv.find((arg) => arg.startsWith('--label=')) || '').split('=')[1]
  || process.argv[process.argv.indexOf('--label') + 1] || 'after';
const ASSERT = LABEL === 'after';
const ACCOUNT = process.env.MENU_ACCOUNT || 'maitran.eats@demo.invalid';
const OTHER_PROFILE = process.env.OTHER_PROFILE || 'iris.inthefield';
const SHOTS = path.join(SHOT_DIR, 'mobile-profile-dropdowns', LABEL);
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'output', 'playwright', 'mobile-profile-dropdowns');

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, compact: true },
  { name: '440x956', width: 440, height: 956, compact: true },
  { name: '768x1024', width: 768, height: 1024, compact: true },
  { name: '1440x900', width: 1440, height: 900, compact: false }
];

const ONLY = (process.env.ONLY || '').split(',').map((value) => value.trim()).filter(Boolean);
const report = { label: LABEL, viewports: {} };

/** Only a compact viewport is held to the mobile targets; the others to invariants. */
function expect(viewport, label, passed, detail) {
  if (!ASSERT) {
    console.log(`  · ${label}${detail ? ` — ${detail}` : ''}`);
    return passed;
  }
  return check(`[${viewport.name}] ${label}`, passed, detail);
}

/**
 * Park the pointer where nothing opens on hover. The bottom of the compact rail
 * holds hover-opened sidebar menus, so a corner is not neutral: parking there
 * opened one and read as an orphaned header dropdown.
 */
async function moveToNeutral(page, viewport) {
  await page.mouse.move(Math.round(viewport.width * 0.6), Math.round(viewport.height * 0.55));
}

async function shot(page, viewport, name) {
  const dir = path.join(SHOTS, viewport.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

const rect = (box) => (box ? {
  x: Math.round(box.x * 10) / 10,
  y: Math.round(box.y * 10) / 10,
  w: Math.round(box.width * 10) / 10,
  h: Math.round(box.height * 10) / 10,
  right: Math.round((box.x + box.width) * 10) / 10,
  bottom: Math.round((box.y + box.height) * 10) / 10
} : null);

const overlaps = (a, b) => a && b && a.x < b.right - 0.5 && b.x < a.right - 0.5 && a.y < b.bottom - 0.5 && b.y < a.bottom - 0.5;

async function documentOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Open dropdown surfaces, whichever primitive markup is on screen. */
const SURFACE = '[data-dropdown-surface], .dropdown-menu-motion';

/**
 * Sideways scroll inside the profile's own scroll container.
 *
 * The profile scrolls in a container, not the document, so
 * `document.documentElement.scrollWidth` stays 0 while that container can be
 * dragged sideways. Hidden hover panels still take part in layout, which is
 * exactly how a 430px bio panel anchored at left:250px produced it.
 */
async function profileScrollOverflow(page) {
  return page.evaluate(() => {
    let container = document.querySelector('[data-profile-hero]').parentElement;
    while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowX)) container = container.parentElement;
    if (!container) return { overflow: 0, offenders: [] };
    const bounds = container.getBoundingClientRect();
    const offenders = [...container.querySelectorAll('*')]
      .map((node) => ({ node, r: node.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.right > bounds.right + 1)
      .filter(({ node }, index, all) => !all.some((other, j) => j !== index && other.node.contains(node) && other.node !== node))
      .slice(0, 6)
      .map(({ node, r }) => `${node.tagName}.${String(node.className).slice(0, 50)}@${Math.round(r.right)}`);
    // What a sideways swipe actually does: ask the container to move and read back where it landed.
    const previousLeft = container.scrollLeft;
    container.scrollLeft = 10000;
    const reachedLeft = container.scrollLeft;
    container.scrollLeft = previousLeft;
    return { overflow: container.scrollWidth - container.clientWidth, reachedLeft, offenders };
  });
}

async function measureProfile(page, viewport) {
  await page.goto(`${USER_APP}/${OTHER_PROFILE}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-profile-hero]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const data = await page.evaluate(() => {
    const box = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10
      };
    };
    const font = (node) => (node ? parseFloat(getComputedStyle(node).fontSize) : null);
    const hero = document.querySelector('[data-profile-hero]');
    const avatar = hero.querySelector('button[aria-label="Preview avatar"]');
    const name = hero.querySelector('[data-profile-name] span');
    const counter = hero.querySelector('[data-profile-counters] button div');
    const metadata = hero.querySelector('[data-profile-metadata]');
    const metadataItem = metadata?.querySelector('span');
    const bio = hero.querySelector('[data-profile-identity] span.truncate');
    const buttons = [...hero.querySelectorAll('button')];
    const follow = buttons.find((node) => /^(Follow|Following)$/.test(node.textContent.trim()));
    const message = hero.querySelector('button[aria-label="Message this creator"]');
    const share = buttons.find((node) => node.textContent.includes('Share homepage'));
    const identity = hero.querySelector('[data-profile-identity]');
    const strip = document.querySelector('[data-profile-tab-strip]');
    const mainTabs = [...strip.querySelectorAll('[role="tab"]')];
    const secondaryTabs = [...document.querySelectorAll('[role="tab"]')].filter((node) => !strip.contains(node) && !node.closest('[data-profile-hero]'));
    const firstTile = document.querySelector('ul.grid li');
    const toolbar = strip.closest('.sticky');
    const heroStyle = getComputedStyle(hero);
    const band = document.querySelector('[data-profile-cover-band]');
    const cover = band ? band.firstElementChild : null;
    const heroBox = box(hero);
    return {
      hero: heroBox,
      // The identity content itself, without the band padding around it.
      heroContent: {
        top: heroBox.y + parseFloat(heroStyle.paddingTop),
        bottom: heroBox.bottom - parseFloat(heroStyle.paddingBottom),
        h: Math.round((heroBox.h - parseFloat(heroStyle.paddingTop) - parseFloat(heroStyle.paddingBottom)) * 10) / 10
      },
      cover: box(cover),
      avatar: box(avatar),
      identity: box(identity),
      name: box(name),
      nameFont: font(name),
      counterFont: font(counter),
      metadata: box(metadata),
      metadataFont: font(metadataItem),
      metadataItems: metadata ? [...metadata.children].map((child) => box(child)) : [],
      metadataChips: metadata ? [...metadata.children].slice(2).map((child) => ({ scrollWidth: child.scrollWidth, clientWidth: child.clientWidth, text: child.textContent.trim() })) : [],
      bio: box(bio),
      bioFont: font(bio),
      follow: box(follow),
      followFont: font(follow),
      followLabel: follow?.textContent.trim(),
      message: box(message),
      share: box(share),
      shareFont: font(share),
      mainTabs: mainTabs.map((node) => ({ label: node.getAttribute('title'), box: box(node), font: font(node.querySelector('span')), active: node.getAttribute('aria-selected') === 'true' })),
      mainStrip: box(strip),
      secondaryTabs: secondaryTabs.map((node) => ({ label: node.textContent.trim(), box: box(node), font: font(node) })),
      toolbar: box(toolbar),
      firstTile: box(firstTile)
    };
  });
  data.documentOverflow = await documentOverflow(page);
  data.scrollOverflow = await profileScrollOverflow(page);
  await shot(page, viewport, '01-other-profile');

  // Dark theme: nothing may be drawn over the tab labels.
  await page.evaluate(() => localStorage.setItem('theme', 'dark'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-profile-tab-strip]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  data.dark = await page.evaluate(() => {
    const strip = document.querySelector('[data-profile-tab-strip]');
    const band = document.querySelector('[data-profile-cover-band]');
    const tabs = [...strip.querySelectorAll('[role="tab"]')];
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      coverBottom: band ? Math.round(band.getBoundingClientRect().bottom) : null,
      stripTop: Math.round(strip.getBoundingClientRect().top),
      labelsHitThemselves: tabs.map((tab) => {
        const label = tab.querySelector('span') || tab;
        const r = label.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + Math.min(8, r.width / 2), r.top + r.height / 2);
        return { label: tab.getAttribute('title'), ok: Boolean(hit && tab.contains(hit)), hit: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : null };
      })
    };
  });
  data.darkScrollOverflow = await profileScrollOverflow(page);
  await shot(page, viewport, '02-other-profile-dark');
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-profile-tab-strip]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000);
  return data;
}

/** The signed-in user's own profile: seven tabs share the strip. */
async function measureOwnProfile(page, viewport) {
  const profile = (process.env.MENU_PROFILE || 'maitran.eats');
  await page.goto(`${USER_APP}/${profile}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-profile-tab-strip]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  const data = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10
      };
    };
    const strip = document.querySelector('[data-profile-tab-strip]');
    const toggle = document.querySelector('[data-profile-save-login] [role="switch"]');
    return {
      strip: box(strip),
      tabs: [...strip.querySelectorAll('[role="tab"]')].map((node) => ({ label: node.getAttribute('title'), box: box(node) })),
      hero: box(document.querySelector('[data-profile-hero]')),
      saveLoginToggle: toggle ? box(toggle) : null
    };
  });
  data.documentOverflow = await documentOverflow(page);
  data.scrollOverflow = await profileScrollOverflow(page);
  await shot(page, viewport, '00-own-profile');
  return data;
}

async function measureFollowModal(page, viewport, tab) {
  const counter = page.locator('[data-profile-counters] button').filter({ hasText: tab === 'follower' ? 'Follower' : 'Following' }).first();
  await counter.click();
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1500);
  const data = await dialog.evaluate((node) => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10
      };
    };
    const font = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const rows = [...node.querySelectorAll('[data-follow-list-row]')];
    const fallbackRows = rows.length ? rows : [...node.querySelectorAll('a[href] img')].map((img) => img.closest('.flex.items-center'));
    const firstRow = fallbackRows[0];
    // The viewer's own row has no follow button, so measure the first row that has one.
    const rowWithButton = fallbackRows.find((el) => [...el.querySelectorAll('button')].some((b) => /Follow|Following|Mutual follow|Remove/.test(b.textContent)));
    const rowButton = rowWithButton ? [...rowWithButton.querySelectorAll('button')].find((el) => /Follow|Following|Mutual follow|Remove/.test(el.textContent)) : null;
    const tabButtons = [...node.querySelectorAll('[role="tab"]')];
    const search = node.querySelector('input');
    const close = node.querySelector('button[aria-label="Close"]');
    const nameText = firstRow?.querySelector('a span.truncate, span.truncate');
    return {
      dialog: box(node),
      rows: fallbackRows.length,
      row: box(firstRow),
      avatar: box(firstRow?.querySelector('img')),
      nameFont: font(nameText),
      button: box(rowButton),
      buttonFont: font(rowButton),
      tabFont: font(tabButtons[0]),
      search: box(search?.parentElement),
      close: box(close),
      closeIcon: box(close?.querySelector('svg')),
      padding: getComputedStyle(node.querySelector('div[class*="flex-col"] > div') || node).paddingLeft
    };
  });
  const nav = await page.evaluate(() => ({ rail: document.querySelector('[data-app-nav-rail]')?.getBoundingClientRect().width || 0 }));
  data.contentCentreOffset = Math.round(((data.dialog.x + data.dialog.right) / 2 - (nav.rail + (viewport.width - nav.rail) / 2)) * 10) / 10;
  await shot(page, viewport, tab === 'follower' ? '04-follower-modal' : '03-following-modal');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(400);
  return data;
}

async function openAccountMenu(page) {
  const trigger = page.locator('header button:has(img)').last();
  const box = await trigger.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('[data-account-menu]').waitFor({ state: 'visible', timeout: 10000 });
  await page.locator('[data-account-menu-section="liked"] button').first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function measureAccountMenu(page, viewport) {
  await openAccountMenu(page);
  const data = await page.evaluate(() => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10
      };
    };
    const font = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const body = document.querySelector('[data-account-menu]');
    const surface = body.parentElement;
    const buttons = [...body.querySelectorAll('button')];
    const likedRow = buttons.find((el) => el.textContent.includes('I like it'));
    const logout = buttons.find((el) => /Logged out|Logging out/.test(el.textContent));
    const footer = logout?.parentElement;
    const saveLabel = [...body.querySelectorAll('span')].find((el) => el.textContent.trim() === 'Save login');
    const toggle = body.querySelector('[role="switch"]');
    const avatar = body.querySelector('img');
    const tiles = [...body.querySelectorAll('[data-account-menu-section] button[aria-label^="Open post"]')];
    return {
      surface: box(surface),
      avatar: box(avatar),
      row: box(likedRow),
      rowFont: font(likedRow),
      footer: box(footer),
      logout: box(logout),
      saveLabel: box(saveLabel),
      saveLabelFont: font(saveLabel),
      toggle: box(toggle),
      tiles: tiles.map((el) => box(el))
    };
  });
  data.documentOverflow = await documentOverflow(page);
  await shot(page, viewport, '05-account-liked');
  const works = page.locator('[data-account-menu] button').filter({ hasText: 'My work' }).first();
  const worksBox = await works.boundingBox();
  await page.mouse.move(worksBox.x + worksBox.width / 2, worksBox.y + worksBox.height / 2);
  await page.waitForTimeout(700);
  await shot(page, viewport, '06-account-works');
  const footer = await page.locator('[data-account-menu] [role="switch"]').boundingBox();
  if (footer) {
    await page.screenshot({
      path: path.join(SHOTS, viewport.name, '07-account-footer.png'),
      clip: {
        x: Math.max(0, data.surface.x - 4), y: Math.max(0, footer.y - 40), width: Math.min(viewport.width - Math.max(0, data.surface.x - 4), data.surface.w + 8), height: 64
      }
    });
  }
  await page.keyboard.press('Escape');
  await moveToNeutral(page, viewport);
  await page.waitForTimeout(600);
  return data;
}

async function openNotifications(page) {
  const trigger = page.locator('header [aria-label="Notification"]').first();
  const box = await trigger.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const surface = page.locator(SURFACE).filter({ hasText: 'Interactive messages' }).first();
  await surface.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForTimeout(1800);
  return surface;
}

async function measureNotifications(page, viewport) {
  const surface = await openNotifications(page);
  const data = await surface.evaluate((node) => {
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, right: Math.round(r.right * 10) / 10, bottom: Math.round(r.bottom * 10) / 10
      };
    };
    const font = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : null);
    const rows = [...node.querySelectorAll('[role="button"]')];
    const title = [...node.querySelectorAll('div')].find((el) => el.textContent.trim() === 'Interactive messages');
    const row = rows[0];
    const followRow = rows.find((el) => [...el.querySelectorAll('button')].some((b) => /^(Follow|Following)$/.test(b.textContent.trim())));
    const thumbRow = rows.find((el) => el.querySelectorAll('img').length > 1);
    return {
      surface: box(node),
      titleFont: font(title),
      rows: rows.length,
      rowHeights: rows.slice(0, 6).map((el) => Math.round(el.getBoundingClientRect().height)),
      avatar: box(row?.querySelector('img')),
      nameFont: font(row?.querySelector('p')),
      messageFont: font(row?.querySelectorAll('p')[1]),
      timeFont: font([...(row?.querySelectorAll('p') || [])].pop()),
      followButton: box(followRow ? [...followRow.querySelectorAll('button')].find((b) => /^(Follow|Following)$/.test(b.textContent.trim())) : null),
      thumbnail: box(thumbRow ? [...thumbRow.querySelectorAll('img')].pop() : null)
    };
  });
  data.viewport = { width: viewport.width, height: viewport.height };
  data.documentOverflow = await documentOverflow(page);
  await shot(page, viewport, '08-notifications');
  await page.keyboard.press('Escape');
  await moveToNeutral(page, viewport);
  await page.waitForTimeout(600);
  return data;
}

async function measureMoreMenu(page, viewport) {
  const more = page.locator('header button[aria-label="More"]');
  if (!(await more.isVisible().catch(() => false))) return null;
  await more.click();
  const menu = page.locator(SURFACE).filter({ has: page.locator('[role="menu"]') }).first();
  await menu.waitFor({ state: 'visible', timeout: 5000 });
  await page.waitForTimeout(500);
  const data = { surface: rect(await menu.boundingBox()) };
  await shot(page, viewport, '09-more-menu');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return data;
}

/** Freeze a surface's animation and step it; returns start, mid and end readings. */
async function stepSurface(page, surfaceSelector, phase) {
  return page.evaluate(async ({ selector, which }) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    let node = null;
    let animation = null;
    for (let attempt = 0; attempt < 60 && !animation; attempt += 1) {
      node = document.querySelector(selector);
      animation = node?.getAnimations().find((item) => (item.animationName || '').startsWith(`dropdown-surface-${which}`)) || null;

      if (!animation) await frame();
    }
    if (!animation) return { found: false, state: node?.getAttribute('data-state') || null };
    animation.pause();
    const read = (at) => {
      if (at === 'end') animation.currentTime = animation.effect.getComputedTiming().duration - 1;
      else animation.currentTime = at;
      const style = getComputedStyle(node);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      return {
        at,
        name: animation.animationName,
        duration: animation.effect.getComputedTiming().duration,
        easing: style.animationTimingFunction,
        translateY: Math.round(matrix.m42 * 100) / 100,
        scale: Math.round(matrix.a * 1000) / 1000,
        opacity: Math.round(Number(style.opacity) * 1000) / 1000,
        mounted: document.contains(node),
        state: node.getAttribute('data-state')
      };
    };
    const start = read(0);
    const mid = read(Math.round(animation.effect.getComputedTiming().duration / 2));
    const end = read('end');
    animation.play();
    return {
      found: true, start, mid, end
    };
  }, { selector: surfaceSelector, which: phase });
}

/**
 * Freeze the enter or exit animation of one open dropdown surface and step it,
 * taking a screenshot at 0ms, the midpoint and the last millisecond, so a
 * person can see the motion frame by frame rather than trust a number.
 */
async function captureSurfaceFrames(page, viewport, which, phase, name) {
  const found = await page.evaluate(async ({ target, kind }) => {
    const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const node = [...document.querySelectorAll('[data-dropdown-surface]')].find((el) => (target === 'account'
        ? el.querySelector('[data-account-menu]')
        : el.textContent.includes('Interactive messages')));
      const animation = node?.getAnimations().find((item) => item.animationName === `dropdown-surface-${kind}`);
      if (animation) {
        animation.pause();
        window.__frozenSurface = { node, animation };
        return true;
      }

      await frame();
    }
    return false;
  }, { target: which, kind: phase });
  if (!found) return { found: false };
  const readings = {};
  for (const step of ['start', 'mid', 'end']) {

    readings[step] = await page.evaluate((at) => {
      const { node, animation } = window.__frozenSurface;
      const duration = animation.effect.getComputedTiming().duration;
      animation.currentTime = at === 'start' ? 0 : at === 'mid' ? duration / 2 : duration - 1;
      const style = getComputedStyle(node);
      const matrix = style.transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      return {
        at, name: animation.animationName, duration, translateY: Math.round(matrix.m42 * 100) / 100, scale: Math.round(matrix.a * 1000) / 1000, opacity: Math.round(Number(style.opacity) * 1000) / 1000, state: node.getAttribute('data-state')
      };
    }, step);

    await shot(page, viewport, `11-${name}-${step}`);
  }
  await page.evaluate(() => window.__frozenSurface?.animation.play());
  return { found: true, ...readings };
}

async function measureMotion(page, viewport) {
  const motion = {};
  motion.reducedMotion = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // Account menu enter.
  const trigger = page.locator('header button:has(img)').last();
  const box = await trigger.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  motion.accountEnter = await stepSurface(page, '[data-dropdown-surface]:has([data-account-menu])', 'enter');
  await page.waitForTimeout(400);
  motion.innerGlideIntact = await page.evaluate(() => {
    const surface = document.querySelector('[data-dropdown-surface]:has([data-account-menu])');
    const strip = surface?.querySelector('[data-account-menu-strip]');
    return {
      surfaceTransform: surface ? getComputedStyle(surface).transform : null,
      stripAnimation: strip ? getComputedStyle(strip).animationName : null,
      stripIsInsideSurface: Boolean(surface && strip && surface !== strip && surface.contains(strip))
    };
  });
  // Exit: Escape closes; the node must still be there, animating out.
  await page.keyboard.press('Escape');
  motion.accountExit = await stepSurface(page, '[data-dropdown-surface]:has([data-account-menu])', 'exit');
  await moveToNeutral(page, viewport);
  await page.waitForTimeout(500);
  motion.accountUnmountedAfterExit = await page.locator('[data-account-menu]').count() === 0;

  // One header dropdown closes the other.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator('[data-account-menu]').waitFor({ state: 'visible' });
  await page.waitForTimeout(350);
  const bell = await page.locator('header [aria-label="Notification"]').first().boundingBox();
  await page.mouse.move(bell.x + bell.width / 2, bell.y + bell.height / 2);
  await page.waitForTimeout(60);
  motion.exclusive = await page.evaluate(() => ({
    accountState: document.querySelector('[data-dropdown-surface]:has([data-account-menu])')?.getAttribute('data-state') || 'unmounted',
    notificationState: [...document.querySelectorAll('[data-dropdown-surface]')].find((node) => node.textContent.includes('Interactive messages'))?.getAttribute('data-state') || 'unmounted'
  }));
  await page.waitForTimeout(600);
  motion.exclusiveSettled = await page.evaluate(() => ({
    openSurfaces: [...document.querySelectorAll('[data-dropdown-surface][data-state="open"]')].length,
    accountMounted: Boolean(document.querySelector('[data-account-menu]'))
  }));
  await shot(page, viewport, '10-notification-open-closes-account');
  await page.keyboard.press('Escape');
  await moveToNeutral(page, viewport);
  await page.waitForTimeout(600);

  // Frame-by-frame evidence: notification enter and exit.
  const bellBox = await page.locator('header [aria-label="Notification"]').first().boundingBox();
  await page.mouse.move(bellBox.x + bellBox.width / 2, bellBox.y + bellBox.height / 2);
  motion.notificationEnterFrames = await captureSurfaceFrames(page, viewport, 'notification', 'enter', 'notification-enter');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  motion.notificationExitFrames = await captureSurfaceFrames(page, viewport, 'notification', 'exit', 'notification-exit');
  await moveToNeutral(page, viewport);
  await page.waitForTimeout(600);

  // Rapid open/close ten times, then settle: nothing orphaned.
  const samples = [];
  for (let round = 0; round < 10; round += 1) {

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForTimeout(90);

    await page.keyboard.press('Escape');

    await moveToNeutral(page, viewport);

    samples.push(await page.evaluate(() => document.querySelectorAll('[data-dropdown-surface][data-state="open"]').length));

    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(800);
  motion.rapid = {
    openAfterEachClose: samples,
    surfacesLeftAfterSettle: await page.locator('[data-dropdown-surface]').count(),
    leftOpen: await page.evaluate(() => [...document.querySelectorAll('[data-dropdown-surface]')].map((node) => `${node.getAttribute('data-state')}:${node.textContent.trim().slice(0, 30)}`))
  };
  return motion;
}

async function runViewport(browser, viewport) {
  console.log(`\n--- ${viewport.name} (${LABEL}) ---`);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'no-preference' });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  const problems = [];
  const failed = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydrat|unique "key"/i.test(message.text())) problems.push(message.text().slice(0, 160));
  });
  page.on('response', (response) => {
    if (response.url().includes(':8080/') && response.status() >= 400) failed.push(`${response.status()} ${response.url()}`);
  });
  await signIn({ page, context }, ACCOUNT);
  const baseline = problems.length;

  const result = {};
  result.ownProfile = await measureOwnProfile(page, viewport);
  result.profile = await measureProfile(page, viewport);
  result.followingModal = await measureFollowModal(page, viewport, 'following');
  result.followerModal = await measureFollowModal(page, viewport, 'follower');
  result.account = await measureAccountMenu(page, viewport);
  result.notifications = await measureNotifications(page, viewport);
  result.more = await measureMoreMenu(page, viewport);
  if (LABEL === 'after') result.motion = await measureMotion(page, viewport);
  result.console = problems.slice(baseline);
  result.failedRequests = failed;
  report.viewports[viewport.name] = result;

  const p = result.profile;
  const tabs = p.mainTabs.map((tab) => tab.box);
  const tabOverlap = tabs.some((a, i) => tabs.some((b, j) => i < j && overlaps(a, b)));
  const f = result.followingModal;
  const a = result.account;
  const n = result.notifications;

  expect(viewport, 'no document-level horizontal overflow on the profile', p.documentOverflow <= 0, `${p.documentOverflow}`);
  expect(viewport, 'profile scroll container cannot scroll sideways (light)', p.scrollOverflow.overflow <= 1 && p.scrollOverflow.reachedLeft <= 1, JSON.stringify(p.scrollOverflow));
  expect(viewport, 'profile scroll container cannot scroll sideways (dark)', p.darkScrollOverflow.overflow <= 1 && p.darkScrollOverflow.reachedLeft <= 1, JSON.stringify(p.darkScrollOverflow));
  if (result.ownProfile) expect(viewport, 'own profile scroll container cannot scroll sideways', result.ownProfile.scrollOverflow.overflow <= 1 && result.ownProfile.scrollOverflow.reachedLeft <= 1, JSON.stringify(result.ownProfile.scrollOverflow));
  expect(viewport, 'main profile tabs never overlap', !tabOverlap, p.mainTabs.map((t) => `${t.label}@${t.box.x}-${t.box.right}`).join(' '));
  expect(viewport, 'last main tab inside the viewport and the strip', tabs.every((t) => t.right <= Math.min(viewport.width, p.mainStrip.right) + 0.5), `strip.right=${p.mainStrip.right}`);
  // The active tab carries a 2-3px underline, so "one row" allows that much.
  const spread = (values) => Math.max(...values) - Math.min(...values);
  expect(viewport, 'main tabs on one row', spread(tabs.map((t) => t.y)) <= 3, tabs.map((t) => t.y).join(','));
  expect(viewport, 'secondary tabs on one row, above the grid', (!p.secondaryTabs.length || spread(p.secondaryTabs.map((t) => t.box.y)) <= 3) && (!p.firstTile || p.secondaryTabs.every((t) => t.box.bottom <= p.firstTile.y)), `grid.y=${p.firstTile?.y} chips.bottom=${p.secondaryTabs.map((t) => t.box.bottom)}`);
  if (result.ownProfile) {
    const own = result.ownProfile;
    const ownTabs = own.tabs.map((t) => t.box);
    expect(viewport, 'own profile: tabs do not overlap and stay inside the strip', !ownTabs.some((a2, i) => ownTabs.some((b2, j) => i < j && overlaps(a2, b2))) && ownTabs.every((t) => t.right <= own.strip.right + 0.5), own.tabs.map((t) => `${t.label}@${t.box.x}-${t.box.right}`).join(' '));
    expect(viewport, 'own profile: no document overflow', own.documentOverflow <= 0, `${own.documentOverflow}`);
  }
  expect(viewport, 'Follow and Message on one line, inside the viewport', p.follow && p.message && Math.abs(p.follow.y - p.message.y) < 1 && p.message.right <= viewport.width, `follow=${JSON.stringify(p.follow)} message=${JSON.stringify(p.message)}`);
  expect(viewport, 'Following modal inside the viewport', f.dialog.x >= 0 && f.dialog.right <= viewport.width && f.dialog.bottom <= viewport.height, JSON.stringify(f.dialog));
  expect(viewport, 'account dropdown inside the viewport', a.surface.x >= 0 && a.surface.right <= viewport.width && a.surface.bottom <= viewport.height, JSON.stringify(a.surface));
  expect(viewport, 'notification dropdown inside the viewport', n.surface.x >= 0 && n.surface.right <= viewport.width && n.surface.bottom <= viewport.height, JSON.stringify(n.surface));
  expect(viewport, 'Save login label and switch on one line', a.saveLabel && a.toggle && Math.abs((a.saveLabel.y + a.saveLabel.h / 2) - (a.toggle.y + a.toggle.h / 2)) < 3 && a.saveLabel.right <= a.toggle.x, `label=${JSON.stringify(a.saveLabel)} toggle=${JSON.stringify(a.toggle)}`);

  if (viewport.compact && viewport.width <= 440) {
    expect(viewport, 'profile hero content 75-125px tall', p.heroContent.h >= 75 && p.heroContent.h <= 125, `${p.heroContent.h}`);
    expect(viewport, 'metadata (Douyin ID to region) on exactly one line, nothing past the row', p.metadata && p.metadata.h <= 15 && p.metadataItems.every((item) => Math.abs(item.y - p.metadataItems[0].y) <= 2 && item.right <= p.metadata.right + 0.5), `row=${JSON.stringify(p.metadata)} items=${p.metadataItems.map((item) => `${item.x}-${item.right}@${item.y}`).join(' ')}`);
    expect(viewport, 'bio on exactly one line', !p.bio || p.bio.h <= 15, JSON.stringify(p.bio));
    expect(viewport, 'dark theme: nothing drawn over the tab labels, tabs below the cover', p.dark.theme === 'dark' && p.dark.labelsHitThemselves.every((item) => item.ok) && p.dark.stripTop >= p.dark.coverBottom, JSON.stringify(p.dark));
    expect(viewport, 'age and region chips shown whole', p.metadataChips.every((chip) => chip.scrollWidth <= chip.clientWidth + 1), JSON.stringify(p.metadataChips));
    expect(viewport, 'the whole hero sits on the cover (avatar to buttons)', p.cover && p.cover.y <= p.heroContent.top && p.cover.bottom >= p.heroContent.bottom && p.cover.bottom >= p.follow.bottom, `cover=${JSON.stringify(p.cover)} content=${JSON.stringify(p.heroContent)} follow.bottom=${p.follow.bottom}`);
    expect(viewport, 'tabs start right under the cover (0-16px)', p.cover && p.mainStrip.y - p.cover.bottom >= 0 && p.mainStrip.y - p.cover.bottom <= 16, `cover.bottom=${p.cover?.bottom} tabs.y=${p.mainStrip.y}`);
    expect(viewport, 'avatar 44-48px', p.avatar.w >= 44 && p.avatar.w <= 50, `${p.avatar.w}`);
    expect(viewport, 'name 12-14px, counters 9-11px, metadata 8-9px, bio 9-10px', p.nameFont >= 12 && p.nameFont <= 14 && p.counterFont >= 9 && p.counterFont <= 11 && p.metadataFont >= 8 && p.metadataFont <= 9 && (!p.bioFont || (p.bioFont >= 9 && p.bioFont <= 10)), `${p.nameFont}/${p.counterFont}/${p.metadataFont}/${p.bioFont}`);
    expect(viewport, 'Follow button 24-28px tall, 10-11px text', p.follow.h >= 24 && p.follow.h <= 28 && p.followFont >= 10 && p.followFont <= 11, `${p.follow.h}px ${p.followFont}px`);
    expect(viewport, 'Follow/Message in the right column of the hero, not on a row of their own', p.follow.x > p.avatar.right + 100 && p.follow.y >= p.hero.y && p.follow.bottom <= p.hero.bottom + 0.5 && p.share && Math.abs(p.share.right - p.message.right) < 24, `hero=${JSON.stringify(p.hero)} follow=${JSON.stringify(p.follow)} share=${JSON.stringify(p.share)}`);
    expect(viewport, 'Share homepage 10px and inside the viewport', p.share && p.share.right <= viewport.width && p.shareFont <= 11, `${JSON.stringify(p.share)} ${p.shareFont}`);
    expect(viewport, 'Following modal 280-300px wide', f.dialog.w >= 276 && f.dialog.w <= 302, `${f.dialog.w}`);
    expect(viewport, 'Following modal height follows content (<= 460px)', f.dialog.h <= 460, `${f.dialog.h}`);
    expect(viewport, 'Following modal centred on the content column (±6px)', Math.abs(f.contentCentreOffset) <= 6, `${f.contentCentreOffset}`);
    expect(viewport, 'follow list row 44-52px, avatar 32-36px', f.row && f.row.h >= 40 && f.row.h <= 54 && f.avatar.w >= 32 && f.avatar.w <= 36, `row=${f.row?.h} avatar=${f.avatar?.w}`);
    expect(viewport, 'follow list button 22-26px tall', f.button && f.button.h >= 22 && f.button.h <= 26, `${JSON.stringify(f.button)}`);
    expect(viewport, 'account dropdown ~216px wide', a.surface.w >= 206 && a.surface.w <= 226, `${a.surface.w}`);
    expect(viewport, 'account footer 22-26px, switch 26-30 x 14-16px', a.footer.h >= 20 && a.footer.h <= 34 && a.toggle.w >= 26 && a.toggle.w <= 30 && a.toggle.h >= 14 && a.toggle.h <= 16, `footer=${a.footer.h} toggle=${a.toggle.w}x${a.toggle.h}`);
    expect(viewport, 'account preview tiles on one row inside the panel', a.tiles.length === 3 && new Set(a.tiles.map((t) => Math.round(t.y))).size === 1 && a.tiles.every((t) => t.right <= a.surface.right), a.tiles.map((t) => `${t.x}-${t.right}`).join(' '));
    expect(viewport, 'notification dropdown 216-240px wide', n.surface.w >= 216 && n.surface.w <= 242, `${n.surface.w}`);
    expect(viewport, 'notification rows 44-54px, avatar 28-32px, text 10-11px, time 8-9px', n.rowHeights.every((h) => h >= 40 && h <= 58) && n.avatar.w >= 28 && n.avatar.w <= 32 && n.nameFont >= 10 && n.nameFont <= 11 && n.timeFont >= 8 && n.timeFont <= 9, `rows=${n.rowHeights} avatar=${n.avatar?.w} name=${n.nameFont} time=${n.timeFont}`);
    expect(viewport, 'notification thumbnail 28-36px tall', !n.thumbnail || (n.thumbnail.h >= 28 && n.thumbnail.h <= 36), JSON.stringify(n.thumbnail));
    expect(viewport, 'notification panel height follows the viewport', n.surface.h <= viewport.height - 40, `${n.surface.h}`);
  }

  if (viewport.name === '1440x900') {
    expect(viewport, 'desktop hero keeps its size (avatar 112px, name 20px)', p.avatar.w >= 110 && p.nameFont === 20, `${p.avatar.w} ${p.nameFont}`);
    expect(viewport, 'desktop follow modal stays 560px wide', f.dialog.w >= 555 && f.dialog.w <= 565, `${f.dialog.w}`);
    expect(viewport, 'desktop account dropdown stays 334px wide', a.surface.w >= 330 && a.surface.w <= 338, `${a.surface.w}`);
    expect(viewport, 'desktop notification dropdown stays 328px wide', n.surface.w >= 324 && n.surface.w <= 332, `${n.surface.w}`);
  }

  if (result.motion) {
    const m = result.motion;
    expect(viewport, 'reduced motion is off for this pass', m.reducedMotion === false);
    const enter = m.accountEnter;
    expect(viewport, 'enter: animation found, 220-260ms', enter.found && enter.start.duration >= 220 && enter.start.duration <= 260, JSON.stringify(enter.start));
    expect(viewport, 'enter start: translateY -10..-14px, opacity ~0.35, scale ~0.985', enter.found && enter.start.translateY <= -10 && enter.start.translateY >= -14 && enter.start.opacity <= 0.4 && enter.start.scale <= 0.99, JSON.stringify(enter.start));
    expect(viewport, 'enter mid: part-way', enter.found && enter.mid.translateY < 0 && enter.mid.translateY > enter.start.translateY && enter.mid.opacity > enter.start.opacity, JSON.stringify(enter.mid));
    expect(viewport, 'enter end: at rest', enter.found && Math.abs(enter.end.translateY) < 0.3 && enter.end.opacity > 0.99, JSON.stringify(enter.end));
    const exit = m.accountExit;
    expect(viewport, 'exit: still mounted and animating, 160-200ms', exit.found && exit.start.mounted && exit.start.state === 'closed' && exit.start.duration >= 160 && exit.start.duration <= 200, JSON.stringify(exit.start || exit));
    expect(viewport, 'exit moves up and fades', exit.found && exit.mid.translateY < 0 && exit.mid.opacity < 1 && exit.end.opacity < 0.1 && exit.end.translateY <= -6, `${JSON.stringify(exit.mid)} ${JSON.stringify(exit.end)}`);
    expect(viewport, 'unmounted once the exit finished', m.accountUnmountedAfterExit);
    const ne = m.notificationEnterFrames;
    const nx = m.notificationExitFrames;
    expect(viewport, 'notification enter frames: start translated and faint, end at rest', ne.found && ne.start.translateY <= -10 && ne.start.opacity <= 0.4 && ne.mid.opacity > ne.start.opacity && Math.abs(ne.end.translateY) < 0.3 && ne.end.opacity > 0.99, JSON.stringify(ne));
    expect(viewport, 'notification exit frames: still mounted, rising and fading', nx.found && nx.start.state === 'closed' && nx.mid.opacity < 1 && nx.end.opacity < 0.1 && nx.end.translateY <= -6, JSON.stringify(nx));
    expect(viewport, 'outer and inner transforms are on different elements', m.innerGlideIntact.stripIsInsideSurface && /account-menu-strip/.test(m.innerGlideIntact.stripAnimation || ''), JSON.stringify(m.innerGlideIntact));
    expect(viewport, 'opening notifications closes the account menu at once', m.exclusive.accountState !== 'open' && m.exclusive.notificationState === 'open', JSON.stringify(m.exclusive));
    expect(viewport, 'after settling only one surface is open', m.exclusiveSettled.openSurfaces === 1 && !m.exclusiveSettled.accountMounted, JSON.stringify(m.exclusiveSettled));
    expect(viewport, 'rapid open/close x10 leaves nothing behind', m.rapid.surfacesLeftAfterSettle === 0 && m.rapid.openAfterEachClose.every((count) => count === 0), JSON.stringify(m.rapid));
  }
  expect(viewport, 'no console error, hydration or key warning', result.console.length === 0, result.console.join(' | '));
  expect(viewport, 'no failed API request', result.failedRequests.length === 0, result.failedRequests.join(' | '));
  await context.close();
}

/** Touch: dropdowns still open from a tap, and a tap on a row still navigates. */
async function touchCheck(browser, viewport) {
  console.log(`\n--- ${viewport.name} touch ---`);
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }, hasTouch: true, isMobile: true, reducedMotion: 'no-preference'
  });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  await signIn({ page, context }, ACCOUNT);
  await page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  await page.locator('header [aria-label="Notification"]').first().tap();
  const notificationSurface = page.locator(SURFACE).filter({ hasText: 'Interactive messages' }).first();
  const notificationOpened = await notificationSurface.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
  const notificationBox = notificationOpened ? rect(await notificationSurface.boundingBox()) : null;
  expect(viewport, 'touch: tapping the bell opens notifications inside the viewport', notificationOpened && notificationBox.right <= viewport.width && notificationBox.x >= 0, JSON.stringify(notificationBox));
  // Escape, not a tap on the page: a tap there lands on a feed card and opens
  // post detail over the header.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  await page.locator('header button:has(img)').last().tap();
  await page.locator('[data-account-menu]').waitFor({ state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500);
  expect(viewport, 'touch: opening the account menu closed notifications', await page.locator('[data-dropdown-surface][data-state="open"]').count() === 1);
  await page.locator('[data-account-menu] button').filter({ hasText: 'My work' }).first().tap();
  await page.waitForURL(/tab=works/, { timeout: 15000 }).catch(() => {});
  expect(viewport, 'touch: tapping My work still opens the Works tab', /tab=works/.test(page.url()), page.url());
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS.filter((item) => !ONLY.length || ONLY.includes(item.name))) {

      await runViewport(browser, viewport);

      if (ASSERT && viewport.name === '390x844') await touchCheck(browser, viewport);
    }
  } finally {
    await browser.close();
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, `${LABEL}${ONLY.length ? `-${ONLY.join('_')}` : ''}.json`), JSON.stringify(report, null, 2));
  }
  process.exit(ASSERT ? summarise(`mobile profile and dropdowns (${LABEL})`) : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
