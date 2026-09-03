/**
 * Focused diagnostics for R3 (detail sequence dead-ends) and R4 (Videos tab
 * creator mixing).
 *
 * R3's first pass showed the server *did* hand out a third post while the Next
 * control stayed disabled, so this records every `/posts/**` call with its
 * status, plus the modal's own view of the sequence, to find where the post is
 * lost between the response and the arrow.
 */

const path = require('path');
// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [path.resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

function trace(ctx) {
  const calls = [];
  const logs = [];
  ctx.page.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) logs.push(`[${message.type()}] ${message.text().slice(0, 300)}`);
  });
  ctx.page.on('response', async (response) => {
    const url = response.url();
    if (!/\/posts\/|\/users\//.test(url) || /recommendation-events/.test(url)) return;
    const row = {
      url: url.replace(/^https?:\/\/[^/]+/, '').slice(0, 130),
      status: response.status()
    };
    try {
      const json = await response.json();
      const data = json?.data;
      row.postId = data?.postId;
      row.hasFiles = Array.isArray(data?.files) ? data.files.length : undefined;
      row.fileTypes = Array.isArray(data?.files) ? data.files.map((file) => file?.type) : undefined;
      row.fileUrls = Array.isArray(data?.files) ? data.files.map((file) => Boolean(file?.url)) : undefined;
      row.listIds = Array.isArray(data?.data) ? data.data.map((post) => post._id) : undefined;
      row.listCreators = Array.isArray(data?.data) ? [...new Set(data.data.map((post) => post.user?._id))] : undefined;
    } catch { /* not JSON */ }
    calls.push(row);
  });
  return { calls, logs };
}

async function openFirstHomePost(ctx) {
  await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
  await ctx.page.locator('article[data-post-id]').first().waitFor({ state: 'visible', timeout: 25000 });
  await ctx.page.waitForTimeout(2000);
  await ctx.page.locator('article[data-post-id]').first().click({ position: { x: 120, y: 80 } });
  await ctx.page.waitForFunction(() => window.location.search.includes('modal_id'), { timeout: 20000 });
  await ctx.page.waitForTimeout(2500);
}

async function detailDepth(browser, db) {
  console.log('\n########## R3  detail sequence — full trace ##########');
  const ctx = await openContext(browser, 'A');
  const probe = trace(ctx);
  try {
    await signIn(ctx, ACCOUNT);
    await openFirstHomePost(ctx);

    for (let step = 0; step < 8; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      const id = new URL(ctx.page.url()).searchParams.get('modal_id');
      // eslint-disable-next-line no-await-in-loop
      const post = await db.collection('posts').findOne({ _id: new ObjectId(id) }, { projection: { type: 1, userId: 1, fileIds: 1 } });
      const next = ctx.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      const enabled = await next.isEnabled().catch(() => false);
      console.log(`  step ${step}: post=${id} type=${post?.type} fileIds=${post?.fileIds?.length} nextEnabled=${enabled}`);
      if (!enabled) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.page.waitForTimeout(8000);
        // eslint-disable-next-line no-await-in-loop
        const retry = await next.isEnabled().catch(() => false);
        console.log(`    after 8s: nextEnabled=${retry}`);
        if (!retry) break;
      }
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(2500);
    }

    console.log('\n  every /posts call, in order:');
    probe.calls.forEach((row) => console.log(
      `    ${row.status} ${row.url}`
      + `${row.postId ? ` -> postId=${row.postId}` : ''}`
      + `${row.hasFiles !== undefined ? ` files=${row.hasFiles} types=${JSON.stringify(row.fileTypes)} urls=${JSON.stringify(row.fileUrls)}` : ''}`
    ));
    console.log(`  console: ${JSON.stringify(probe.logs.slice(0, 6))}`);
  } finally {
    await ctx.close();
  }
}

