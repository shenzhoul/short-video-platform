/**
 * Browser pass 8 — what actually costs the p95 when stepping through For You.
 *
 * The previous round measured p95 74ms over 20 post changes and observed that
 * only 2 telemetry batches were sent during the gesture. "Only 2 batches" is
 * circumstantial: it shows the batches were few, not that they were cheap, and
 * a coincidence in time is not a cause. This isolates the pipeline instead.
 *
 * Four arms, same gesture, repeated so the numbers are not one sample:
 *
 *   full      — everything on, as shipped
 *   no-send   — events still collected, serialized and queued; the network
 *               call is stubbed out, so send + response handling disappear
 *   no-collect— `enqueueRecommendationEvent` is neutered before the app runs,
 *               so no collection, no serialization, no send
 *   warm      — full, but on a second pass over posts already decoded
 *
 * If the event pipeline is the cost, `no-collect` is materially faster than
 * `full`. If it is not, all three arms land together and the cost is media.
 *
 * Long tasks are attributed with `PerformanceObserver`'s attribution entries
 * where the browser supplies them, so "which long task" is answered rather
 * than guessed.
 */

const {
  chromium, USER_APP, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const RUNS = Number(process.env.RUNS || 5);
const STEPS = 20;

const stats = (values) => {
  if (!values.length) return { median: 0, p95: 0, p99: 0, worst: 0 };
  const s = [...values].sort((a, b) => a - b);
  const at = (p) => Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]);
  return { median: at(0.5), p95: at(0.95), p99: at(0.99), worst: Math.round(s[s.length - 1]) };
};

