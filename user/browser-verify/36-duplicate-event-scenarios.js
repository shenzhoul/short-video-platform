/**
 * The real duplicate-event audit: the full scenario matrix, one tab, no
 * throttling and no artificial response loss.
 *
 * Records every emission at the client boundary with its flush trigger, and
 * every server verdict, then reports per scenario. Correlate the output with
 * the paired API log to classify any real collision.
 *
 *   node browser-verify/36-duplicate-event-scenarios.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085).
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const { signIn } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  const page = await context.newPage();

  const emitted = [];
  const verdicts = [];
  let scenario = 'startup';

  page.on('request', (request) => {
    if (!/\/posts\/recommendation-events/.test(request.url())) return;
    let body;
    try { body = JSON.parse(request.postData() || '{}'); } catch { return; }
    const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    (body.events || []).forEach((event) => emitted.push({
      scenario,
      batchId,
      at: Date.now(),
      sessionId: event.sessionId,
      postId: event.postId,
      eventType: event.eventType,
      source: event.source,
      watchMs: event.watchMs,
      exposureId: event.clientExposureId || null
    }));
  });
  page.on('response', async (response) => {
    if (!/\/posts\/recommendation-events/.test(response.url())) return;
    try {
      const json = await response.json();
      verdicts.push({ scenario, status: response.status(), ...(json?.data || json) });
    } catch { /* ignore */ }
  });

  const step = async (name, fn) => {
    scenario = name;
    const before = emitted.length;
    await fn();
    const events = emitted.slice(before);
    const keys = new Set(events.map((e) => `${e.sessionId}|${e.postId}|${e.eventType}`));
    console.log(`  ${name.padEnd(26)} emitted ${String(events.length).padStart(3)}  distinct ${String(keys.size).padStart(3)}  dupes ${events.length - keys.size}`);
  };

  console.log(`\n=== Duplicate-event scenario matrix @ ${W}x${H} — ${USER_APP} ===\n`);
  await signIn({ page }, ACCOUNT);

  const clickCard = async () => {
    await page.evaluate(() => {
      const card = [...document.querySelectorAll('article[data-post-id]')]
        .find((el) => /\d\d:\d\d/.test(el.textContent || ''));
      (card || document.querySelector('article[data-post-id]'))
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 }).catch(() => null);
  };
  const pressNext = async () => {
    await page.evaluate(() => {
      const b = document.querySelector('[data-post-detail-popup] button[aria-label="Next post"]');
      if (b && !b.disabled) b.click();
    });
    await page.waitForTimeout(1100);
  };
  const drag = async (dy, commit) => {
    const cdp = await context.newCDPSession(page);
    const x = Math.round(W * 0.45); const y = Math.round(H * 0.55);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (dy * i) / 10 }] });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
    await page.waitForTimeout(commit ? 1200 : 800);
  };

  await step('1 idle on Home', async () => {
    await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(14000); // two flush intervals
  });

  await step('2 scroll ten Home posts', async () => {
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => document.querySelector('#home-feed-scroll')?.scrollBy(0, 500));
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(4000);
  });

  await step('3 open/close popup x6', async () => {
    for (let i = 0; i < 6; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await clickCard();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(1800);
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate(() => document.querySelector('[data-post-detail-popup] button[aria-label*="Close" i]')?.click());
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(4000);
  });

  await step('4 ten popup navigations', async () => {
    await clickCard();
    await page.waitForTimeout(1800);
    for (let i = 0; i < 10; i += 1) await pressNext();
    await page.waitForTimeout(4000);
  });

  await step('5 four commits, four rollbacks', async () => {
    for (let i = 0; i < 4; i += 1) await drag(-Math.round(H * 0.45), true);
    for (let i = 0; i < 4; i += 1) await drag(-25, false);
    await page.waitForTimeout(4000);
  });

  await step('6 Videos in and out', async () => {
    await page.evaluate(() => {
      const b = [...document.querySelectorAll('[data-post-detail-popup] button')]
        .find((el) => /comment/i.test(el.getAttribute('aria-label') || ''));
      if (b) b.click();
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      const t = [...document.querySelectorAll('[data-post-detail-popup] nav button')]
        .find((el) => el.textContent.trim() === 'Videos');
      if (t) t.click();
    });
    await page.waitForTimeout(1300);
    await pressNext(); await pressNext();
    await page.evaluate(() => {
      const c = [...document.querySelectorAll('[data-post-detail-popup] aside button')]
        .find((el) => /close/i.test(el.getAttribute('aria-label') || ''));
      if (c) c.click();
    });
    await page.waitForTimeout(4000);
  });

  await step('7 For You / Following / Friend', async () => {
    for (const surface of ['for-you', 'following', 'friend']) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`${USER_APP}/${surface}`, { waitUntil: 'networkidle' });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(5000);
    }
    await page.waitForTimeout(4000);
  });

  await step('8 pause / resume / pause', async () => {
    await page.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); });
    await page.waitForTimeout(2500);
    await page.evaluate(() => { const v = document.querySelector('video'); if (v) v.play().catch(() => {}); });
    await page.waitForTimeout(3000);
    await page.evaluate(() => { const v = document.querySelector('video'); if (v) v.pause(); });
    await page.waitForTimeout(4000);
  });

  await step('9 visibility hide / show', async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 }).catch(() => {});
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForTimeout(4000);
    await cdp.detach();
  });

  await page.waitForTimeout(6000);

  // ------------------------------------------------------------- analysis
  const key = (e) => `${e.sessionId}|${e.postId}|${e.eventType}`;
  const seen = new Map();
  const collisions = [];
  emitted.forEach((e) => {
    const k = key(e);
    if (seen.has(k)) collisions.push({ first: seen.get(k), repeat: e });
    else seen.set(k, e);
  });

  const totals = verdicts.reduce((acc, v) => ({
    accepted: acc.accepted + (v.accepted || 0),
    deduped: acc.deduped + (v.deduped || 0),
    rejected: acc.rejected + (v.rejected || 0)
  }), { accepted: 0, deduped: 0, rejected: 0 });

  console.log(`\n  totals: emitted ${emitted.length}, distinct identities ${seen.size}, batches ${verdicts.length}`);
  console.log(`  server: ${JSON.stringify(totals)}`);
  console.log(`  client-side duplicate emissions: ${collisions.length}`);
  collisions.forEach(({ first, repeat }) => {
    console.log(`    ${repeat.eventType} post ${String(repeat.postId).slice(-6)} `
      + `${first.scenario} -> ${repeat.scenario} gap ${repeat.at - first.at}ms `
      + `watchMs ${first.watchMs} -> ${repeat.watchMs} sameBatch=${first.batchId === repeat.batchId}`);
  });

  const nonWatch = collisions.filter((c) => c.repeat.eventType !== 'final_watch');
  const sameBatch = collisions.filter((c) => c.first.batchId === c.repeat.batchId);

  console.log('');
  check('no duplicate identity within a single batch', sameBatch.length === 0, `${sameBatch.length}`);
  check('no duplicate emission outside final_watch corrections',
    nonWatch.length === 0, `${nonWatch.length}: ${nonWatch.map((c) => c.repeat.eventType).join(',')}`);
  check('every repeated final_watch carries greater watch time',
    collisions.filter((c) => c.repeat.eventType === 'final_watch')
      .every((c) => (c.repeat.watchMs || 0) > (c.first.watchMs || 0)));
  check('server rejected nothing', totals.rejected === 0, `${totals.rejected}`);
  check('server deduped nothing during normal browsing', totals.deduped === 0, `${totals.deduped}`);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
