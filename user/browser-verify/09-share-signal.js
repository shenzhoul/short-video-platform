/**
 * Browser pass 9 — the share signal, end to end (§1).
 *
 * A shares a post from For You into a real conversation; B receives it and
 * opens it. The chain asserted is:
 *
 *   UI share success -> message id -> recommendation request -> accepted event
 *   -> stats/affinity
 *
 * The controls come from `SharePopover`, which opens on hover and offers
 * `Share with <name>` per recipient plus a separate `Copy the link`. Copying a
 * link is deliberately *not* a share in this product, and the popover merely
 * opening is not one either — both are checked as negatives.
 */

// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [require('path').resolve(__dirname, '..', '..', 'api')]
}));
const {
  chromium, USER_APP, openContext, signIn, waitForEvent, check, summarise
} = require('./lib/harness');

const ACCOUNT_A = process.env.RECO_ACCOUNT_A || 'maitran.eats@demo.invalid';
const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';

const decayed = (entry) => {
  if (!entry?.score) return 0;
  const ageDays = Math.max(0, (Date.now() - new Date(entry.updatedAt).getTime()) / 86400000);
  return entry.score * Math.exp((-Math.LN2 * ageDays) / 14);
};

/** Opens the share popover and returns its recipient buttons. */
async function openSharePopover(page) {
  const rail = page.locator('aside').first();
  const buttons = rail.locator('button');
  const labels = await buttons.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('title')
    || n.getAttribute('aria-label') || n.textContent.trim().slice(0, 20)));
  const shareIndex = labels.findIndex((l) => /^share$/i.test(l || ''));
  await buttons.nth(shareIndex).hover();
  await page.waitForTimeout(2000);
  return { shareIndex, buttons };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const a = await openContext(browser, 'A');
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  try {
    await signIn(a, ACCOUNT_A);
    const actorA = await db.collection('users').findOne({ email: ACCOUNT_A }, { projection: { _id: 1, username: 1 } });

    await a.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await a.page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
    await a.page.waitForTimeout(3000);

    // 2. A valid exposure must exist before anything is shared.
    const impressions = await waitForEvent(a, 'impression', 20000);
    const postId = impressions[impressions.length - 1]?.postId;
    const sessionId = impressions[impressions.length - 1]?.sessionId;
    check('the post on screen produced a real impression', Boolean(postId),
      `post ${postId}, session ${String(sessionId).slice(0, 8)}…`);
    const impressionRow = await db.collection('recommendation_events').findOne({
      userId: actorA._id, postId: new ObjectId(postId), eventType: 'impression'
    });
    check('that impression is persisted', Boolean(impressionRow), `row ${impressionRow?._id}`);

    const statBefore = await db.collection('post_recommendation_stats').findOne({ postId: new ObjectId(postId) });
    const affinityBefore = await db.collection('user_recommendation_affinities').findOne({ subjectId: actorA._id.toString() });
    const messagesBefore = await db.collection('messages').countDocuments({ type: 'post', postId: new ObjectId(postId) });

    // ---------------------------------------------------------------
    console.log('\n=== Negative: opening the popover is not a share ===');
    const sharesBeforePopover = a.eventsOfType('share').length;
    const { shareIndex, buttons } = await openSharePopover(a.page);
    await a.shot('22-share-popover-open');
    await a.page.waitForTimeout(6000);
    check('merely opening the share popover sends no share signal',
      a.eventsOfType('share').length === sharesBeforePopover,
      `${a.eventsOfType('share').length - sharesBeforePopover} sent`);

    console.log('\n=== Negative: copying the link is not a share ===');
    const copyButton = a.page.locator('button[aria-label="Copy the link"]').first();
    if (await copyButton.isVisible().catch(() => false)) {
      const before = a.eventsOfType('share').length;
      await copyButton.click({ force: true });
      await a.page.waitForTimeout(7000);
      check('copying the link sends no share signal',
        a.eventsOfType('share').length === before,
        `${a.eventsOfType('share').length - before} sent`);
    } else {
      console.log('  ~ copy control not present in this popover');
    }

    // ---------------------------------------------------------------
    console.log('\n=== 1. Sharing into a real conversation ===');
    await buttons.nth(shareIndex).hover();
    await a.page.waitForTimeout(1500);
    const recipient = a.page.locator('button[aria-label^="Share with "]').first();
    await recipient.waitFor({ state: 'visible', timeout: 10000 });
    const recipientLabel = await recipient.getAttribute('aria-label');
    console.log(`  recipient: ${recipientLabel}`);

    const sharesBefore = a.eventsOfType('share').length;
    await recipient.click({ force: true });
    await a.page.waitForTimeout(2500);
    await a.shot('23-share-sent');

    // 5. The share must have produced a real message.
    let messageRow = null;
    for (let i = 0; i < 20 && !messageRow; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      messageRow = await db.collection('messages').findOne({
        type: 'post', postId: new ObjectId(postId), senderId: actorA._id
      }, { sort: { createdAt: -1 } });
      // eslint-disable-next-line no-await-in-loop
      if (!messageRow) await a.page.waitForTimeout(700);
    }
    check('the share created a real shared-post message', Boolean(messageRow),
      messageRow ? `message ${messageRow._id} in conversation ${messageRow.conversationId}` : 'none');
    const messagesAfter = await db.collection('messages').countDocuments({ type: 'post', postId: new ObjectId(postId) });
    check('exactly one new shared-post message exists for this post',
      messagesAfter === messagesBefore + 1, `${messagesBefore} -> ${messagesAfter}`);

    // 8/9. Exactly one share signal, accepted.
    await waitForEvent(a, 'share', 20000);
    await a.page.waitForTimeout(3000);
    const shares = a.eventsOfType('share');
    check('sharing sent exactly one recommendation share signal',
      shares.length === sharesBefore + 1, `${shares.length - sharesBefore} sent`);
    const shareEvent = shares[shares.length - 1];
    check('the share signal names the post that was shared',
      shareEvent?.postId === postId, `${shareEvent?.postId} vs ${postId}`);
    check('the share signal carries the session it was seen in',
      shareEvent?.sessionId === sessionId, `${String(shareEvent?.sessionId).slice(0, 8)}…`);
    check('the server accepted the share signal',
      (shareEvent?.verdict?.accepted || 0) > 0, JSON.stringify(shareEvent?.verdict));

    // 10. Stats and affinity moved.
    const statAfter = await db.collection('post_recommendation_stats').findOne({ postId: new ObjectId(postId) });
    check('the share reached the post stats',
      (statAfter?.weightedEngagement || 0) > (statBefore?.weightedEngagement || 0),
      `weightedEngagement ${(statBefore?.weightedEngagement || 0)} -> ${statAfter?.weightedEngagement}`);
    const affinityAfter = await db.collection('user_recommendation_affinities').findOne({ subjectId: actorA._id.toString() });
    const post = await db.collection('posts').findOne({ _id: new ObjectId(postId) }, { projection: { topicKey: 1, userId: 1 } });
    const before = decayed(affinityBefore?.categoryScores?.[post.topicKey]);
    const after = decayed(affinityAfter?.categoryScores?.[post.topicKey]);
    check(`the share moved the viewer's '${post.topicKey}' affinity`, after > before,
      `${before.toFixed(3)} -> ${after.toFixed(3)}`);

    // 4/11. Attribution and retry safety, checked at the row level.
    const shareRows = await db.collection('recommendation_events').countDocuments({
      userId: actorA._id, postId: new ObjectId(postId), sessionId, eventType: 'share'
    });
    check('exactly one share event row exists for this exposure', shareRows === 1, `${shareRows} rows`);
    check('the share row is attributed to the acting account',
      Boolean(await db.collection('recommendation_events').findOne({
        userId: actorA._id, postId: new ObjectId(postId), eventType: 'share'
      })), `actor ${actorA.username}`);

    console.log('\n=== 11. A retried batch does not add a second share ===');
    const retry = await a.page.evaluate(async ([apiBase, pid, sid]) => {
      const token = document.cookie.split('; ').find((c) => c.startsWith('token='))?.split('=')[1];
      const response = await fetch(`${apiBase}/posts/recommendation-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: decodeURIComponent(token || '') },
        body: JSON.stringify({ events: [{ postId: pid, sessionId: sid, eventType: 'share', source: 'for-you' }] })
      });
      const body = await response.json();
      return body?.data || body;
    }, [process.env.API || 'http://localhost:8080', postId, sessionId]);
    check('replaying the same share batch is deduped, not counted again',
      retry.accepted === 0 && retry.deduped === 1, JSON.stringify(retry));
    const statAfterRetry = await db.collection('post_recommendation_stats').findOne({ postId: new ObjectId(postId) });
    check('the retry left the stats untouched',
      (statAfterRetry?.weightedEngagement || 0) === (statAfter?.weightedEngagement || 0),
      `weightedEngagement stayed ${statAfterRetry?.weightedEngagement}`);

    // ---------------------------------------------------------------
    console.log('\n=== Sharing the same post again (production behaviour) ===');
    /*
     * `totalShare` counts distinct sharers, so a second share of the same post
     * by the same person is a real message that moves no counter — and
     * `SharePopover` raises `onShared` only for a *counted* share. No second
     * signal is therefore the correct outcome, not a missing one.
     *
     * This was observed the hard way: an earlier run of this scenario landed
     * on a post a previous run had already shared, measured "no signal", and
     * looked exactly like the genuine wiring bug that had just been fixed.
     */
    const messagesBeforeResh = await db.collection('messages').countDocuments({
      type: 'post', postId: new ObjectId(postId), senderId: actorA._id
    });
    const sharesBeforeResh = a.eventsOfType('share').length;
    await buttons.nth(shareIndex).hover();
    await a.page.waitForTimeout(1500);
    const secondRecipient = a.page.locator('button[aria-label^="Share with "]').nth(1);
    if (await secondRecipient.isVisible().catch(() => false)) {
      const secondLabel = await secondRecipient.getAttribute('aria-label');
      await secondRecipient.click({ force: true });
      await a.page.waitForTimeout(9000);
      const messagesAfterResh = await db.collection('messages').countDocuments({
        type: 'post', postId: new ObjectId(postId), senderId: actorA._id
      });
      check('re-sharing the same post still delivers a real second message',
        messagesAfterResh === messagesBeforeResh + 1,
        `${secondLabel}: ${messagesBeforeResh} -> ${messagesAfterResh} messages`);
      check('but raises no second share signal, because the counter did not move',
        a.eventsOfType('share').length === sharesBeforeResh,
        `${a.eventsOfType('share').length - sharesBeforeResh} extra signal(s)`);
      const shareRowsAfterResh = await db.collection('recommendation_events').countDocuments({
        userId: actorA._id, postId: new ObjectId(postId), sessionId, eventType: 'share'
      });
      check('and the stored share event count is unchanged', shareRowsAfterResh === 1,
        `${shareRowsAfterResh} row(s)`);
    } else {
      console.log('  ~ only one recipient available; the re-share case was not exercised');
    }

    // ---------------------------------------------------------------
    console.log('\n=== 6/7. B receives it and it opens the right post ===');
    const conversation = await db.collection('conversations').findOne({ _id: messageRow.conversationId });
    const participants = await db.collection('conversation_participants').find({
      conversationId: messageRow.conversationId
    }).project({ userId: 1 }).toArray();
    const otherId = participants.map((p) => p.userId.toString()).find((id) => id !== actorA._id.toString());
    const recipientUser = await db.collection('users').findOne({ _id: new ObjectId(otherId) }, { projection: { email: 1, username: 1 } });
    check('the message landed in a conversation with a real second participant',
      Boolean(recipientUser), `recipient ${recipientUser?.username}`);
    void conversation;

    const b = await openContext(browser, 'B');
    await signIn(b, recipientUser.email);
    await b.page.goto(`${USER_APP}/messages`, { waitUntil: 'domcontentloaded' });
    await b.page.waitForTimeout(6000);
    await b.shot('24-recipient-messages');

    /*
     * `.last()`, not `.first()`. This thread already carried seeded shared
     * posts, so the first card is an older one — clicking it opened a
     * different post and the assertion below read that as the wrong post
     * being opened. The message just sent is the newest, at the bottom.
     */
    const preview = b.page.locator('text=[Post]');
    const previews = await preview.count();
    const cardSelector = 'button[aria-label^="Open post:"], button[aria-label="Open shared post"]';
    let card = b.page.locator(cardSelector).last();
    let opened = await card.isVisible().catch(() => false);
    for (let i = 0; i < previews && !opened; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await preview.nth(i).click({ force: true }).catch(() => {});
      // eslint-disable-next-line no-await-in-loop
      await b.page.waitForTimeout(2500);
      card = b.page.locator(cardSelector).last();
      // eslint-disable-next-line no-await-in-loop
      opened = await card.isVisible().catch(() => false);
    }
    if (opened) {
      // Scroll the newest message into view before clicking it.
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await b.page.waitForTimeout(800);
    }
    check('the recipient sees the shared post in their thread', opened,
      opened ? 'card visible' : `${previews} previews, none opened`);

    if (opened) {
      await b.shot('25-recipient-thread');
      await card.click({ force: true });
      await b.page.waitForFunction(() => window.location.search.includes('modal_id'), { timeout: 15000 });
      await b.page.waitForTimeout(3000);
      const url = new URL(b.page.url());
      check('it opens the post that was actually shared',
        url.searchParams.get('modal_id') === postId,
        `${url.searchParams.get('modal_id')} vs ${postId}`);
      check('and is tagged as a message-originated open',
        url.searchParams.get('modal_src') === 'message',
        `modal_src=${url.searchParams.get('modal_src')}`);
      await b.shot('26-recipient-opened-shared-post');
    }

    console.log('\n=== Chain ===');
    console.log(`  UI share success   -> recipient ${recipientLabel}`);
    console.log(`  message id         -> ${messageRow._id}`);
    console.log(`  recommendation req -> share ${postId} in session ${String(sessionId).slice(0, 8)}…`);
    console.log(`  accepted event     -> ${JSON.stringify(shareEvent.verdict)}`);
    console.log(`  stats              -> weightedEngagement ${(statBefore?.weightedEngagement || 0)} -> ${statAfter.weightedEngagement}`);
    console.log(`  affinity           -> '${post.topicKey}' ${before.toFixed(3)} -> ${after.toFixed(3)}`);

    check('no context had an event rejected',
      a.totals().rejected === 0 && b.totals().rejected === 0,
      `A ${JSON.stringify(a.totals())}, B ${JSON.stringify(b.totals())}`);
    await b.close();
  } finally {
    await mongo.close();
    await a.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 9: share signal');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
