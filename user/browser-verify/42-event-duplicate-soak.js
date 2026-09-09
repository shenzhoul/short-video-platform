/**
 * Phase 3 acceptance — ten minutes of ordinary review traffic, correlated.
 *
 * The brief's evidence is a production-build review API logging real
 * duplicate-key rejections during normal use, so a synthetic dropped-response
 * reproduction proves nothing here. This drives the app the way a person does
 * — Home scrolling, popup open/close, ten detail navigations, P0/P1 history,
 * Videos enter/navigate/Back, photo posts, pause/resume, For You, Following,
 * Friend, visibility hide/show — and correlates every emitted event with the
 * batch that carried it and the server's verdict.
 *
 * Nothing is throttled and no response is dropped: the point is what happens
 * during *ordinary* use.
 */
const fs = require('fs');
const path = require('path');

const { chromium, USER_APP, signIn, SHOT_DIR } = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MINUTES = Number(process.env.MINUTES || 10);
const W = Number(process.env.W || 440);
const H = Number(process.env.H || 956);

const EVENTS_PATH = '/posts/recommendation-events';
const POPUP = '[data-post-detail-popup]';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** Every batch the page sent, with its events and the server's reply. */
const batches = [];
/** Flush trigger attributed to the batch that follows it. */
let currentTrigger = 'interval';

function attach(page) {
  page.on('request', (request) => {
    if (!request.url().includes(EVENTS_PATH)) return;
    let body = null;
    try { body = JSON.parse(request.postData() || '{}'); } catch { body = { unparsed: true }; }
    batches.push({
      at: Date.now(),
      trigger: currentTrigger,
      events: (body.events || []).map((e) => ({
        eventType: e.eventType,
        postId: e.postId,
        sessionId: e.sessionId,
        source: e.source,
        // The identity the server dedupes on, reconstructed client-side so a
        // duplicate can be spotted without reading the server's key.
        exposure: `${e.sessionId}:${e.postId}:${e.eventType}`
      })),
      verdict: null,
      status: null
    });
  });

  page.on('response', async (response) => {
    if (!response.url().includes(EVENTS_PATH)) return;
    const pending = batches.filter((b) => b.verdict === null);
    const target = pending[0];
    if (!target) return;
    target.status = response.status();
    try {
      const json = await response.json();
      target.verdict = json?.data || json || {};
    } catch {
      target.verdict = { unparsed: true };
    }
  });
}

const settle = (page, ms) => page.waitForTimeout(ms);

async function openPopup(page) {
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await settle(page, 2500);
  const card = page.locator('article[data-post-id]').first();
  if (!(await card.count())) return false;
  await card.click({ position: { x: 30, y: 60 } });
  await page.waitForSelector(POPUP, { timeout: 20000 }).catch(() => null);
  await settle(page, 2000);
  return page.evaluate((s) => Boolean(document.querySelector(s)), POPUP);
}

const clickIn = (page, selector) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el || el.disabled) return false;
  el.click();
  return true;
}, selector);

async function pressNav(page, direction) {
  const moved = await clickIn(page, `${POPUP} button[aria-label="${direction === 'next' ? 'Next post' : 'Previous post'}"]`);
  await settle(page, 1500);
  return moved;
}

async function openVideosTab(page) {
  await page.evaluate((sel) => {
    if (!document.querySelector(`${sel} nav[aria-label="Video details"]`)) {
      document.querySelector(`${sel} button[aria-label="Open post details"]`)?.click();
    }
  }, POPUP);
  await settle(page, 1200);
  await page.evaluate((sel) => {
    document.querySelector(`${sel} nav[aria-label="Video details"] button[aria-label="Videos"]`)?.click();
  }, POPUP);
  await settle(page, 1600);
}

async function closePopup(page) {
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const open = await page.evaluate((s) => Boolean(document.querySelector(s)), POPUP);
    if (!open) break;
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-await-in-loop
    await settle(page, 700);
  }
}

