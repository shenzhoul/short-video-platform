/**
 * Every seeded photo post, opened in a real browser.
 *
 * The For You stage used to draw a photo post through the video branch, giving
 * a `<video>` with no source over a black rectangle. A sample is not enough
 * here: whether a post renders correctly depends on its own media rows, so this
 * walks the whole photo catalogue.
 *
 * Single-image and multi-image posts are reported separately, because they take
 * different paths through the carousel.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, check, summarise
} = require('./lib/harness');

const ACCOUNT_A = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  const photoPosts = await db.collection('posts')
    .find({ type: 'photo', status: 'active' })
    .sort({ createdAt: -1 })
    .toArray();

  const ctx = await openContext(browser, 'photo-coverage');
  const logs = [];
  ctx.page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    const text = message.text();
    if (/403 \(Forbidden\)/.test(text)) return;
    logs.push(`[${message.type()}] ${text.slice(0, 160)}`);
  });
  ctx.page.on('pageerror', (error) => logs.push(`[pageerror] ${String(error).slice(0, 160)}`));

  try {
    await signIn(ctx, ACCOUNT_A);
    console.log(`\n=== ${photoPosts.length} seeded photo posts, opened one by one ===`);

    const failures = [];
    let single = 0;
    let multi = 0;

    for (const post of photoPosts) {
      const id = post._id.toString();
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.goto(`${USER_APP}/?modal_id=${id}`, { waitUntil: 'domcontentloaded' });
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(3200);

      // eslint-disable-next-line no-await-in-loop
      // Scoped to the detail overlay. The Home grid stays mounted behind the
      // modal and its featured card legitimately holds a <video>; counting the
      // whole document would blame the photo stage for that.
      // eslint-disable-next-line no-await-in-loop
      const view = await ctx.page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return { opened: false };
        const videos = Array.from(dialog.querySelectorAll('video'));
        // The carousel slide specifically: `main img` also matches the blurred
        // backdrop (same src) and the rail avatar, which counted as extra
        // "images" and made a single-image post look like a two-image one.
        const slides = Array.from(dialog.querySelectorAll('main img.object-contain'))
          .map((image) => image.getAttribute('src'))
          .filter((src) => src && !src.startsWith('data:'));
        return {
          opened: true,
          videoCount: videos.length,
          badSrc: videos.filter((video) => {
            const attribute = video.getAttribute('src');
            return attribute === null || attribute.trim() === '';
          }).length,
          slideCount: new Set(slides).size
        };
      });

      if (!view.opened) {
        failures.push(`${id}: the detail overlay never opened`);
        console.log(`  ${id}  (overlay did not open)`);
        // eslint-disable-next-line no-continue
        continue;
      }

      if (view.slideCount > 1) multi += 1; else single += 1;
      if (view.videoCount > 0) failures.push(`${id}: mounted ${view.videoCount} <video> for a photo post`);
      if (view.slideCount === 0) failures.push(`${id}: rendered no image`);
      console.log(`  ${id}  slides=${view.slideCount}  <video> in overlay=${view.videoCount}`);
    }

    check('every seeded photo post was opened', photoPosts.length === 16, `${photoPosts.length} posts`);
    check('no photo post ever mounted a <video>', failures.filter((row) => row.includes('<video>')).length === 0,
      failures.filter((row) => row.includes('<video>')).slice(0, 3).join(' | '));
    check('every photo post rendered at least one image',
      failures.filter((row) => row.includes('no image') || row.includes('never opened')).length === 0,
      failures.filter((row) => row.includes('no image')).slice(0, 3).join(' | '));
    /*
     * The seeded catalogue is entirely single-image: all sixteen photo posts
     * carry exactly one `post_media` row. So this pass covers the single-image
     * path in a browser and the multi-image path is covered by
     * `post-video-stage-media.spec.tsx`, which renders a three-image post — not
     * because the browser could not, but because there is no such post to open.
     */
    console.log(`  slide-count distribution: ${single} single-image, ${multi} multi-image`);
    check('the single-image photo path is exercised in a browser', single > 0, `${single} posts`);
    check('console stayed clean across the whole catalogue', logs.length === 0, logs.slice(0, 3).join(' | '));
    await ctx.shot('57-photo-coverage-last');
  } finally {
    await ctx.close();
    await mongo.close();
    await browser.close();
  }

  process.exit(summarise('Photo coverage'));
}

main().catch((error) => { console.error(error); process.exit(1); });
