/**
 * Profile hover panels and sideways scrolling — geometry and gesture pass.
 *
 * The profile scrolls inside its own container, and a hover panel that is
 * closed is still laid out (`invisible`, not `display: none`). Anything it
 * reaches past the container's right edge becomes sideways scroll. This pass
 * proves, per viewport and theme, for both profiles:
 *
 *   - closed and open: document and profile container `scrollWidth ===
 *     clientWidth`, `scrollLeft === 0`, and it stays 0 after Shift+wheel, a
 *     horizontal trackpad wheel and a direct `scrollLeft` assignment;
 *   - open: the panel is painted, entirely inside the viewport and the
 *     container's visible box, not clipped internally, and still under its
 *     trigger — and it stays open through the gestures;
 *   - which element reaches past the edge, by name, when anything does.
 *
 * Target panels: "More" on another creator's profile and the Save login help
 * on your own. "Share homepage" and the bio's "More" are measured alongside,
 * because on a phone the rule is that *no* panel may scroll the page.
 *
 *   PLAYWRIGHT_PATH=<playwright> node browser-verify/49-profile-panel-overflow.js --label before|after
 *
 * Env: PLAYWRIGHT_PATH (required), USER_APP, MENU_ACCOUNT, OTHER_PROFILE,
 * OWN_PROFILE, ONLY (viewport names), MEDIA_ORIGIN.
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
const OWN_PROFILE = process.env.OWN_PROFILE || 'maitran.eats';
const SHOTS = path.join(SHOT_DIR, 'profile-panel-overflow', LABEL);
const ARTIFACTS = path.resolve(__dirname, '..', '..', 'output', 'playwright', 'profile-panel-overflow');

const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900, themes: ['light', 'dark'] },
  { name: '390x844', width: 390, height: 844, themes: ['light'] },
  { name: '440x956', width: 440, height: 956, themes: ['light'] },
  { name: '768x1024', width: 768, height: 1024, themes: ['light'] }
];
const ONLY = (process.env.ONLY || '').split(',').map((value) => value.trim()).filter(Boolean);
const report = { label: LABEL, viewports: {} };

function expect(label, passed, detail) {
  if (!ASSERT) {
    console.log(`  · ${passed ? 'ok ' : 'BAD'} ${label}${detail ? ` — ${detail}` : ''}`);
    return passed;
  }
  return check(label, passed, detail);
}

async function shot(page, viewport, name) {
  const dir = path.join(SHOTS, viewport.name);
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, `${name}.png`) });
}

/**
 * Tags each hover panel root in the hero with `data-verify-panel`, so the
 * gesture code and the measurement read the same element. Returns what it found.
 */
async function tagPanels(page) {
  return page.evaluate(() => {
    const hero = document.querySelector('[data-profile-hero]');
    const roots = [...hero.querySelectorAll('[class*="group/hover-reveal"]')];
    const found = {};
    roots.forEach((root) => {
      const text = root.textContent || '';
      let name = null;
      if (root.querySelector('button[aria-label="More actions"]')) name = 'more';
      else if (text.includes('Save login information')) name = 'save-login-help';
      else if (text.includes('Share homepage')) name = 'share';
      else if (root.querySelector('span.truncate')) name = 'bio';
      // A disabled HoverRevealPanel renders no panel at all (the bio does this when it fits).
      const hasPanel = root.querySelector(':scope > [data-hover-reveal-panel]') || root.querySelector(':scope > div.absolute');
      if (name && hasPanel) {
        root.setAttribute('data-verify-panel', name);
        found[name] = true;
      }
    });
    return found;
  });
}