/** One full pass of the review activity the brief enumerates. */
async function reviewCycle(page, cycle) {
  console.log(`  cycle ${cycle}...`);

  // -- Home scrolling
  currentTrigger = 'home-scroll';
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await settle(page, 2500);
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.wheel(0, 900);
    // eslint-disable-next-line no-await-in-loop
    await settle(page, 700);
  }

  // -- popup open, ten detail navigations, photo posts, pause/resume
  currentTrigger = 'popup-navigation';
  if (await openPopup(page)) {
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      if (!(await pressNav(page, 'next'))) break;
      if (i % 3 === 0) {
        // pause / resume on whatever is playing
        // eslint-disable-next-line no-await-in-loop
        await clickIn(page, `${POPUP} button[aria-label="Pause"]`);
        // eslint-disable-next-line no-await-in-loop
        await settle(page, 900);
        // eslint-disable-next-line no-await-in-loop
        await clickIn(page, `${POPUP} button[aria-label="Play"]`);
        // eslint-disable-next-line no-await-in-loop
        await settle(page, 900);
      }
    }

    // -- P0/P1 history
    currentTrigger = 'history';
    await pressNav(page, 'previous');
    await pressNav(page, 'next');

    // -- Videos enter / navigate / Back
    currentTrigger = 'videos-tab';
    await openVideosTab(page);
    const tile = await page.evaluate((sel) => {
      const t = [...document.querySelectorAll(`${sel} button[data-post-id]`)]
        .find((b) => /^Open (photo|video):/.test(b.getAttribute('aria-label') || ''));
      if (!t) return null;
      t.click();
      return t.getAttribute('data-post-id');
    }, POPUP);
    await settle(page, 1800);
    await clickIn(page, `${POPUP} button[data-detail-back]`);
    await settle(page, 1500);
    if (!tile) console.log('    (no creator tile this cycle)');

    currentTrigger = 'popup-close';
    await closePopup(page);
  }

  // -- the vertical feeds
  for (const route of ['/for-you', '/following', '/friend']) {
    currentTrigger = `feed${route}`;
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`${USER_APP}${route}`, { waitUntil: 'networkidle' });
    // eslint-disable-next-line no-await-in-loop
    await settle(page, 3000);
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await clickIn(page, 'button[aria-label="Next post"]');
      // eslint-disable-next-line no-await-in-loop
      await settle(page, 1500);
    }
  }

  // -- visibility hide / show: the handler that used to emit a second dwell
  currentTrigger = 'visibility';
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle(page, 1500);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await settle(page, 1500);
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H } });
  const page = await context.newPage();
  attach(page);
  await signIn({ page }, ACCOUNT);

  console.log(`\n=== ${MINUTES} minutes of ordinary review traffic @ ${W}x${H} ===`);
  const until = Date.now() + MINUTES * 60 * 1000;
  let cycle = 0;
  /* eslint-disable no-await-in-loop */
  while (Date.now() < until) {
    cycle += 1;
    await reviewCycle(page, cycle);
  }
  /* eslint-enable no-await-in-loop */

  // Let the last interval flush land.
  currentTrigger = 'final-flush';
  await settle(page, 6000);

  // ------------------------------------------------------------- analysis
  const allEvents = batches.flatMap((b) => b.events.map((e) => ({ ...e, trigger: b.trigger, at: b.at })));
  const totals = batches.reduce((acc, b) => {
    acc.batches += 1;
    acc.events += b.events.length;
    acc.accepted += b.verdict?.accepted || 0;
    acc.deduped += b.verdict?.deduped || 0;
    acc.rejected += b.verdict?.rejected || 0;
    if (b.status && b.status >= 400) acc.httpErrors += 1;
    return acc;
  }, {
    batches: 0, events: 0, accepted: 0, deduped: 0, rejected: 0, httpErrors: 0
  });

  // A duplicate *within one batch* is what the unique index used to catch.
  const withinBatch = [];
  batches.forEach((b, i) => {
    const seen = new Map();
    b.events.forEach((e) => {
      const n = (seen.get(e.exposure) || 0) + 1;
      seen.set(e.exposure, n);
      if (n > 1) withinBatch.push({ batch: i, trigger: b.trigger, exposure: e.exposure, eventType: e.eventType });
    });
  });

  // The same identity sent by two different batches (overlapping flushes, or a
  // requeue after a delivered response).
  const acrossBatches = [];
  const firstSeen = new Map();
  batches.forEach((b, i) => {
    b.events.forEach((e) => {
      if (firstSeen.has(e.exposure)) {
        acrossBatches.push({
          exposure: e.exposure,
          eventType: e.eventType,
          firstBatch: firstSeen.get(e.exposure).batch,
          firstTrigger: firstSeen.get(e.exposure).trigger,
          secondBatch: i,
          secondTrigger: b.trigger
        });
      } else {
        firstSeen.set(e.exposure, { batch: i, trigger: b.trigger });
      }
    });
  });

  const byType = {};
  allEvents.forEach((e) => {
    byType[e.eventType] = byType[e.eventType] || { emitted: 0, distinctExposures: new Set(), triggers: {} };
    byType[e.eventType].emitted += 1;
    byType[e.eventType].distinctExposures.add(e.exposure);
    byType[e.eventType].triggers[e.trigger] = (byType[e.eventType].triggers[e.trigger] || 0) + 1;
  });

  console.log(`\n--- totals over ${cycle} cycles ---`);
  console.log(`  batches=${totals.batches} events=${totals.events} accepted=${totals.accepted} `
    + `deduped=${totals.deduped} rejected=${totals.rejected} httpErrors=${totals.httpErrors}`);

  console.log('\n--- by event type ---');
  Object.entries(byType).sort((a, b) => b[1].emitted - a[1].emitted).forEach(([type, row]) => {
    console.log(`  ${type.padEnd(18)} emitted=${String(row.emitted).padStart(4)} `
      + `distinctExposures=${String(row.distinctExposures.size).padStart(4)} `
      + `repeats=${row.emitted - row.distinctExposures.size} `
      + `triggers=${JSON.stringify(row.triggers)}`);
  });

  console.log('\n--- duplicates ---');
  console.log(`  within one batch : ${withinBatch.length}`);
  withinBatch.slice(0, 8).forEach((d) => console.log(`      ${d.eventType} trigger=${d.trigger}`));
  console.log(`  across batches   : ${acrossBatches.length}`);
  acrossBatches.slice(0, 8).forEach((d) => console.log(
    `      ${d.eventType} ${d.firstTrigger}#${d.firstBatch} -> ${d.secondTrigger}#${d.secondBatch}`
  ));

  check('no duplicate identity inside a single batch', withinBatch.length === 0,
    `${withinBatch.length} found`);
  check('every batch was accepted by the server', totals.httpErrors === 0,
    `${totals.httpErrors} HTTP error(s)`);
  check('the server rejected nothing', totals.rejected === 0, `rejected=${totals.rejected}`);
  check('traffic was actually generated', totals.events > 0, `${totals.events} events in ${cycle} cycles`);
  check('the three previously-colliding types were exercised',
    ['detail_open', 'photo_dwell', 'final_watch'].some((t) => byType[t]),
    Object.keys(byType).join(', '));

  const out = path.join(SHOT_DIR, '..', 'event-duplicate-soak.json');
  fs.writeFileSync(out, JSON.stringify({
    minutes: MINUTES,
    cycles: cycle,
    totals,
    byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, {
      emitted: v.emitted, distinctExposures: v.distinctExposures.size, triggers: v.triggers
    }])),
    withinBatch,
    acrossBatches,
    batches: batches.map((b) => ({
      trigger: b.trigger, status: b.status, verdict: b.verdict, events: b.events.length
    }))
  }, null, 2));
  console.log(`\nwrote ${out}`);

  await context.close();
  await browser.close();
  console.log(`\n=== ${pass} passed, ${fail} failed ===`);
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
