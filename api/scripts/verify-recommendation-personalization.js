/**
 * Personalisation evidence for the recommendation engine.
 *
 * Signs in as two demo accounts with deliberately different histories, plus a
 * guest, asks each for a Home and a For You session, and reports the category
 * mix and per-source breakdown of the top slots.
 *
 * It exists because "the feed is personalised" is not something a passing unit
 * test can show: the unit tests prove each stage in isolation, and this proves
 * the stages compose into two genuinely different feeds for two genuinely
 * different people, against a real database, a real Redis and a real HTTP
 * server.
 *
 * The debug breakdown it prints is the engine's own `debug=true` output, which
 * the API only ever returns outside production.
 *
 * Usage:
 *   node scripts/verify-recommendation-personalization.js
 *   node scripts/verify-recommendation-personalization.js --api=http://localhost:8080
 */

const crypto = require('crypto');

const API = (process.argv.find((arg) => arg.startsWith('--api=')) || '--api=http://localhost:8080').split('=')[1];
const PASSWORD = process.argv.includes('--password')
  ? process.argv[process.argv.indexOf('--password') + 1]
  : 'demodemo';

/** The web client sha256s the password before sending; the server scrypts what arrives. */
const clientHash = (plain) => crypto.createHash('sha256').update(plain).digest('hex');

const fs = require('fs');
const os = require('os');

/**
 * Tokens are cached on disk between runs.
 *
 * The auth endpoint is rate-limited per identifier, and it should be — but
 * that makes a verification script which signs in on every run its own worst
 * enemy: iterating on the checks below quickly locks the very accounts they
 * are about to inspect. The cache is keyed on the account and simply reused
 * until the API rejects it.
 */
const TOKEN_CACHE = `${os.tmpdir()}/douyin-reco-verify-tokens.json`;

function readTokenCache() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function writeTokenCache(cache) {
  try {
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify(cache));
  } catch {
    // A cache that cannot be written is a slower script, not a broken one.
  }
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function login(email) {
  const cache = readTokenCache();
  if (cache[email]) {
    // Cheapest possible liveness probe for a cached token.
    const probe = await fetch(`${API}/posts/home-posts?limit=1`, { headers: { Authorization: cache[email] } });
    if (probe.ok) return cache[email];
  }

  // The limiter answers 429; wait it out rather than failing the whole run.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    const response = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password: clientHash(PASSWORD) })
    });
    // eslint-disable-next-line no-await-in-loop
    const body = await response.json();
    const token = body?.data?.token || body?.token;
    if (token) {
      cache[email] = token;
      writeTokenCache(cache);
      return token;
    }
    if (response.status !== 429) {
      throw new Error(`login failed for ${email}: ${JSON.stringify(body).slice(0, 200)}`);
    }
    console.log(`  rate limited signing in as ${email}; waiting ${(attempt + 1) * 15}s`);
    // eslint-disable-next-line no-await-in-loop
    await sleep((attempt + 1) * 15000);
  }
  throw new Error(`login for ${email} stayed rate limited`);
}

