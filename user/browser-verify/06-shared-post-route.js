/**
 * Browser pass 6 — the shared-post message route (§6).
 *
 * Walks the real chain: open Messages, find a conversation carrying a shared
 * post, click the card, and check where it lands. The card is
 * `SharedPostCard`'s button, whose accessible name is "Open post: <caption>"
 * (or "Open shared post" when the post has no caption).
 */

// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient } = require(require.resolve('mongodb', {
  paths: [require('path').resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, waitForEvent, check, summarise
} = require('./lib/harness');

const ACCOUNT = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';
/*
 * `SharedPostCard`'s button is named "Open post: <caption>" (or "Open shared
 * post" when the post has no caption). The prefix alone is too loose — it also
 * matches the "Open post details" control elsewhere in the thread, which an
 * earlier run clicked instead and then waited forever for a modal.
 */
const SHARED_CARD = 'button[aria-label^="Open post:"], button[aria-label="Open shared post"]';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const ctx = await openContext(browser, 'A');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    // A shared post is a message of `type: 'post'` carrying a `postId`.
    const sharedMessages = await db.collection('messages').countDocuments({ type: 'post' });
    console.log(`the dataset carries ${sharedMessages} shared-post messages`);

    await signIn(ctx, ACCOUNT);
    await ctx.page.goto(`${USER_APP}/messages`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(6000);
    await ctx.shot('18-messages-list');

    /*
     * The conversation list previews a shared post as "[Post]", which is the
     * only thing in the list that says a thread contains one — the rows are
     * plain elements with no accessible name to match on.
     */
    let card = ctx.page.locator(SHARED_CARD).first();
    let found = await card.isVisible().catch(() => false);

    if (!found) {
      const withSharedPost = ctx.page.locator('text=[Post]');
      const previews = await withSharedPost.count();
      console.log(`  ${previews} conversation(s) preview a shared post`);
      for (let i = 0; i < previews && !found; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await withSharedPost.nth(i).click({ force: true, timeout: 8000 }).catch(() => {});
        // eslint-disable-next-line no-await-in-loop
        await ctx.page.waitForTimeout(3000);
        card = ctx.page.locator(SHARED_CARD).first();
        // eslint-disable-next-line no-await-in-loop
        found = await card.isVisible().catch(() => false);
      }
    }

    check('a conversation with a shared post was reachable in the UI', found,
      found ? 'shared-post card visible' : 'no card found after walking the thread list');
    if (!found) return;

    await ctx.shot('19-conversation-with-shared-post');
    const cardLabel = await card.getAttribute('aria-label');
    console.log(`  card: ${cardLabel}`);

    const before = new URL(ctx.page.url());
    await card.click({ force: true });
    await ctx.page.waitForFunction(() => window.location.search.includes('modal_id'), { timeout: 15000 });
    await ctx.page.waitForTimeout(3500);
    const after = new URL(ctx.page.url());
    const openedId = after.searchParams.get('modal_id');

    check('clicking the shared post opens a post detail', Boolean(openedId), `modal_id=${openedId}`);
    check('the open is tagged as message-originated',
      after.searchParams.get('modal_src') === 'message',
      `modal_src=${after.searchParams.get('modal_src')}`);
    check('it moved to a route that hosts the modal',
      after.pathname !== '/messages' || before.pathname !== '/messages',
      `${before.pathname} -> ${after.pathname}`);

    // It must be the *right* post — the one the message actually shared.
    const sharedByAnyId = await db.collection('messages').findOne({
      type: 'post',
      $expr: { $eq: [{ $toString: '$postId' }, openedId] }
    });
    check('the post opened is one genuinely shared in a message', Boolean(sharedByAnyId),
      sharedByAnyId ? `message ${sharedByAnyId._id}` : 'no message shares that post');

    const opens = await waitForEvent(ctx, 'detail_open', 20000);
    const latest = opens[opens.length - 1];
    check('the open reported a detail_open', Boolean(latest),
      latest ? `post ${latest.postId}, source ${latest.source}` : 'none');
    check('the detail_open names the opened post', latest?.postId === openedId,
      `${latest?.postId} vs ${openedId}`);
    check('an anchored detail session backs it',
      Boolean(latest?.sessionId), `session ${String(latest?.sessionId).slice(0, 8)}…`);
    await ctx.shot('20-shared-post-opened');

    // Next must come from the recommendation session, and previous from history.
    const nextButton = ctx.page.locator('button[aria-label="Next post"], button[title="Next post"]').first();
    if (await nextButton.isVisible().catch(() => false)) {
      await nextButton.click();
      await ctx.page.waitForTimeout(4000);
      const second = new URL(ctx.page.url()).searchParams.get('modal_id');
      check('next moves on from the shared post', Boolean(second) && second !== openedId,
        `${openedId} -> ${second}`);

      const prevButton = ctx.page.locator('button[aria-label="Previous post"], button[title="Previous post"]').first();
      await prevButton.click();
      await ctx.page.waitForTimeout(3500);
      const back = new URL(ctx.page.url()).searchParams.get('modal_id');
      check('previous returns to the shared post itself, from history', back === openedId,
        `${second} -> ${back}`);
      await ctx.shot('21-shared-post-navigated');
    } else {
      console.log('  ~ navigation controls not visible for this post');
    }

    // Closing must drop both params, so the tag never outlives the open.
    await ctx.page.keyboard.press('Escape');
    await ctx.page.waitForTimeout(2500);
    const closed = new URL(ctx.page.url());
    check('closing drops modal_id and modal_src together',
      !closed.searchParams.get('modal_id') && !closed.searchParams.get('modal_src'),
      `?${closed.searchParams.toString() || '(empty)'}`);

    console.log('\n=== Server verdicts ===');
    check('nothing the page sent was rejected', ctx.totals().rejected === 0,
      JSON.stringify(ctx.totals()));
  } finally {
    await mongo.close();
    await ctx.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 6: shared-post message route');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
