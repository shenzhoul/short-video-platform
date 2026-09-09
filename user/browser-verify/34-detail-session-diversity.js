/**
 * Detail-session diversity, measured on real generated seeds.
 *
 * Five fresh guest detail sessions x ten forward recommendations = fifty
 * positions. Reports unique coverage, per-post frequency, pairwise Jaccard, and
 * creator/category spread — the evidence that the selector varies rather than
 * permuting one small top group.
 *
 *   node browser-verify/34-detail-session-diversity.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), SESSIONS, STEPS.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const SESSIONS = Number(process.env.SESSIONS || 5);
const STEPS = Number(process.env.STEPS || 10);

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const short = (id) => (id ? String(id).slice(-6) : String(id));

const openId = (page) => page.evaluate(
  () => new URL(window.location.href).searchParams.get('modal_id')
);

/** Creator and category of the post currently open, read from the popup. */
const openMeta = (page) => page.evaluate(() => {
  const scope = document.querySelector('[data-post-detail-popup]');
  const creator = scope?.querySelector('[data-panel-creator-id]')?.getAttribute('data-panel-creator-id')
    || (scope?.innerText || '').match(/@[^\n·]+/)?.[0]?.trim()
    || null;
  const chip = [...(scope?.querySelectorAll('*') || [])]
    .find((el) => el.children.length === 0 && /Collection\s*·/.test(el.textContent || ''));
  return { creator, category: chip ? chip.textContent.trim() : null };
});

/** One fresh guest session: open from Home, walk forward. */
async function session(browser) {
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });

  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.locator('article[data-post-id]').first().click({ position: { x: 30, y: 60 } });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  await page.waitForTimeout(1800);

  const anchor = await openId(page);
  const forward = [];
  const meta = [];
  for (let i = 0; i < STEPS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const moved = await page.evaluate(() => {
      const button = document.querySelector('[data-post-detail-popup] button[aria-label="Next post"]');
      if (!button || button.disabled) return false;
      button.click();
      return true;
    });
    if (!moved) break;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(900);
    // eslint-disable-next-line no-await-in-loop
    forward.push(await openId(page));
    // eslint-disable-next-line no-await-in-loop
    meta.push(await openMeta(page));
  }
  await context.close();
  return { anchor, forward, meta };
}

(async () => {
  const browser = await chromium.launch();

  // Corpus size, straight from the API.
  const probe = await browser.newContext();
  const probePage = await probe.newPage();
  const corpus = await probePage.evaluate(async (app) => {
    try {
      const res = await fetch(`${app}/api/posts/home-posts?limit=1`);
      const json = await res.json();
      return json?.data?.total ?? json?.total ?? null;
    } catch { return null; }
  }, USER_APP).catch(() => null);
  await probe.close();

  console.log(`\n=== Detail-session diversity @ ${W}x${H} — ${USER_APP} ===`);
  console.log(`  corpus (reported total): ${corpus ?? 'unavailable'}`);

  const traces = [];
  for (let i = 0; i < SESSIONS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    traces.push(await session(browser));
  }

  console.log('\n  per-session traces:');
  traces.forEach((trace, index) => {
    console.log(`    S${index + 1} anchor ${short(trace.anchor)} first-next ${short(trace.forward[0])}`);
    console.log(`       ${trace.forward.map(short).join(' ')}`);
  });

  const all = traces.flatMap((trace) => trace.forward);
  const unique = new Set(all);
  const freq = new Map();
  all.forEach((id) => freq.set(id, (freq.get(id) || 0) + 1));
  const repeated = [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]);

  console.log(`\n  positions filled : ${all.length}`);
  console.log(`  unique post ids  : ${unique.size}`);
  console.log(`  appearing >1x    : ${repeated.length} — ${repeated.slice(0, 8).map(([id, n]) => `${short(id)}x${n}`).join(' ')}`);

  console.log('\n  pairwise Jaccard between sessions:');
  for (let i = 0; i < traces.length; i += 1) {
    const row = [];
    for (let j = 0; j < traces.length; j += 1) {
      if (i === j) { row.push(' -- '); continue; }
      const a = new Set(traces[i].forward);
      const b = new Set(traces[j].forward);
      const inter = [...a].filter((id) => b.has(id)).length;
      const union = new Set([...a, ...b]).size;
      row.push(union ? (inter / union).toFixed(2) : '0.00');
    }
    console.log(`    S${i + 1}: ${row.join('  ')}`);
  }

  const creators = new Map();
  const categories = new Map();
  traces.forEach((trace) => trace.meta.forEach((m) => {
    if (m.creator) creators.set(m.creator, (creators.get(m.creator) || 0) + 1);
    if (m.category) categories.set(m.category, (categories.get(m.category) || 0) + 1);
  }));
  console.log(`\n  distinct creators across all positions : ${creators.size}`);
  console.log(`  distinct categories                    : ${categories.size}`);

  const firstNexts = traces.map((trace) => trace.forward[0]);
  console.log(`  first-next per session                 : ${firstNexts.map(short).join(', ')}`);

  console.log('');
  check('fifty positions cover at least 30 distinct posts',
    unique.size >= 30, `${unique.size} unique of ${all.length}`);
  check('no two sessions produced an identical ten-post sequence',
    new Set(traces.map((t) => t.forward.join(','))).size === traces.length);
  check('no session repeated a post within itself',
    traces.every((t) => new Set(t.forward).size === t.forward.length));
  check('sessions do not all start on the same post',
    new Set(firstNexts).size > 1, `${new Set(firstNexts).size} distinct first-next`);
  check('more than one creator is represented',
    creators.size > 1, `${creators.size} creators`);

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