async function measure(page, name) {
  return page.evaluate((panelName) => {
    const round = (value) => Math.round(value * 10) / 10;
    const rect = (node) => {
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return {
        left: round(r.left), top: round(r.top), right: round(r.right), bottom: round(r.bottom), width: round(r.width), height: round(r.height)
      };
    };
    const hero = document.querySelector('[data-profile-hero]');
    let container = hero.parentElement;
    while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowX)) container = container.parentElement;
    const doc = document.documentElement;
    const containerRect = container.getBoundingClientRect();
    const visibleRight = containerRect.left + container.clientWidth;

    const describe = (node) => {
      const cls = String(node.className || '').replace(/\s+/g, ' ').slice(0, 70);
      const owner = node.closest('[data-verify-panel]')?.getAttribute('data-verify-panel');
      return `${node.tagName.toLowerCase()}${owner ? `[panel=${owner}]` : ''}.${cls}`;
    };
    // Outermost elements whose layout box reaches past the container's visible right edge.
    const offenders = [...container.querySelectorAll('*')]
      .map((node) => ({ node, r: node.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.right > visibleRight + 0.5)
      .filter(({ node }, index, all) => !all.some((other, j) => j !== index && other.node !== node && other.node.contains(node)))
      .slice(0, 6)
      .map(({ node, r }) => ({ element: describe(node), right: round(r.right), past: round(r.right - visibleRight) }));

    const root = panelName ? document.querySelector(`[data-verify-panel="${panelName}"]`) : null;
    const trigger = root ? root.firstElementChild : null;
    const panel = root ? (root.querySelector(':scope > [data-hover-reveal-panel]') || root.querySelector(':scope > div.absolute')) : null;
    const inner = panel ? panel.firstElementChild : null;
    const style = panel ? getComputedStyle(panel) : null;
    return {
      document: { clientWidth: doc.clientWidth, scrollWidth: doc.scrollWidth, scrollLeft: document.scrollingElement.scrollLeft },
      container: {
        clientWidth: container.clientWidth, scrollWidth: container.scrollWidth, scrollLeft: container.scrollLeft, visibleLeft: round(containerRect.left), visibleRight: round(visibleRight)
      },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      offenders,
      trigger: rect(trigger),
      panel: panel ? {
        ...rect(panel),
        visibility: style.visibility,
        opacity: Number(style.opacity),
        display: style.display,
        translate: style.translate,
        innerOverflowX: inner ? inner.scrollWidth - inner.clientWidth : null,
        innerOverflowY: inner ? inner.scrollHeight - inner.clientHeight : null
      } : null
    };
  }, name);
}

/** Every sideways gesture, each followed by a read of both scroll positions. */
async function tryToScrollSideways(page, pointer) {
  const read = () => page.evaluate(() => {
    let container = document.querySelector('[data-profile-hero]').parentElement;
    while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowX)) container = container.parentElement;
    return { container: container.scrollLeft, document: document.scrollingElement.scrollLeft };
  });
  const attempts = {};
  await page.mouse.move(pointer.x, pointer.y);
  await page.keyboard.down('Shift');
  await page.mouse.wheel(0, 600);
  await page.keyboard.up('Shift');
  await page.waitForTimeout(350);
  attempts.shiftWheel = await read();
  await page.mouse.wheel(600, 0);
  await page.waitForTimeout(350);
  attempts.trackpadDeltaX = await read();
  attempts.assigned = await page.evaluate(() => {
    let container = document.querySelector('[data-profile-hero]').parentElement;
    while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowX)) container = container.parentElement;
    container.scrollLeft = 10000;
    document.scrollingElement.scrollLeft = 10000;
    return { container: container.scrollLeft, document: document.scrollingElement.scrollLeft };
  });
  await page.waitForTimeout(100);
  attempts.afterAssign = await read();
  // Put things back for the next state, whatever the result was.
  await page.evaluate(() => {
    let container = document.querySelector('[data-profile-hero]').parentElement;
    while (container && !/(auto|scroll)/.test(getComputedStyle(container).overflowX)) container = container.parentElement;
    container.scrollLeft = 0;
    container.scrollTop = 0;
    document.scrollingElement.scrollLeft = 0;
  });
  return attempts;
}

