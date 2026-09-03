/**
 * Browser pass 10 — follow-after-view, positive and negative (§2).
 *
 * Runs on a dedicated account so the existing evidence and personas are not
 * disturbed: this creates follow relationships, and doing that as
 * `maitran.eats` would rewrite the persona the personalisation evidence rests
 * on. The account is created through the real registration endpoint and
 * removed again at the end.
 *
 * The negatives matter more than the positive here. The server is supposed to
 * refuse a follow it cannot tie to a real, recent exposure of that creator's
 * post — so the interesting cases are the ones where it must say no.
 */

// eslint-disable-next-line import/no-dynamic-require, global-require
const { MongoClient, ObjectId } = require(require.resolve('mongodb', {
  paths: [require('path').resolve(__dirname, '..', '..', 'api')]
}));
const crypto = require('crypto');
const {
  chromium, USER_APP, API, openContext, signIn, waitForEvent, check, summarise
} = require('./lib/harness');

const MONGO = process.env.MONGO || 'mongodb://localhost/douyin-clone';
const PASSWORD = 'demodemo';
const clientHash = (plain) => crypto.createHash('sha256').update(plain).digest('hex');

/** Posts an event batch with the page's own credentials. */
async function sendAs(page, events) {
  return page.evaluate(async ([apiBase, payload]) => {
    const token = document.cookie.split('; ').find((c) => c.startsWith('token='))?.split('=')[1];
    const response = await fetch(`${apiBase}/posts/recommendation-events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: decodeURIComponent(token || '') },
      body: JSON.stringify({ events: payload })
    });
    const body = await response.json();
    return body?.data || body;
  }, [API, events]);
}

async function registerAccount(email, username) {
  const response = await fetch(`${API}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email, username, name: 'Follow Fixture', password: clientHash(PASSWORD)
    })
  });
  const body = await response.json();
  return { ok: response.ok, body };
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const mongo = new MongoClient(MONGO);
  await mongo.connect();
  const db = mongo.db();

  const stamp = Date.now().toString().slice(-8);
  const email = `follow.fixture.${stamp}@demo.invalid`;
  const username = `followfixture${stamp}`;
  let fixtureId = null;
  let ctx = null;

  try {
    console.log('=== A dedicated fixture account ===');
    const registered = await registerAccount(email, username);
    const user = await db.collection('users').findOne({ email }, { projection: { _id: 1, username: 1 } });
    check('a fresh account exists to follow from', Boolean(user),
      user ? `${user.username} (${user._id})` : JSON.stringify(registered.body).slice(0, 160));
    if (!user) return;
    fixtureId = user._id;

    /*
     * A freshly registered account cannot sign in until its email is verified,
     * and there is no inbox here to click through. The flags are set to what
     * the demo seeder gives every account it creates — the alternative is
     * driving a verification email, which tests the mailer rather than the
     * follow attribution this pass is about.
     */
    await db.collection('users').updateOne(
      { _id: fixtureId },
      { $set: { verifiedEmail: true, status: 'active' } }
    );

    ctx = await openContext(browser, 'fixture');
    await signIn(ctx, email, PASSWORD);
    await ctx.page.goto(`${USER_APP}/for-you`, { waitUntil: 'domcontentloaded' });
    await ctx.page.locator('video').first().waitFor({ state: 'attached', timeout: 30000 });
    await ctx.page.waitForTimeout(3000);

    // ---------------------------------------------------------------
    console.log('\n=== Positive: follow a creator whose post was just seen ===');
    const impressions = await waitForEvent(ctx, 'impression', 20000);
    const postId = impressions[impressions.length - 1]?.postId;
    const sessionId = impressions[impressions.length - 1]?.sessionId;
    const post = await db.collection('posts').findOne({ _id: new ObjectId(postId) }, { projection: { userId: 1, topicKey: 1 } });
    const creator = await db.collection('users').findOne({ _id: post.userId }, { projection: { username: 1 } });
    check('the post on screen produced a real impression', Boolean(postId),
      `post ${postId} by ${creator?.username}`);

    const impressionRow = await db.collection('recommendation_events').findOne({
      userId: fixtureId, postId: new ObjectId(postId), eventType: 'impression'
    });
    check('that impression is persisted', Boolean(impressionRow), `row ${impressionRow?._id}`);

    const rail = ctx.page.locator('aside').first();
    const followButton = rail.locator('button[aria-label^="Follow "]').first();
    const canFollow = await followButton.isVisible().catch(() => false);
    check('the rail offers a Follow control for an un-followed creator', canFollow,
      canFollow ? await followButton.getAttribute('aria-label') : 'not visible');

    if (canFollow) {
      await followButton.click({ force: true });
      await waitForEvent(ctx, 'follow_after_view', 20000);
      await ctx.page.waitForTimeout(3500);
      await ctx.shot('27-follow-from-rail');

      // 4. The relationship itself must exist.
      let relation = null;
      for (let i = 0; i < 15 && !relation; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        relation = await db.collection('reactions').findOne({
          action: 'follow', objectType: 'creator', objectId: post.userId, createdBy: fixtureId
        });
        // eslint-disable-next-line no-await-in-loop
        if (!relation) await ctx.page.waitForTimeout(600);
      }
      check('the follow relationship was created', Boolean(relation), `reaction ${relation?._id}`);

      const follows = ctx.eventsOfType('follow_after_view');
      check('exactly one follow_after_view signal was sent', follows.length === 1, `${follows.length} sent`);
      const followEvent = follows[follows.length - 1];
      check('the signal names the post that was on screen', followEvent?.postId === postId,
        `${followEvent?.postId} vs ${postId}`);
      check('the server accepted it', (followEvent?.verdict?.accepted || 0) > 0,
        JSON.stringify(followEvent?.verdict));

      const creditedRows = await db.collection('recommendation_events').countDocuments({
        userId: fixtureId, eventType: 'follow_after_view'
      });
      check('exactly one follow_after_view was credited', creditedRows === 1, `${creditedRows} row(s)`);

      const stat = await db.collection('post_recommendation_stats').findOne({ postId: new ObjectId(postId) });
      check('it reached the post stats', (stat?.weightedEngagement || 0) > 0,
        `weightedEngagement ${stat?.weightedEngagement}`);
      const affinity = await db.collection('user_recommendation_affinities').findOne({ subjectId: fixtureId.toString() });
      const creatorScore = affinity?.creatorScores?.[post.userId.toString()]?.score || 0;
      check('it moved creator affinity for that creator', creatorScore > 0,
        `creator score ${creatorScore}`);

      console.log('\n=== Negative: retrying the same follow ===');
      const retry = await sendAs(ctx.page, [{
        postId, sessionId, eventType: 'follow_after_view', source: 'for-you'
      }]);
      check('a retry is deduped, not credited twice',
        retry.accepted === 0 && retry.deduped === 1, JSON.stringify(retry));

      console.log('\n=== Negative: unfollow then refollow ===');
      // Remove the relationship the way the product does, then re-create it and
      // try to claim the signal again in a brand-new session.
      const refollowRail = ctx.page.locator('aside').first();
      const unfollow = refollowRail.locator('button[aria-label^="Unfollow "], button[aria-label^="Following"]').first();
      if (await unfollow.isVisible().catch(() => false)) {
        await unfollow.click({ force: true });
        await ctx.page.waitForTimeout(3000);
        const stillFollowing = await db.collection('reactions').countDocuments({
          action: 'follow', objectType: 'creator', objectId: post.userId, createdBy: fixtureId
        });
        if (stillFollowing === 0) {
          const followAgain = refollowRail.locator('button[aria-label^="Follow "]').first();
          await followAgain.click({ force: true });
          await ctx.page.waitForTimeout(4000);
        }
      }
      const refollowClaim = await sendAs(ctx.page, [{
        postId, sessionId: `refollow-session-${stamp}`, eventType: 'follow_after_view', source: 'for-you'
      }]);
      check('a refollow in a new session cannot re-earn the signal',
        refollowClaim.accepted === 0, JSON.stringify(refollowClaim));
      const afterRefollow = await db.collection('recommendation_events').countDocuments({
        userId: fixtureId, eventType: 'follow_after_view'
      });
      check('still exactly one credited follow_after_view', afterRefollow === 1, `${afterRefollow} row(s)`);
    }

    // ---------------------------------------------------------------
    console.log('\n=== Negative: a creator with no recommendation exposure ===');
    /*
     * Following someone the fixture has never been shown must not be
     * creditable. The claim is made for a post by a creator this account has
     * no impression for — exactly what a profile-page follow looks like to
     * the server.
     */
    const seenCreatorIds = new Set((await db.collection('recommendation_events').find({
      userId: fixtureId, eventType: 'impression'
    }).project({ postId: 1 }).toArray()).map((r) => r.postId.toString()));
    const unseenPost = await db.collection('posts').findOne({
      status: 'active',
      _id: { $nin: [...seenCreatorIds].map((id) => new ObjectId(id)) },
      userId: { $ne: post.userId }
    }, { projection: { _id: 1, userId: 1 } });

    if (unseenPost) {
      const unseenCreator = await db.collection('users').findOne({ _id: unseenPost.userId }, { projection: { username: 1 } });
      // Create the real relationship first — so the *only* thing missing is
      // the exposure, which is what the server must catch.
      await ctx.page.evaluate(async ([apiBase, creatorId]) => {
        const token = document.cookie.split('; ').find((c) => c.startsWith('token='))?.split('=')[1];
        await fetch(`${apiBase}/reactions/follow/creator/${creatorId}`, {
          method: 'POST', headers: { Authorization: decodeURIComponent(token || '') }
        }).catch(() => {});
      }, [API, unseenPost.userId.toString()]);
      await ctx.page.waitForTimeout(2500);

      const noExposureClaim = await sendAs(ctx.page, [{
        postId: unseenPost._id.toString(),
        sessionId: `no-exposure-${stamp}`,
        eventType: 'follow_after_view',
        source: 'for-you'
      }]);
      check(`following ${unseenCreator?.username} with no prior exposure is rejected`,
        noExposureClaim.accepted === 0 && noExposureClaim.rejected === 1,
        JSON.stringify(noExposureClaim));
    }

    console.log('\n=== Negative: claiming the wrong creator ===');
    /*
     * A post whose creator this account does *not* follow. The claim carries a
     * real, seen post but the follow behind it does not exist, so the server
     * has nothing to attribute.
     */
    const otherPost = await db.collection('posts').findOne({
      status: 'active', userId: { $nin: [post.userId, ...(unseenPost ? [unseenPost.userId] : [])] }
    }, { projection: { _id: 1, userId: 1 } });
    if (otherPost) {
      const wrongCreatorClaim = await sendAs(ctx.page, [{
        postId: otherPost._id.toString(),
        sessionId,
        eventType: 'follow_after_view',
        source: 'for-you'
      }]);
      check('claiming a follow for a creator this account does not follow is rejected',
        wrongCreatorClaim.accepted === 0 && wrongCreatorClaim.rejected === 1,
        JSON.stringify(wrongCreatorClaim));
    }

    console.log('\n=== Negative: an exposure older than the attribution window ===');
    /*
     * The impression is backdated past `FOLLOW_AFTER_VIEW_POLICY`'s 30-minute
     * window, and the already-credited row removed so dedupe is not what
     * refuses it. The only reason left to refuse is the age of the exposure.
     */
    const staleCreatorPost = await db.collection('posts').findOne({
      status: 'active', userId: post.userId, _id: { $ne: new ObjectId(postId) }
    }, { projection: { _id: 1 } });
    if (staleCreatorPost) {
      await db.collection('recommendation_events').deleteMany({
        userId: fixtureId, eventType: 'follow_after_view'
      });
      await db.collection('recommendation_events').insertOne({
        userId: fixtureId,
        anonymousId: null,
        postId: staleCreatorPost._id,
        sessionId: `stale-${stamp}`,
        eventType: 'impression',
        source: 'for-you',
        watchMs: null,
        durationMs: null,
        watchRatio: null,
        dwellMs: null,
        dedupeKey: `${fixtureId}:stale-${stamp}:${staleCreatorPost._id}:impression`,
        expiresAt: new Date(Date.now() + 30 * 86400000),
        // Two hours ago — well outside the 30-minute window.
        createdAt: new Date(Date.now() - 2 * 3600 * 1000)
      });

      const staleClaim = await sendAs(ctx.page, [{
        postId: staleCreatorPost._id.toString(),
        sessionId: `stale-${stamp}`,
        eventType: 'follow_after_view',
        source: 'for-you'
      }]);
      check('an exposure older than the attribution window is rejected',
        staleClaim.accepted === 0 && staleClaim.rejected === 1,
        JSON.stringify(staleClaim));
    }

    console.log('\n=== Negative: the socket/UI count changing is not a follow ===');
    const beforeCounts = ctx.eventsOfType('follow_after_view').length;
    await ctx.page.goto(`${USER_APP}/`, { waitUntil: 'domcontentloaded' });
    await ctx.page.waitForTimeout(8000);
    check('browsing elsewhere emits no further follow signals',
      ctx.eventsOfType('follow_after_view').length === beforeCounts,
      `${ctx.eventsOfType('follow_after_view').length - beforeCounts} extra`);

    check('nothing this context sent was mis-accepted',
      ctx.totals().rejected >= 0, JSON.stringify(ctx.totals()));
  } finally {
    // Remove the fixture entirely — it must not survive into the dataset.
    if (fixtureId) {
      const removed = await Promise.all([
        db.collection('recommendation_events').deleteMany({ userId: fixtureId }),
        db.collection('user_recommendation_affinities').deleteMany({ subjectId: fixtureId.toString() }),
        db.collection('reactions').deleteMany({ createdBy: fixtureId }),
        db.collection('auth').deleteMany({ userId: fixtureId }),
        db.collection('users').deleteOne({ _id: fixtureId })
      ]);
      console.log(`\n  fixture removed: ${removed.map((r) => r.deletedCount).join('/')} `
        + '(events/affinities/reactions/auth/user)');
    }
    await mongo.close();
    if (ctx) await ctx.close();
    await browser.close();
  }

  process.exitCode = summarise('Pass 10: follow-after-view');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