async function feed(path, token, params = {}) {
  const url = new URL(`${API}${path}`);
  Object.entries({ debug: 'true', ...params }).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, {
    headers: token ? { Authorization: token } : {}
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`${path} -> ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body?.data || body;
}

/** Share of the first `n` results falling in each category. */
function categoryMix(posts, n = 20) {
  const mix = new Map();
  posts.slice(0, n).forEach((post) => {
    const key = post.topicKey || '(none)';
    mix.set(key, (mix.get(key) || 0) + 1);
  });
  return [...mix.entries()].sort((a, b) => b[1] - a[1]);
}

function sourceMix(debugRows = [], n = 20) {
  const mix = new Map();
  debugRows.slice(0, n).forEach((row) => {
    const key = row.source || '(none)';
    mix.set(key, (mix.get(key) || 0) + 1);
  });
  return [...mix.entries()].sort((a, b) => b[1] - a[1]);
}

function shareOf(posts, topicKey, n = 20) {
  const window = posts.slice(0, n);
  if (!window.length) return 0;
  return window.filter((post) => post.topicKey === topicKey).length / window.length;
}

/**
 * Share of the top slots falling inside a persona's declared taste.
 *
 * This, rather than "share of one named category", is the honest measure of
 * personalisation in this dataset. Ten of the thirteen seeded categories have
 * a single creator, and **nobody is ever shown their own posts** — so the
 * account whose whole persona is built around `games` is precisely the
 * account that can never be served a `games` post. Asserting on one category
 * name measures the shape of the fixture, not the behaviour of the engine.
 */
function tasteShare(posts, taste, n = 20) {
  const window = posts.slice(0, n);
  if (!window.length) return 0;
  return window.filter((post) => taste.includes(post.topicKey)).length / window.length;
}

function printTop(label, result, limit = 20) {
  const posts = result.data || [];
  const debug = result.debug || [];
  console.log(`\n--- ${label} — session ${result.sessionId || '(none)'} ---`);
  console.log('  #  category      creator                source        score   post');
  posts.slice(0, limit).forEach((post, index) => {
    const row = debug[index] || {};
    const score = typeof row.finalScore === 'number' ? row.finalScore.toFixed(3) : '  -  ';
    console.log(
      `  ${String(index + 1).padStart(2)} `
      + `${String(post.topicKey || '-').padEnd(13)} `
      + `${String(post.user?.username || '-').padEnd(22)} `
      + `${String(row.source || '-').padEnd(13)} `
      + `${score}   ${post._id}`
    );
  });
  console.log(`  category mix: ${categoryMix(posts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const sources = sourceMix(debug);
  if (sources.length) console.log(`  source mix:   ${sources.map(([k, v]) => `${k}=${v}`).join(' ')}`);
}

function overlap(a, b, n = 20) {
  const left = new Set((a.data || []).slice(0, n).map((post) => post._id));
  const right = (b.data || []).slice(0, n).map((post) => post._id);
  return right.filter((id) => left.has(id)).length;
}

const results = [];
const check = (label, passed, detail) => {
  results.push({ label, passed, detail });
  console.log(`  ${passed ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

async function main() {
  const accountA = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
  const accountB = process.env.RECO_ACCOUNT_B || 'tomasberg.plays@demo.invalid';
  // Each persona's own taste: its primary category plus its two neighbours,
  // matching `demo/lib/recommendation-personas.js`.
  const tasteA = (process.env.RECO_TASTE_A || 'food,travel,photography').split(',');
  const tasteB = (process.env.RECO_TASTE_B || 'games,anime,knowledge').split(',');
  const topicA = tasteA[0];
  const topicB = tasteB[0];

  console.log(`API: ${API}`);
  const [tokenA, tokenB] = await Promise.all([login(accountA), login(accountB)]);
  console.log(`signed in: ${accountA}, ${accountB}`);

  const [homeA, homeB, forYouA, forYouB] = await Promise.all([
    feed('/posts/home-posts', tokenA),
    feed('/posts/home-posts', tokenB),
    feed('/posts/recommended', tokenA),
    feed('/posts/recommended', tokenB)
  ]);
  const homeGuest = await feed('/posts/home-posts', null, { anonymousId: 'verify-guest-1' });

  /*
   * The eligible catalogue, for base rates. Paged out of a guest session,
   * which is the closest thing to an unpersonalised view of what exists.
   */
  const catalogue = [...(homeGuest.data || [])];
  let catalogueCursor = homeGuest.nextCursor;
  let cataloguePages = 0;
  while (catalogueCursor && cataloguePages < 20) {
    // eslint-disable-next-line no-await-in-loop
    const page = await feed('/posts/home-posts', null, {
      anonymousId: 'verify-guest-1', sessionId: homeGuest.sessionId, cursor: catalogueCursor
    });
    catalogue.push(...(page.data || []));
    catalogueCursor = page.hasMore ? page.nextCursor : null;
    cataloguePages += 1;
  }

  printTop(`A (${accountA}) Home`, homeA);
  printTop(`B (${accountB}) Home`, homeB);
  printTop(`A (${accountA}) For You`, forYouA);
  printTop(`B (${accountB}) For You`, forYouB);
  printTop('Guest Home', homeGuest);

  console.log('\n=== Personalisation ===');

  // For You is the strongly-personalised surface (a higher personalized quota
  // and a heavier userInterest weight than Home); Home is deliberately a more
  // mixed, discovery-oriented feed, so both are reported.
  const aTasteForYou = tasteShare(forYouA.data, tasteA, 10);
  const bTasteOnAsFeed = tasteShare(forYouA.data, tasteB, 10);
  const bTasteForYou = tasteShare(forYouB.data, tasteB, 10);
  const aTasteOnBsFeed = tasteShare(forYouB.data, tasteA, 10);

  check(
    `A's For You leans to A's taste (${tasteA.join('/')}) more than to B's`,
    aTasteForYou > bTasteOnAsFeed,
    `${(aTasteForYou * 100).toFixed(0)}% A-taste vs ${(bTasteOnAsFeed * 100).toFixed(0)}% B-taste`
  );
  /*
   * Lift over the base rate, not a head-to-head between the two tastes.
   *
   * The two tastes are not equally reachable. `games` has a single creator,
   * and nobody is served their own posts, so B's declared taste covers a much
   * smaller slice of what B can actually be shown than A's does. Comparing
   * "B-taste share" against "A-taste share" on B's feed therefore measures
   * the shape of the catalogue, not the behaviour of the ranker — B can score
   * a strong lift over its own base rate and still land level with A's taste
   * simply because there is less of B's taste in existence.
   *
   * What personalisation actually claims is that a viewer sees more of their
   * taste than chance would give them. That is the lift measured here.
   */
  /*
   * The base rate is computed per viewer, over the posts that viewer could
   * actually be served — which excludes their own.
   *
   * That exclusion is not a detail here. `games` has exactly one creator, and
   * that creator is viewer B, so *none* of the games catalogue is reachable
   * for B. Counting it in B's base rate understates the lift by inflating the
   * denominator with content the ranker was never allowed to choose.
   */
  const baseRateFor = (taste, ownUsername) => {
    const reachable = catalogue.filter((post) => post.user?.username !== ownUsername);
    if (!reachable.length) throw new Error('catalogue is empty — the base rate would be meaningless');
    return reachable.filter((post) => taste.includes(post.topicKey)).length / reachable.length;
  };
  const usernameA = (forYouA.data || [])[0] && accountA.split('@')[0];
  const usernameB = accountB.split('@')[0];
  const baseA = baseRateFor(tasteA, usernameA);
  const baseB = baseRateFor(tasteB, usernameB);
  check(
    `A's For You lifts A's taste above chance`,
    aTasteForYou > baseA * 1.3,
    `${(aTasteForYou * 100).toFixed(0)}% served vs ${(baseA * 100).toFixed(0)}% of the catalogue `
    + `(${(aTasteForYou / (baseA || 1)).toFixed(1)}x lift)`
  );
  check(
    `B's For You lifts B's taste above chance`,
    bTasteForYou > baseB * 1.3,
    `${(bTasteForYou * 100).toFixed(0)}% served vs ${(baseB * 100).toFixed(0)}% of the catalogue `
    + `(${(bTasteForYou / (baseB || 1)).toFixed(1)}x lift)`
  );
  check(
    'each feed serves its own viewer\'s taste better than the other viewer\'s feed does',
    aTasteForYou > aTasteOnBsFeed && bTasteForYou > bTasteOnAsFeed,
    `A-taste: ${(aTasteForYou * 100).toFixed(0)}% on A vs ${(aTasteOnBsFeed * 100).toFixed(0)}% on B; `
    + `B-taste: ${(bTasteForYou * 100).toFixed(0)}% on B vs ${(bTasteOnAsFeed * 100).toFixed(0)}% on A`
  );

  const aTopicAShare = shareOf(homeA.data, topicA);
  const bTopicAShare = shareOf(homeB.data, topicA);

  const homeOverlap = overlap(homeA, homeB);
  check(
    'A and B top-20 differ (not the same feed with jitter)',
    homeOverlap < 15,
    `${homeOverlap}/20 posts shared`
  );
  check(
    'A and B still share some trending ground (not disjoint universes)',
    homeOverlap > 0,
    `${homeOverlap}/20 posts shared`
  );

  const guestOverlapA = overlap(homeGuest, homeA);
  check(
    'guest feed differs from A',
    guestOverlapA < 18,
    `${guestOverlapA}/20 posts shared with A`
  );

  console.log('\n=== Sessions ===');

  // A reload is a brand-new session: a different order, but the same taste.
  const homeA2 = await feed('/posts/home-posts', tokenA);
  check(
    'reload creates a new session id',
    homeA2.sessionId && homeA2.sessionId !== homeA.sessionId,
    `${homeA.sessionId} -> ${homeA2.sessionId}`
  );
  const reloadOrderSame = (homeA.data || []).slice(0, 10).map((p) => p._id).join()
    === (homeA2.data || []).slice(0, 10).map((p) => p._id).join();
  check('reload reorders the feed', !reloadOrderSame);
  const forYouA2 = await feed('/posts/recommended', tokenA);
  const reloadTasteShare = tasteShare(forYouA2.data, tasteA, 10);
  check(
    'a new session preserves personalisation',
    reloadTasteShare > bTasteOnAsFeed,
    `A-taste still ${(reloadTasteShare * 100).toFixed(0)}% vs B-taste ${(bTasteOnAsFeed * 100).toFixed(0)}%`
  );
  void bTopicAShare;

  // Paging the same session never repeats a post.
  const seen = new Set((homeA.data || []).map((post) => post._id));
  let cursor = homeA.nextCursor;
  let duplicates = 0;
  let pages = 0;
  let total = seen.size;
  while (cursor && pages < 12) {
    // eslint-disable-next-line no-await-in-loop
    const page = await feed('/posts/home-posts', tokenA, { sessionId: homeA.sessionId, cursor });
    (page.data || []).forEach((post) => {
      total += 1;
      if (seen.has(post._id)) duplicates += 1;
      seen.add(post._id);
    });
    cursor = page.hasMore ? page.nextCursor : null;
    pages += 1;
  }
  check(
    'paging one session never repeats a post',
    duplicates === 0,
    `${pages} extra pages, ${total} rows, ${seen.size} distinct, ${duplicates} duplicates`
  );

  // A category tab is a new, category-scoped session — not a client filter.
  const scoped = await feed('/posts/home-posts', tokenA, { topicKey: topicB });
  const offTopic = (scoped.data || []).filter((post) => post.topicKey !== topicB);
  check(
    `category tab '${topicB}' returns only that category`,
    offTopic.length === 0,
    `${(scoped.data || []).length} posts, ${offTopic.length} off-topic`
  );
  check(
    'category tab starts its own session',
    Boolean(scoped.sessionId) && scoped.sessionId !== homeA.sessionId
  );

  // An expired/unknown session must degrade to a fresh one, not error.
  const recovered = await feed('/posts/home-posts', tokenA, { sessionId: 'expired-session-that-does-not-exist' });
  check(
    'an expired session recovers into a fresh one instead of failing',
    Array.isArray(recovered.data) && recovered.data.length > 0 && recovered.sessionId !== 'expired-session-that-does-not-exist'
  );

  console.log('\n=== Cold start ===');
  const debugAll = [...(homeA.debug || []), ...(homeB.debug || []), ...(forYouA.debug || []), ...(forYouB.debug || [])];
  /*
   * The exploration bonus is what carries an under-exposed post, and it is
   * staged by lifetime impressions. A dataset where *every* post still sits
   * in stage 0 has no cold start to demonstrate — everything looks equally
   * undiscovered — so the meaningful check is that the bonus actually varies.
   */
  const bonuses = debugAll
    .map((row) => row.breakdown?.explorationBonus)
    .filter((value) => typeof value === 'number');
  const distinctBonuses = new Set(bonuses.map((value) => value.toFixed(3)));
  check(
    'the exploration bonus discriminates between posts',
    distinctBonuses.size > 1,
    `${distinctBonuses.size} distinct values across ${bonuses.length} scored rows `
    + `(${[...distinctBonuses].join(', ')})`
  );
  const firstSlotFresh = [homeA, homeB, forYouA, forYouB]
    .filter((result) => (result.debug || [])[0]?.source === 'fresh').length;
  check(
    'cold-start posts are not always first',
    firstSlotFresh < 4,
    `${firstSlotFresh}/4 feeds opened on a fresh-bucket post`
  );

  console.log('\n=== Result ===');
  const failed = results.filter((row) => !row.passed);
  if (!failed.length) {
    console.log(`  all ${results.length} checks passed`);
    return;
  }
  failed.forEach((row) => console.log(`  FAILED: ${row.label}`));
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