function assertState(prefix, data, attempts, { open, panelName }) {
  expect(`${prefix} document scrollWidth === clientWidth`, data.document.scrollWidth === data.document.clientWidth, `${data.document.scrollWidth} vs ${data.document.clientWidth}`);
  expect(`${prefix} profile scrollWidth === clientWidth`, data.container.scrollWidth === data.container.clientWidth, `${data.container.scrollWidth} vs ${data.container.clientWidth}; offenders ${JSON.stringify(data.offenders)}`);
  expect(`${prefix} scrollLeft === 0`, data.container.scrollLeft === 0 && data.document.scrollLeft === 0);
  const stuck = Object.entries(attempts).filter(([, value]) => value.container !== 0 || value.document !== 0);
  expect(`${prefix} Shift+wheel, trackpad deltaX and scrollLeft assignment all stay at 0`, stuck.length === 0, stuck.length ? JSON.stringify(Object.fromEntries(stuck)) : '');
  if (!open) return;
  const { panel, trigger, viewport, container } = data;
  expect(`${prefix} ${panelName} panel is painted`, panel && panel.visibility === 'visible' && panel.opacity > 0.99, panel && `${panel.visibility} ${panel.opacity}`);
  expect(`${prefix} ${panelName} panel is inside the viewport`, panel && panel.left >= 0 && panel.right <= viewport.width && panel.top >= 0 && panel.bottom <= viewport.height, panel && JSON.stringify({ left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom }));
  expect(`${prefix} ${panelName} panel is inside the profile's visible box (not clipped by it)`, panel && panel.left >= container.visibleLeft - 0.5 && panel.right <= container.visibleRight + 0.5, panel && `${panel.left}..${panel.right} in ${container.visibleLeft}..${container.visibleRight}`);
  expect(`${prefix} ${panelName} panel content is not clipped`, panel && panel.innerOverflowX <= 1 && panel.innerOverflowY <= 1, panel && `${panel.innerOverflowX}/${panel.innerOverflowY}`);
  const triggerCentre = trigger.left + trigger.width / 2;
  expect(`${prefix} ${panelName} panel sits under its trigger`, panel && triggerCentre >= panel.left && triggerCentre <= panel.right && panel.top >= trigger.bottom - 1 && panel.top <= trigger.bottom + 20, panel && `trigger ${trigger.left}..${trigger.right} bottom ${trigger.bottom}; panel ${panel.left}..${panel.right} top ${panel.top}`);
}

/**
 * Reads the panel's opacity transition part-way through: whether one is running,
 * and the computed opacity at a fixed point in it. Paused so the value is not a
 * race against the frame clock.
 */
async function sampleTransition(page, rootSelector) {
  return page.evaluate((selector) => {
    const root = document.querySelector(selector);
    const panel = root.querySelector(':scope > [data-hover-reveal-panel]') || root.querySelector(':scope > div.absolute');
    const transition = panel.getAnimations().find((animation) => animation.transitionProperty === 'opacity');
    if (!transition) return { running: false, opacity: Number(getComputedStyle(panel).opacity), visibility: getComputedStyle(panel).visibility };
    const duration = transition.effect.getTiming().duration;
    transition.pause();
    transition.currentTime = duration / 2;
    const sample = { running: true, duration, opacity: Math.round(Number(getComputedStyle(panel).opacity) * 1000) / 1000, visibility: getComputedStyle(panel).visibility };
    transition.play();
    return sample;
  }, rootSelector);
}