async function creatorTab(browser, db) {
  console.log('\n########## R4  Videos tab — full trace ##########');
  const ctx = await openContext(browser, 'A');
  const probe = trace(ctx);
  try {
    await signIn(ctx, ACCOUNT);
    await openFirstHomePost(ctx);

    const anchorId = new URL(ctx.page.url()).searchParams.get('modal_id');
    const anchor = await db.collection('posts').findOne({ _id: new ObjectId(anchorId) });
    const anchorUser = await db.collection('users').findOne({ _id: anchor?.userId });
    console.log(`  anchor ${anchorId} creator=${anchor?.userId} @${anchorUser?.username} type=${anchor?.type}`);

    // Enumerate what is clickable on the rail so the gesture is the real one.
    const controls = await ctx.page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label]'))
      .map((node) => node.getAttribute('aria-label'))
      .filter((label) => /details|Comment|Share|Collect|Follow/i.test(label)));
    console.log(`  rail controls: ${JSON.stringify(controls)}`);

    const avatar = ctx.page.locator('button[aria-label$="details"]').first();
    console.log(`  avatar aria-label: ${await avatar.getAttribute('aria-label').catch(() => null)}`);
    await avatar.click({ timeout: 10000 }).catch((error) => console.log(`  avatar click failed: ${error.message.slice(0, 120)}`));
    await ctx.page.waitForTimeout(4000);
    await ctx.shot('37-repro-after-avatar-click');

    const panelAfter = await ctx.page.evaluate(() => ({
      tabs: Array.from(document.querySelectorAll('[role="tab"], button')).map((node) => node.textContent?.trim()).filter((text) => text && text.length < 24).slice(0, 30),
      header: document.querySelector('[data-panel-creator-id]')?.getAttribute('data-panel-creator-id') || null,
      tiles: Array.from(document.querySelectorAll('button[data-post-id]')).map((node) => node.getAttribute('data-creator-id'))
    }));
    console.log(`  after avatar click: header=${panelAfter.header} tiles=${panelAfter.tiles.length}`);
    console.log(`  visible labels: ${JSON.stringify(panelAfter.tabs)}`);

    // If the grid is not up yet, use the explicit Videos tab.
    if (!panelAfter.tiles.length) {
      const videosTab = ctx.page.getByText(/^videos$/i).first();
      if (await videosTab.isVisible().catch(() => false)) {
        await videosTab.click();
        await ctx.page.waitForTimeout(4000);
      }
    }

    const readPanel = () => ctx.page.evaluate(() => ({
      header: document.querySelector('[data-panel-creator-id]')?.getAttribute('data-panel-creator-id') || null,
      tiles: Array.from(document.querySelectorAll('button[data-post-id]')).map((node) => ({
        postId: node.getAttribute('data-post-id'), creatorId: node.getAttribute('data-creator-id')
      }))
    }));

    let panel = await readPanel();
    console.log(`  grid open: header=${panel.header} tiles=${panel.tiles.length} creators=${JSON.stringify([...new Set(panel.tiles.map((tile) => tile.creatorId))])}`);
    await ctx.shot('33-repro-videos-tab-open');

    for (let step = 1; step <= 8; step += 1) {
      const next = ctx.page.locator('button[aria-label="Next post"]').first();
      // eslint-disable-next-line no-await-in-loop
      if (!await next.isEnabled().catch(() => false)) { console.log(`  next disabled at step ${step}`); break; }
      // eslint-disable-next-line no-await-in-loop
      await next.click();
      // eslint-disable-next-line no-await-in-loop
      await ctx.page.waitForTimeout(700);
      // eslint-disable-next-line no-await-in-loop
      panel = await readPanel();
      // eslint-disable-next-line no-await-in-loop
      const currentId = new URL(ctx.page.url()).searchParams.get('modal_id');
      // eslint-disable-next-line no-await-in-loop
      const current = await db.collection('posts').findOne({ _id: new ObjectId(currentId) }, { projection: { userId: 1, type: 1 } });
      const creators = [...new Set(panel.tiles.map((tile) => tile.creatorId))];
      const mismatch = creators.filter(Boolean).some((id) => id !== current?.userId?.toString());
      console.log(`  step ${step}: post=${currentId} postCreator=${current?.userId} header=${panel.header} tiles=${panel.tiles.length} gridCreators=${JSON.stringify(creators)} MISMATCH=${mismatch}`);
      if (mismatch) {
        // eslint-disable-next-line no-await-in-loop
        await ctx.shot(`35-repro-creator-mixed-step${step}`);
      }
    }

    await ctx.page.waitForTimeout(6000);
    panel = await readPanel();
    const currentId = new URL(ctx.page.url()).searchParams.get('modal_id');
    const current = await db.collection('posts').findOne({ _id: new ObjectId(currentId) }, { projection: { userId: 1 } });
    const creators = [...new Set(panel.tiles.map((tile) => tile.creatorId))];
    console.log(`\n  settled: post=${currentId} creator=${current?.userId} header=${panel.header} gridCreators=${JSON.stringify(creators)}`);
    console.log(`  SURVIVES SETTLING: ${creators.filter(Boolean).some((id) => id !== current?.userId?.toString())}`);
    await ctx.shot('36-repro-creator-settled');

    console.log('\n  creator-list calls:');
    probe.calls.filter((row) => row.listIds).forEach((row) => console.log(`    ${row.status} ${row.url} -> ${row.listIds.length} posts, creators=${JSON.stringify(row.listCreators)}`));
  } finally {
    await ctx.close();
  }
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  try {
    await detailDepth(browser, mongo.db());
    await creatorTab(browser, mongo.db());
  } finally {
    await mongo.close();
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