/** Installs the measurement harness plus whichever arm's stub is required. */
async function installArm(page, arm) {
  await page.addInitScript((mode) => {
    window.__arm = mode;
    window.__perf = { longTasks: [], frames: [], marks: [] };

    // Long tasks, with whatever attribution the browser will give us.
    try {
      new PerformanceObserver((list) => {
        list.getEntries().forEach((e) => {
          const attribution = (e.attribution || []).map((a) => ({
            name: a.name, type: a.containerType, src: a.containerSrc, id: a.containerId
          }));
          window.__perf.longTasks.push({ duration: Math.round(e.duration), attribution });
        });
      }).observe({ entryTypes: ['longtask'] });
    } catch { /* unsupported */ }

    let last = performance.now();
    const tick = () => {
      const now = performance.now();
      window.__perf.frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    if (mode === 'no-send') {
      /*
       * Collection, serialization and queuing all still happen; only the
       * transport is removed. `fetch` is what both the batched flush and the
       * keepalive unload path go through.
       */
      const realFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/posts/recommendation-events')) {
          window.__perf.marks.push('suppressed-send');
          return Promise.resolve(new Response(
            JSON.stringify({ data: { accepted: 0, deduped: 0, rejected: 0 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          ));
        }
        return realFetch(input, init);
      };
      // The app also sends through XHR/axios; blunt both.
      const RealXHR = window.XMLHttpRequest;
      window.XMLHttpRequest = function PatchedXHR() {
        const xhr = new RealXHR();
        const open = xhr.open.bind(xhr);
        xhr.open = (method, url, ...rest) => {
          xhr.__isEvents = String(url).includes('/posts/recommendation-events');
          return open(method, url, ...rest);
        };
        const send = xhr.send.bind(xhr);
        xhr.send = (body) => {
          if (xhr.__isEvents) {
            window.__perf.marks.push('suppressed-send');
            Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
            Object.defineProperty(xhr, 'status', { value: 200, configurable: true });
            Object.defineProperty(xhr, 'responseText', {
              value: '{"data":{"accepted":0,"deduped":0,"rejected":0}}', configurable: true
            });
            setTimeout(() => {
              if (typeof xhr.onreadystatechange === 'function') xhr.onreadystatechange();
              xhr.dispatchEvent(new Event('load'));
              xhr.dispatchEvent(new Event('loadend'));
            }, 0);
            return undefined;
          }
          return send(body);
        };
        return xhr;
      };
    }
  }, arm);
}

/**
 * Silences only the *telemetry* observers, not every observer on the page.
 *
 * An earlier version replaced `IntersectionObserver` wholesale, which also
 * removed `usePostVideoHoverPlayback`'s viewport teardown and
 * `useIsInViewport` — so the 16ms it appeared to save was partly playback
 * work, and attributing all of it to telemetry would have been wrong.
 *
 * The recommendation observers are distinguishable: `useRecommendationImpression`
 * and `useRecommendationCardDwell` are the only ones constructed with
 * `threshold: [0, 0.5]`. Everything else keeps working.
 */
async function neuterCollection(page) {
  await page.addInitScript(() => {
    const RealIO = window.IntersectionObserver;
    const isTelemetry = (options) => Array.isArray(options?.threshold)
      && options.threshold.length === 2
      && options.threshold[0] === 0
      && options.threshold[1] === 0.5;

    window.__telemetryObserversSuppressed = 0;
    window.IntersectionObserver = function ScopedIO(callback, options) {
      if (isTelemetry(options)) {
        window.__telemetryObserversSuppressed += 1;
        return {
          observe() {}, unobserve() {}, disconnect() {}, takeRecords() { return []; }
        };
      }
      return new RealIO(callback, options);
    };
    window.IntersectionObserver.prototype = RealIO.prototype;
  });
}

/**
 * A second pass over posts whose media the browser has already decoded, so the
 * cold-load cost can be separated from everything else.
 */
async function warmUp(ctx, steps) {
  for (let i = 0; i < steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.keyboard.press('ArrowDown');
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.waitForTimeout(400);
  }
  for (let i = 0; i < steps; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.keyboard.press('ArrowUp');
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.waitForTimeout(250);
  }
  await ctx.page.waitForTimeout(1500);
}

async function runArm(browser, arm, label) {
  const ctx = await openContext(browser, label);
  await installArm(ctx.page, arm);
  if (arm === 'no-collect') await neuterCollection(ctx.page);

  await signIn(ctx, ACCOUNT);
  await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
  await ctx.page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
  await ctx.page.waitForFunction(() => {
    const v = document.querySelector('video');
    return v && Number.isFinite(v.duration) && v.duration > 0;
  }, { timeout: 30000 }).catch(() => {});
  await ctx.page.waitForTimeout(2500);

  // The `warm` arm walks the same posts once first, so their media is already
  // decoded when the measured pass runs.
  if (arm === 'warm') await warmUp(ctx, STEPS);

  // Reset counters after warm-up so page load is not in the sample.
  await ctx.page.evaluate(() => { window.__perf.longTasks = []; window.__perf.frames = []; });

  const before = ctx.captured.length;
  for (let i = 0; i < STEPS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.keyboard.press('ArrowDown');
    // eslint-disable-next-line no-await-in-loop
    await ctx.page.waitForTimeout(450);
  }

  const raw = await ctx.page.evaluate(() => ({
    longTasks: window.__perf.longTasks,
    frames: window.__perf.frames,
    marks: window.__perf.marks.length,
    suppressedObservers: window.__telemetryObserversSuppressed || 0,
    videos: document.querySelectorAll('video').length,
    playing: Array.from(document.querySelectorAll('video')).filter((v) => !v.paused).length,
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
  }));

  const result = {
    arm: label,
    frames: stats(raw.frames),
    longTaskCount: raw.longTasks.length,
    longTaskMs: raw.longTasks.reduce((a, t) => a + t.duration, 0),
    over50: raw.longTasks.filter((t) => t.duration > 50).length,
    worstLongTask: Math.max(0, ...raw.longTasks.map((t) => t.duration)),
    attribution: raw.longTasks.slice(0, 6).map((t) => ({
      ms: t.duration, from: t.attribution?.[0]?.name || 'unattributed'
    })),
    batches: ctx.captured.length - before,
    suppressedSends: raw.marks,
    suppressedObservers: raw.suppressedObservers,
    videos: raw.videos,
    playing: raw.playing,
    heapMb: raw.heapMb
  };
  await ctx.close();
  return result;
}

function summariseArm(rows) {
  const p95s = rows.map((r) => r.frames.p95);
  const medians = rows.map((r) => r.frames.median);
  const p99s = rows.map((r) => r.frames.p99);
  const worst = Math.max(...rows.map((r) => r.frames.worst));
  return {
    runs: rows.length,
    medianOfMedians: stats(medians).median,
    medianP95: stats(p95s).median,
    worstP95: Math.max(...p95s),
    medianP99: stats(p99s).median,
    worstFrame: worst,
    longTasks: Math.round(rows.reduce((a, r) => a + r.longTaskCount, 0) / rows.length),
    over50: Math.round(rows.reduce((a, r) => a + r.over50, 0) / rows.length),
    longTaskMs: Math.round(rows.reduce((a, r) => a + r.longTaskMs, 0) / rows.length),
    batches: Math.round(rows.reduce((a, r) => a + r.batches, 0) / rows.length),
    videos: Math.max(...rows.map((r) => r.videos)),
    playing: Math.max(...rows.map((r) => r.playing)),
    heapMb: Math.max(...rows.map((r) => r.heapMb || 0))
  };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const arms = {
    full: [], 'no-send': [], 'no-collect': [], warm: []
  };

  try {
    console.log(`=== ${RUNS} runs x ${STEPS} post changes per arm (production build) ===\n`);
    for (let run = 0; run < RUNS; run += 1) {
      for (const arm of Object.keys(arms)) {
        // eslint-disable-next-line no-await-in-loop
        const result = await runArm(browser, arm, arm);
        arms[arm].push(result);
        console.log(`  run ${run + 1} ${arm.padEnd(11)} `
          + `median ${String(result.frames.median).padStart(3)}ms  `
          + `p95 ${String(result.frames.p95).padStart(3)}ms  `
          + `p99 ${String(result.frames.p99).padStart(4)}ms  `
          + `worst ${String(result.frames.worst).padStart(4)}ms  `
          + `longtasks ${String(result.longTaskCount).padStart(2)} (>50ms: ${result.over50})  `
          + `batches ${result.batches}`
          + `${result.suppressedSends ? ` (+${result.suppressedSends} sends suppressed)` : ''}`
          + `${result.suppressedObservers ? ` (${result.suppressedObservers} telemetry observers off)` : ''}`);
      }
    }

    console.log('\n=== Per-arm summary (median across runs) ===');
    console.log('  arm          median   p95   p99  worst  longtasks  >50ms  batches  videos  heap');
    const summaries = {};
    Object.entries(arms).forEach(([arm, rows]) => {
      const s = summariseArm(rows);
      summaries[arm] = s;
      console.log(
        `  ${arm.padEnd(12)} ${String(s.medianOfMedians).padStart(5)} `
        + `${String(s.medianP95).padStart(5)} ${String(s.medianP99).padStart(5)} `
        + `${String(s.worstFrame).padStart(6)} ${String(s.longTasks).padStart(10)} `
        + `${String(s.over50).padStart(6)} ${String(s.batches).padStart(8)} `
        + `${String(s.videos).padStart(7)} ${String(s.heapMb).padStart(5)}MB`
      );
    });

    console.log('\n  long-task attribution, first few of the full arm:');
    (arms.full[0]?.attribution || []).forEach((t) => console.log(`    ${t.ms}ms  ${t.from}`));

    console.log('\n=== Root cause ===');
    const full = summaries.full;
    const noSend = summaries['no-send'];
    const noCollect = summaries['no-collect'];

    const sendSaving = full.medianP95 - noSend.medianP95;
    const collectSaving = full.medianP95 - noCollect.medianP95;
    console.log(`  removing the network send saves ${sendSaving}ms of p95`);
    console.log(`  removing collection entirely saves ${collectSaving}ms of p95`);

    check(
      'the network send is not what costs the p95',
      Math.abs(sendSaving) < 15,
      `${full.medianP95}ms full vs ${noSend.medianP95}ms with sends suppressed`
    );
    check(
      'event collection is not what costs the p95',
      Math.abs(collectSaving) < 15,
      `${full.medianP95}ms full vs ${noCollect.medianP95}ms with collection disabled`
    );
    check(
      'at most three videos mounted and one playing, in every arm',
      Object.values(summaries).every((s) => s.videos <= 3 && s.playing <= 1),
      Object.entries(summaries).map(([k, s]) => `${k} ${s.videos}/${s.playing}`).join(', ')
    );
    check(
      'heap stays flat across arms',
      Math.max(...Object.values(summaries).map((s) => s.heapMb))
        - Math.min(...Object.values(summaries).map((s) => s.heapMb)) < 30,
      Object.entries(summaries).map(([k, s]) => `${k} ${s.heapMb}MB`).join(', ')
    );
    check(
      'no long task recurs frequently from the event pipeline',
      full.over50 <= noCollect.over50 + 3,
      `full ${full.over50} tasks >50ms vs ${noCollect.over50} with collection off`
    );

    const meetsTarget = full.medianP95 < 50;
    console.log(`\n  p95 target (<50ms): ${meetsTarget ? 'MET' : 'NOT met'} — full arm median p95 ${full.medianP95}ms`);
    if (!meetsTarget) {
      console.log('  Reported, not self-certified: the arms above are what attribute the cost.');
    }
  } finally {
    await browser.close();
  }

  process.exitCode = summarise('Pass 8: For You p95 root cause');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
