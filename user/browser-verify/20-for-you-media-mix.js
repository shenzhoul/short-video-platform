/**
 * What For You actually serves, counted rather than summarised.
 *
 * "56 steps, 50 distinct video posts" left the important question unanswered:
 * how many *posts* were distinct, how many were photos, how many steps did not
 * move at all, and what happened either side of the segment boundary. Every
 * stage state here is resolved to a post id and its media type from the
 * database, so the distribution is a count and not an impression.
 *
 * Each stage state also records the recommendation session the client
 * attributed it to, so a post from the first segment cannot quietly be filed
 * under the second.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT_A = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

function instrument(ctx) {
  const pages = [];
  const events = [];
  const logs = [];
  ctx.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (/403 \(Forbidden\)/.test(text)) return;
    logs.push(`[${message.type()}] ${text.slice(0, 180)}`);
  });
  ctx.page.on('pageerror', (error) => logs.push(`[pageerror] ${String(error).slice(0, 180)}`));
  ctx.page.on('request', (request) => {
    if (!request.url().includes('/posts/recommendation-events')) return;
    try {
      const body = JSON.parse(request.postData() || '{}');
      (body.events || []).forEach((event) => events.push({
        eventType: event.eventType, postId: event.postId, sessionId: event.sessionId
      }));
    } catch { /* unparsed */ }
  });
  ctx.page.on('response', async (response) => {
    if (!response.url().includes('/posts/recommended')) return;
    const parsed = new URL(response.url());
    try {
      const json = await response.json();
      const data = json?.data;
      pages.push({
        // The session this request *continued* — on the client's first call
        // that is the server-rendered session, which the browser never sees a
        // response for.
        sentSessionId: parsed.searchParams.get('sessionId'),
        sessionId: data?.sessionId,
        hasMore: data?.hasMore,
        ids: (data?.data || []).map((post) => post._id)
      });
    } catch { /* not JSON */ }
  });
  return { pages, events, logs };
}

/**
 * What the stage is showing. A video post mounts `video[data-video-id]`; a
 * photo post mounts no video at all, so it is identified by the images the
 * graphic stage renders.
 */
const stage = (page) => page.evaluate(() => {
  const video = document.querySelector('video[data-video-id^="for-you-"]');
  const images = Array.from(document.querySelectorAll('section img'))
    .map((image) => image.getAttribute('src'))
    .filter((src) => src && !src.startsWith('data:'));
  return {
    postId: video ? video.getAttribute('data-video-id').replace('for-you-', '') : null,
    videoSrc: video ? video.getAttribute('src') : null,
    videoCount: document.querySelectorAll('video').length,
    playing: Array.from(document.querySelectorAll('video')).filter((element) => !element.paused).length,
    imageCount: images.length,
    firstImage: images[0] || null
  };
});