async function runProfile(page, viewport, theme, profile, panelNames, prefixBase) {
  await page.goto(`${USER_APP}/${profile}`, { waitUntil: 'domcontentloaded' });
  await page.locator('[data-profile-hero]').waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);
  const found = await tagPanels(page);
  const neutral = { x: Math.round(viewport.width * 0.6), y: Math.round(viewport.height * 0.8) };
  const states = {};

  await page.mouse.move(neutral.x, neutral.y);
  await page.waitForTimeout(300);
  const closed = await measure(page, panelNames[0]);
  const closedAttempts = await tryToScrollSideways(page, neutral);
  states.closed = { ...closed, attempts: closedAttempts };
  console.log(`  ${prefixBase} closed ${JSON.stringify({ document: closed.document, container: closed.container, trigger: closed.trigger, panel: closed.panel, offenders: closed.offenders })}`);
  if (theme === 'light' || viewport.name === '1440x900') await shot(page, viewport, `${prefixBase}-closed-${theme}`);
  if (ASSERT) assertState(`[${viewport.name} ${theme}] ${prefixBase} closed:`, closed, closedAttempts, { open: false });

  for (const panelName of panelNames) {
    if (!found[panelName]) {
      states[panelName] = { skipped: 'not rendered (for example a bio short enough to need no "More")' };
      console.log(`  ${prefixBase} ${panelName}: not rendered, skipped`);
      continue;
    }
    const selector = `[data-verify-panel="${panelName}"]`;
    const trigger = page.locator(`${selector} > :first-child`);
    const target = panelName === 'more' || panelName === 'save-login-help';
    await trigger.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      document.scrollingElement.scrollLeft = 0;
    });

    await trigger.hover();
    // Enter: the opacity transition is running, read part-way through.
    const enter = target ? await sampleTransition(page, selector) : null;
    await page.waitForTimeout(400);
    const open = await measure(page, panelName);
    const box = await trigger.boundingBox();
    const pointer = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
    if (theme === 'light' || viewport.name === '1440x900') await shot(page, viewport, `${prefixBase}-${panelName}-open-${theme}`);

    const attempts = await tryToScrollSideways(page, pointer);
    const stillOpen = await page.evaluate((rootSelector) => {
      const root = document.querySelector(rootSelector);
      const panel = root.querySelector(':scope > [data-hover-reveal-panel]') || root.querySelector(':scope > div.absolute');
      return getComputedStyle(panel).visibility === 'visible';
    }, selector);
    // Back over the trigger: the gestures may have moved the pointer's hit target.
    await trigger.hover();
    await page.waitForTimeout(300);

    await page.mouse.move(neutral.x, neutral.y);
    // Exit: the same transition, running the other way.
    const exit = target ? await sampleTransition(page, selector) : null;
    await page.waitForTimeout(400);
    const after = await measure(page, panelName);

    states[panelName] = {
      ...open, attempts, stillOpenAfterGestures: stillOpen, enter, exit, closedAgain: { panel: after.panel, container: after.container }
    };
    console.log(`  ${prefixBase} ${panelName} open ${JSON.stringify({ document: open.document, container: open.container, trigger: open.trigger, panel: open.panel, offenders: open.offenders })}`);
    if (target) console.log(`  ${prefixBase} ${panelName} motion ${JSON.stringify({ enter, exit })}`);
    if (ASSERT) {
      const prefix = `[${viewport.name} ${theme}] ${prefixBase} ${panelName}`;
      assertState(`${prefix} open:`, open, attempts, { open: true, panelName });
      expect(`${prefix} stays open through the gestures`, stillOpen);
      expect(`${prefix} closes again on leaving`, after.panel && after.panel.visibility === 'hidden', after.panel && after.panel.visibility);
      expect(`${prefix} closed again: profile scrollWidth === clientWidth`, after.container.scrollWidth === after.container.clientWidth, `${after.container.scrollWidth} vs ${after.container.clientWidth}`);
      if (target) {
        expect(`${prefix} enter animates opacity (transition running, part-way value)`, enter && enter.running && enter.opacity > 0 && enter.opacity < 1, JSON.stringify(enter));
        expect(`${prefix} exit animates opacity (transition running, part-way value)`, exit && exit.running && exit.opacity > 0 && exit.opacity < 1, JSON.stringify(exit));
      }
    }
  }
  return states;
}

