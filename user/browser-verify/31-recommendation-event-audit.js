/**
 * Phase 6 — where do duplicate recommendation events come from?
 *
 * Captures every `/posts/recommendation-events` batch the client sends during a
 * realistic browse, and correlates by the identity the server dedupes on:
 * `(sessionId, postId, eventType)`. That is the same tuple the
 * `uq_recommendation_event_dedupe` index enforces, so a repeat here is exactly
 * a collision there — measured at the emission boundary rather than inferred
 * from a log line.
 *
 * Also records the server's own verdict per batch (accepted/deduped/rejected).
 *
 *   node browser-verify/31-recommendation-event-audit.js 440 956
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

const short = (id) => (id ? String(id).slice(-6) : String(id));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  const page = await context.newPage();

  /** Every event the client sent, tagged with the phase of the browse. */
  const emitted = [];
  const verdicts = [];
  let phase = 'startup';

  page.on('request', (request) => {
    if (!/\/posts\/recommendation-events/.test(request.url())) return;
    let body;
    try { body = JSON.parse(request.postData() || '{}'); } catch { return; }
    const events = body.events || body.data || (Array.isArray(body) ? body : []);
    events.forEach((event) => {
      emitted.push({
        phase,
        batchAt: Date.now(),
        sessionId: event.sessionId,
        postId: event.postId,
        eventType: event.eventType,
        source: event.source,
        watchMs: event.watchMs
      });
    });
  });
  page.on('response', async (response) => {
    if (!/\/posts\/recommendation-events/.test(response.url())) return;
    try {
      const json = await response.json();
      const data = json?.data || json;
      verdicts.push({ phase, ...data });
    } catch { /* body already consumed or not json */ }
  });

  console.log(`\n=== Recommendation event audit @ ${W}x${H} ===\n`);
  await signIn({ page }, ACCOUNT);

  // ------------------------------------------------------------ Home browse
  phase = 'home';
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);

  // ------------------------------------------------------- popup, 6 forward
  phase = 'popup-open';
  await page.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  await page.waitForTimeout(2500);

  phase = 'popup-forward';
  for (let i = 0; i < 6; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const button = document.querySelector('[data-post-detail-popup] button[aria-label="Next post"]');
      if (button && !button.disabled) button.click();
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(1400);
  }

  // ------------------------------------------------ drag previews must be inert
  phase = 'popup-drag';
  const client = await page.context().newCDPSession(page);
  const x = Math.round(W * 0.45);
  const y = Math.round(H * 0.55);
  // Drag well under the commit threshold, repeatedly: the preview slide is on
  // screen each time and must emit nothing at all.
  for (let i = 0; i < 4; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 5 }] });
    }
    // eslint-disable-next-line no-await-in-loop
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(900);
  }
  await client.detach();
  const dragPhaseEvents = emitted.filter((event) => event.phase === 'popup-drag');

  // --------------------------------------------------- close/reopen the popup
  phase = 'popup-reopen';
  const postId = new URL(page.url()).searchParams.get('modal_id');
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`${USER_APP}/?modal_id=${postId}`, { waitUntil: 'networkidle' });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2500);
  }

  // --------------------------------------------------------------- For You
  phase = 'for-you';
  await page.goto(`${USER_APP}/for-you`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(4000);

  await page.waitForTimeout(2500); // let the queue flush

  // --------------------------------------------------------------- analysis
  const key = (event) => `${event.sessionId}|${event.postId}|${event.eventType}`;
  const seen = new Map();
  const collisions = [];
  emitted.forEach((event) => {
    const k = key(event);
    if (seen.has(k)) collisions.push({ first: seen.get(k), repeat: event });
    else seen.set(k, event);
  });

  const byType = {};
  emitted.forEach((event) => { byType[event.eventType] = (byType[event.eventType] || 0) + 1; });
  const collisionsByType = {};
  const collisionsByPhase = {};
  collisions.forEach(({ repeat }) => {
    collisionsByType[repeat.eventType] = (collisionsByType[repeat.eventType] || 0) + 1;
    collisionsByPhase[`${repeat.phase}`] = (collisionsByPhase[`${repeat.phase}`] || 0) + 1;
  });

  console.log(`\n  emitted events: ${emitted.length}, distinct dedupe identities: ${seen.size}`);
  console.log(`  by event type: ${JSON.stringify(byType)}`);
  console.log(`  duplicate emissions: ${collisions.length}`);
  console.log(`  duplicates by type: ${JSON.stringify(collisionsByType)}`);
  console.log(`  duplicates by phase: ${JSON.stringify(collisionsByPhase)}`);

  if (collisions.length) {
    console.log('\n  | eventType | session | post | first phase | repeat phase | gap ms |');
    console.log('  |---|---|---|---|---|---|');
    collisions.slice(0, 12).forEach(({ first, repeat }) => {
      console.log(`  | ${repeat.eventType} | ${short(repeat.sessionId)} | ${short(repeat.postId)} | ${first.phase} | ${repeat.phase} | ${repeat.batchAt - first.batchAt} |`);
    });
  }

  const totals = verdicts.reduce((acc, verdict) => ({
    accepted: acc.accepted + (verdict.accepted || 0),
    deduped: acc.deduped + (verdict.deduped || 0),
    rejected: acc.rejected + (verdict.rejected || 0)
  }), { accepted: 0, deduped: 0, rejected: 0 });
  console.log(`\n  server verdicts across ${verdicts.length} batches: ${JSON.stringify(totals)}`);

  // ---------------------------------------------------------------- checks
  check('drag previews emitted no recommendation events at all',
    dragPhaseEvents.length === 0,
    `${dragPhaseEvents.length} event(s): ${dragPhaseEvents.map((event) => event.eventType).join(',')}`);

  const sessions = [...new Set(emitted.map((event) => event.sessionId))].filter(Boolean);
  console.log(`  distinct sessionIds seen: ${sessions.length} — ${sessions.map(short).join(', ')}`);

  // Does the popup emit under the *Home* session, now that it consumes it?
  const popupEvents = emitted.filter((event) => event.phase.startsWith('popup'));
  const homeEvents = emitted.filter((event) => event.phase === 'home');
  const homeSessions = new Set(homeEvents.map((event) => event.sessionId));
  const popupUnderHome = popupEvents.filter((event) => homeSessions.has(event.sessionId));
  console.log(`  popup events: ${popupEvents.length}, of which under a Home session: ${popupUnderHome.length}`);

  /*
   * `final_watch` is deliberately repeatable and is excluded here.
   *
   * The hook documents it: pause -> resume -> pause sends a second, *larger*
   * `final_watch` so the stored exposure can be corrected upward. The server
   * routes exactly that case to `updateOps` — an in-place `$set` on the
   * existing row — and never to `insertDocs`, so it cannot produce an insert
   * collision at all. What must hold is that a repeat carries more watch time
   * than the one before it; an identical resend would be a defect.
   */
  const watchRepeats = collisions.filter(({ repeat }) => repeat.eventType === 'final_watch');
  const otherRepeats = collisions.filter(({ repeat }) => repeat.eventType !== 'final_watch');

  check('no duplicate dedupe identity was emitted twice, apart from watch corrections',
    otherRepeats.length === 0,
    `${otherRepeats.length} repeat(s): ${otherRepeats.map(({ repeat }) => repeat.eventType).join(',')}`);
  check('every repeated final_watch reports more watch time than the one before it',
    watchRepeats.every(({ first, repeat }) => (repeat.watchMs || 0) > (first.watchMs || 0)),
    watchRepeats.map(({ first, repeat }) => `${first.watchMs}->${repeat.watchMs}`).join(', ') || 'none');
  check('the server reported no rejected events', totals.rejected === 0, `${totals.rejected}`);

  /*
   * ------------------------------------------------------------------------
   * Is a collision reproducible as *retry* behaviour rather than as a defect?
   *
   * `flush()` splices its batch out of the queue and awaits the request. If the
   * request fails after the server has already stored the rows — a dropped
   * connection, a tab hidden mid-flight — the catch puts the batch back and the
   * next flush sends it again. That is at-least-once delivery, and the unique
   * index is what makes it idempotent.
   *
   * This reproduces exactly that: the request is allowed through to the server,
   * and then the *response* is dropped so the client believes it failed. If the
   * design is what it claims, the retry is reported by the server as `deduped`
   * and nothing is double-counted.
   * ------------------------------------------------------------------------
   */
  console.log('\n  --- retry experiment: server stores the batch, client sees a failure ---\n');
  const retryPage = await context.newPage();
  const retryVerdicts = [];
  let dropNext = true;

  await retryPage.route('**/posts/recommendation-events', async (route) => {
    const response = await route.fetch().catch(() => null);
    if (!response) { await route.abort(); return; }
    let parsed = null;
    try { parsed = JSON.parse(await response.text()); } catch { /* ignore */ }
    const data = parsed?.data || parsed;
    if (dropNext) {
      // The server has processed it; the client will never learn that.
      retryVerdicts.push({ attempt: 'first (response dropped)', ...data });
      dropNext = false;
      await route.abort('connectionreset');
      return;
    }
    retryVerdicts.push({ attempt: 'retry (delivered)', ...data });
    await route.fulfill({ response });
  });

  await retryPage.goto(`${USER_APP}/for-you`, { waitUntil: 'networkidle' });
  await retryPage.waitForTimeout(5000);
  // Nudge the queue so a retry is attempted.
  await retryPage.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); });
  await retryPage.waitForTimeout(6000);

  retryVerdicts.forEach((verdict) => {
    console.log(`    ${verdict.attempt}: accepted=${verdict.accepted} deduped=${verdict.deduped} rejected=${verdict.rejected}`);
  });

  const firstAttempt = retryVerdicts.find((verdict) => verdict.attempt.startsWith('first'));
  const retryAttempt = retryVerdicts.find((verdict) => verdict.attempt.startsWith('retry'));

  check('a dropped response still stored the batch server-side',
    Boolean(firstAttempt) && firstAttempt.accepted > 0,
    firstAttempt ? `accepted=${firstAttempt.accepted}` : 'no first attempt captured');
  if (retryAttempt) {
    check('the retry of that batch is deduped, not double-counted',
      retryAttempt.deduped > 0 && retryAttempt.accepted === 0,
      `accepted=${retryAttempt.accepted} deduped=${retryAttempt.deduped}`);
  } else {
    console.log('  ○ no retry was observed within the window — the queue had nothing left to resend');
  }
  await retryPage.close();

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