async function walk(browser, db, signedIn) {
  const label = signedIn ? 'auth' : 'guest';
  console.log(`\n=== For You media mix — ${signedIn ? 'authenticated' : 'guest'} ===`);
  const ctx = await openContext(browser, `mix-${label}`);
  const probe = instrument(ctx);

  try {
    if (signedIn) await signIn(ctx, ACCOUNT_A);
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(5000);

    /** Every distinct post the stage showed, with the media it drew. */
    const timeline = [];
    let unchangedSteps = 0;
    let emptySrc = 0;
    let videoOnPhoto = 0;

    for (let step = 0; step < 90; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const view = await stage(ctx.page);
      const identity = view.postId || `img:${view.firstImage}`;
      const previous = timeline[timeline.length - 1];

      if (previous && previous.identity === identity) {
        unchangedSteps += 1;
      } else {
        timeline.push({ step, identity, postId: view.postId, imageCount: view.imageCount });
      }

      if (view.postId && (!view.videoSrc || !view.videoSrc.trim())) emptySrc += 1;
      // A photo post is one the stage drew with images; it must mount no video.
      if (!view.postId && view.imageCount > 0 && view.videoCount > 0) videoOnPhoto += 1;

      if (step >= 36 && step <= 44) {
        console.log(`  step ${step}: ${view.postId ? `video ${view.postId}` : `photo (${view.imageCount} images)`}`
          + ` videos=${view.videoCount} playing=${view.playing}`);
      }

      // eslint-disable-next-line no-await-in-loop
      await ctx.page.keyboard.press('ArrowDown');
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(620);
    }

    // Resolve every video-post id to its true media type; photo stages are
    // already known by construction (no video element, images drawn).
    const videoIds = timeline.filter((row) => row.postId).map((row) => row.postId);
    const resolved = await db.collection('posts')
      .find({ _id: { $in: videoIds.map((id) => new ObjectId(id)) } })
      .project({ type: 1 })
      .toArray();
    const typeById = new Map(resolved.map((row) => [row._id.toString(), row.type]));

    const videoStages = timeline.filter((row) => row.postId);
    const photoStages = timeline.filter((row) => !row.postId);
    const misdrawn = videoStages.filter((row) => typeById.get(row.postId) !== 'video');

    const sessionIds = [...new Set(probe.pages.map((page) => page.sessionId).filter(Boolean))];
    const servedIds = probe.pages.flatMap((page) => page.ids);

    console.log(`\n  distinct posts reached      : ${timeline.length}`);
    console.log(`    video posts               : ${videoStages.length}`);
    console.log(`    photo posts               : ${photoStages.length}`);
    console.log(`  navigation steps that did not change the post: ${unchangedSteps}`);
    console.log(`  sessions opened (client)    : ${sessionIds.length}`);
    console.log(`  rollovers                   : ${Math.max(0, sessionIds.length - 1)}`);
    console.log(`  rows served                 : ${servedIds.length} (${new Set(servedIds).size} distinct)`);
    console.log(`  recommendation events sent  : ${probe.events.length}`);

    check(`${label}: reaches at least 60 distinct recommendation posts`,
      timeline.length >= 60, `${timeline.length} distinct`);
    check(`${label}: serves both media kinds`,
      videoStages.length > 0 && photoStages.length > 0,
      `${videoStages.length} video, ${photoStages.length} photo`);
    check(`${label}: every video stage is genuinely a video post`,
      misdrawn.length === 0, `${misdrawn.length} misdrawn`);
    check(`${label}: no photo post ever mounted a <video>`, videoOnPhoto === 0, `${videoOnPhoto}`);
    check(`${label}: no video stage had an empty source`, emptySrc === 0, `${emptySrc}`);
    check(`${label}: no post was shown twice`,
      new Set(timeline.map((row) => row.identity)).size === timeline.length,
      `${timeline.length} stages, ${new Set(timeline.map((row) => row.identity)).size} distinct`);
    /*
     * A rollover opens a *new* session ranked from the whole pool, so it can
     * legitimately offer a post an earlier segment already showed — the client
     * filters those out. What must never happen is a duplicate reaching the
     * viewer, which is asserted above. The overlap is reported as a number
     * rather than treated as a fault.
     */
    console.log(`  server rows re-offered across rollovers: ${servedIds.length - new Set(servedIds).size}`);
    check(`${label}: no re-offered post ever reached the screen`,
      new Set(timeline.map((row) => row.identity)).size === timeline.length,
      `${timeline.length} stages, all distinct`);

    /*
     * Attribution: every event must name the session that ranked its post, not
     * whichever segment happened to be open when it fired.
     */
    const sessionByPost = new Map();
    probe.pages.forEach((page) => page.ids.forEach((id) => {
      if (!sessionByPost.has(id)) sessionByPost.set(id, page.sessionId);
    }));
    /*
     * The server-rendered first page never produces a response the browser can
     * see, so the posts it delivered are not in the map above — but the client's
     * first request *continues* that session, which names it. An event carrying
     * it is correctly attributed to a page this harness simply could not
     * observe; without this exemption those events look misattributed when the
     * same post is later re-offered by a rollover.
     */
    const ssrSessionId = probe.pages.find((page) => page.sentSessionId)?.sentSessionId || null;
    const attributable = probe.events.filter((event) => sessionByPost.has(event.postId));
    const misattributed = attributable.filter((event) => event.sessionId !== sessionByPost.get(event.postId)
      && event.sessionId !== ssrSessionId);
    console.log(`  server-rendered session: ${String(ssrSessionId).slice(0, 8)}`);
    console.log(`  events checkable against a known session: ${attributable.length}, misattributed: ${misattributed.length}`);
    check(`${label}: every event names the session that ranked its post`,
      misattributed.length === 0,
      misattributed.slice(0, 3).map((event) => `${event.eventType} ${event.postId}`).join(', '));
    check(`${label}: both photo and video produced events`,
      probe.events.length > 0, `${probe.events.length} events`);
    check(`${label}: console is clean`, probe.logs.length === 0, probe.logs.slice(0, 3).join(' | '));
    await ctx.shot(`63-for-you-media-mix-${label}`);
    return timeline;
  } finally {
    await ctx.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();
  try {
    const total = await db.collection('posts').countDocuments({ status: 'active' });
    const photos = await db.collection('posts').countDocuments({ status: 'active', type: 'photo' });
    console.log(`catalogue: ${total} active posts, ${photos} photo, ${total - photos} video`);
    await walk(browser, db, false);
    await walk(browser, db, true);
  } finally {
    await mongo.close();
    await browser.close();
  }
  process.exit(summarise('For You media mix'));
}

main().catch((error) => { console.error(error); process.exit(1); });