async function runViewport(browser, viewport) {
  console.log(`\n── ${viewport.name}`);
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'no-preference' });
  await routeMediaOrigin(context);
  const page = await context.newPage();
  const consoleProblems = [];
  const hydration = [];
  const failedResponses = [];
  const failedRequests = [];
  page.on('console', (message) => {
    const text = message.text();
    if (/hydrat|did not match|#418|#423|#425/i.test(text)) hydration.push(text.slice(0, 200));
    if (message.type() === 'error') consoleProblems.push(text.slice(0, 200));
  });
  page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${String(error).slice(0, 200)}`));
  page.on('response', (response) => {
 if (response.status() >= 400) failedResponses.push(`${response.status()} ${response.url()}`);
});
  page.on('requestfailed', (request) => {
    const reason = request.failure()?.errorText || '';
    failedRequests.push({ url: request.url(), reason, type: request.resourceType() });
  });

  await signIn({ page, context }, ACCOUNT);
  const result = {};

  // Server HTML cannot know where the edge is, so a fitted panel must not be in it:
  // otherwise the overflow is back from first paint until hydration.
  if (viewport.name === '1440x900') {
    const otherHtml = await (await page.request.get(`${USER_APP}/${OTHER_PROFILE}`)).text();
    const ownHtml = await (await page.request.get(`${USER_APP}/${OWN_PROFILE}`)).text();
    const moreAt = otherHtml.indexOf('aria-label="More actions"');
    const afterMoreTrigger = moreAt >= 0 ? otherHtml.slice(moreAt, otherHtml.indexOf('Share homepage', moreAt)) : '';
    result.serverHtml = {
      moreTriggerRendered: moreAt >= 0,
      morePanelInServerHtml: /data-hover-reveal-panel|>Report<|>Block</.test(afterMoreTrigger),
      saveLoginTriggerRendered: ownHtml.includes('data-profile-save-login'),
      saveLoginHelpInServerHtml: ownHtml.includes('Save login information; next login requires no verification')
    };
    console.log(`  server HTML ${JSON.stringify(result.serverHtml)}`);
    if (ASSERT) {
      expect(`[${viewport.name}] server HTML has the More trigger but not its panel`, result.serverHtml.moreTriggerRendered && !result.serverHtml.morePanelInServerHtml);
      expect(`[${viewport.name}] server HTML has the Save login row but not its help panel`, result.serverHtml.saveLoginTriggerRendered && !result.serverHtml.saveLoginHelpInServerHtml);
    }
  }
  for (const theme of viewport.themes) {

    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    const compact = viewport.width < 1024;

    result[`${theme}-other`] = await runProfile(page, viewport, theme, OTHER_PROFILE, compact ? ['more', 'share', 'bio'] : ['more', 'share', 'bio'], '01-other');

    result[`${theme}-own`] = await runProfile(page, viewport, theme, OWN_PROFILE, ['save-login-help', 'bio'], '02-own');
  }
  await page.evaluate(() => localStorage.setItem('theme', 'light'));

  // Navigations abort in-flight media and prefetches; that is the browser, not a failure.
  const realFailures = failedRequests.filter((item) => !/ERR_ABORTED/.test(item.reason));
  result.network = { failedResponses, failedRequests: realFailures, abortedCount: failedRequests.length - realFailures.length };
  result.console = { errors: consoleProblems, hydration };
  if (ASSERT) {
    expect(`[${viewport.name}] no console error`, consoleProblems.length === 0, consoleProblems.slice(0, 3).join(' | '));
    expect(`[${viewport.name}] no hydration warning`, hydration.length === 0, hydration.slice(0, 3).join(' | '));
    expect(`[${viewport.name}] no failed response`, failedResponses.length === 0, failedResponses.slice(0, 3).join(' | '));
    expect(`[${viewport.name}] no failed request (aborted-by-navigation excluded: ${result.network.abortedCount})`, realFailures.length === 0, JSON.stringify(realFailures.slice(0, 3)));
  } else {
    console.log(`  console ${JSON.stringify(result.console)} network ${JSON.stringify(result.network)}`);
  }
  report.viewports[viewport.name] = result;
  await context.close();
}

(async () => {
  const browser = await chromium.launch();
  try {
    for (const viewport of VIEWPORTS.filter((item) => !ONLY.length || ONLY.includes(item.name))) {

      await runViewport(browser, viewport);
    }
  } finally {
    await browser.close();
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    fs.writeFileSync(path.join(ARTIFACTS, `${LABEL}${ONLY.length ? `-${ONLY.join('_')}` : ''}.json`), JSON.stringify(report, null, 2));
  }
  process.exit(ASSERT ? summarise(`profile panel overflow (${LABEL})`) : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
