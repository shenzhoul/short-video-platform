/**
 * Phase 1 — popup autoplay must be deterministic across repeated opens.
 *
 * Opens and closes the *same* video post six times and records what the video
 * element actually did each time. No browser autoplay flags are used: the app's
 * own muted-autoplay policy is what has to work.
 *
 *   node browser-verify/30-popup-autoplay-cycles.js 440 956
 *
 * Env: PLAYWRIGHT_PATH, USER_APP (default http://localhost:8085), CYCLES.
 */
const PW = process.env.PLAYWRIGHT_PATH;
const { chromium } = require(PW);
const path = require('path');
const fs = require('fs');
const { signIn, routeMediaOrigin } = require('./lib/harness');

const USER_APP = process.env.USER_APP || 'http://localhost:8085';
const SHOTS = path.resolve(__dirname, '..', '..', 'output', 'screenshots');
const SHOOT = process.env.SHOOT === '1';
const W = Number(process.argv[2] || 440);
const H = Number(process.argv[3] || 956);
const CYCLES = Number(process.env.CYCLES || 6);
const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';

let pass = 0;
let fail = 0;
const check = (label, ok, detail) => {
  if (ok) pass += 1; else fail += 1;
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

/** What the popup's own video is doing right now. */
async function playback(page) {
  return page.evaluate(() => {
    const scope = document.querySelector('[data-post-detail-popup]');
    const video = scope?.querySelector('video');
    if (!video) return { present: false };
    return {
      present: true,
      paused: video.paused,
      readyState: video.readyState,
      muted: video.muted,
      currentTime: Math.round(video.currentTime * 100) / 100,
      src: (video.getAttribute('src') || '').slice(-28),
      rejections: window.__autoplayRejections || []
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true, deviceScaleFactor: 2 });
  await routeMediaOrigin(context);
  const page = await context.newPage();

  console.log(`\n=== Popup autoplay across ${CYCLES} open/close cycles @ ${W}x${H} ===\n`);
  await signIn({ page }, ACCOUNT);

  // Find a video post to reopen, by id, so every cycle is the same post.
  await page.goto(`${USER_APP}/`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const card = [...document.querySelectorAll('article[data-post-id]')]
      .find((element) => /\d\d:\d\d/.test(element.textContent || ''));
    (card || document.querySelector('article[data-post-id]'))
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  await page.waitForTimeout(2000);
  const postId = new URL(page.url()).searchParams.get('modal_id');
  const seed = await playback(page);
  console.log(`  post under test: ${postId} (video: ${seed.present})`);
  if (!seed.present) {
    console.log('  ! the opened post has no video — cannot measure autoplay');
    await browser.close();
    process.exit(1);
  }

  const results = [];
  for (let cycle = 1; cycle <= CYCLES; cycle += 1) {
    // Fresh navigation each cycle: this is "open the popup", not "re-render it".
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`${USER_APP}/?modal_id=${postId}`, { waitUntil: 'networkidle' });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
    // Give the element time to reach readiness and start — but assert on what
    // it did, not on the wait.
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(2600);
    // eslint-disable-next-line no-await-in-loop
    const state = await playback(page);
    results.push({ cycle, ...state });

    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(() => {
      const close = document.querySelector('[data-post-detail-popup] button[aria-label*="Close" i]');
      if (close) close.click();
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(600);
  }

  console.log('\n  | cycle | playing | readyState | muted | currentTime |');
  console.log('  |---|---|---|---|---|');
  results.forEach((row) => {
    console.log(`  | ${row.cycle} | ${row.paused === false ? 'yes' : 'NO'} | ${row.readyState} | ${row.muted} | ${row.currentTime} |`);
  });

  const playing = results.filter((row) => row.paused === false);
  check(`the first open autoplays`, results[0] && results[0].paused === false,
    results[0] ? `paused=${results[0].paused}` : 'no data');
  check(`all ${CYCLES} opens produce the same result`, playing.length === CYCLES,
    `${playing.length}/${CYCLES} played`);
  check('playback actually advanced, not merely un-paused',
    playing.every((row) => row.currentTime > 0),
    playing.map((row) => row.currentTime).join(', '));
  check('autoplay used the muted policy', playing.every((row) => row.muted === true));

  // ------------------------------------- after navigating to another post
  await page.goto(`${USER_APP}/?modal_id=${postId}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-post-detail-popup]', { timeout: 15000 });
  await page.waitForTimeout(2200);
  const x = Math.round(W * 0.45);
  const y = Math.round(H * 0.55);
  const swipeUp = async () => {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let i = 1; i <= 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (H * 0.4 * i) / 12 }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.detach();
    await page.waitForTimeout(2600);
  };

  /*
   * Keep swiping until a *video* post is reached. About one seeded post in ten
   * is a photo, and "the next post happened to be a photo" is not evidence
   * either way about whether playback transfers.
   */
  let afterSwipe = null;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    // eslint-disable-next-line no-await-in-loop
    await swipeUp();
    // eslint-disable-next-line no-await-in-loop
    afterSwipe = await playback(page);
    if (afterSwipe.present) break;
  }
  console.log(`\n  after a swipe: playing=${afterSwipe.paused === false}, t=${afterSwipe.currentTime}, src=${afterSwipe.src}`);
  if (afterSwipe.present) {
    check('playback transfers to the post reached by a swipe',
      afterSwipe.paused === false, `paused=${afterSwipe.paused}`);
  } else {
    console.log('  ○ the post reached by the swipe is a photo — no playback to transfer');
  }

  if (SHOOT) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, `autoplay-${W}-after-cycles.png`) });
  }

  console.log(`\n  ${pass} passed, ${fail} failed\n`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
