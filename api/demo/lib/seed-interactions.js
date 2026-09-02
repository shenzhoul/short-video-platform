/**
 * Follows, likes, comments, replies and shares — the part that makes the feed
 * look inhabited rather than populated.
 *
 * ## Only demo accounts interact
 *
 * Every actor here is one of the accounts this tool created. Nothing follows,
 * likes or comments on a real user's content, and no real user is given a
 * follower they did not earn. That is not only politeness: `demo:clean` deletes
 * only rows the ledger names, so an interaction touching a real user's counters
 * would leave those counters wrong after a clean, with nothing to repair them.
 *
 * ## The distributions
 *
 * Uniform randomness produces a feed where every post has five likes, which
 * reads as fake immediately. Instead:
 *
 *  - **Follows** are biased towards the same theme, because people follow within
 *    an interest. Out-of-theme edges still happen, so the graph is connected
 *    rather than eight disjoint islands.
 *  - **Likes** follow a popularity split: a fifth of posts are "popular" and get
 *    a large multiple of the baseline. Real engagement is heavy-tailed.
 *  - **Comments** are drawn from the theme's own pool, so the text is about the
 *    subject; replies come from the post's author more often than not, which is
 *    what actually happens.
 *  - **Timestamps** are always after the post they belong to and before now, so
 *    nothing is liked before it was published.
 *
 * All of it is seeded from stable keys, so a second run produces the same graph
 * and the ledger finds every edge already present.
 */

const logger = require('./logger');
const { createRandom } = require('./random');
const { KINDS } = require('./ledger');

/** `REACTION_TYPES` / `REACTION_TARGET_TYPES` in api/src/common/constants. */
const REACTION = {
  LIKE: 'like', FOLLOW: 'follow', SHARE: 'share'
};
const TARGET = { POST: 'post', CREATOR: 'creator', COMMENT: 'comment' };
/** `COMMENT_OBJECT_TYPES`. */
const COMMENT_TARGET = { POST: 'post', COMMENT: 'comment' };

/** A time strictly between a post's publication and now. */
function timeAfter(random, publishedAt, now) {
  const span = now.getTime() - publishedAt.getTime();
  if (span <= 60000) return new Date(publishedAt.getTime() + 30000);
  // Weighted towards soon after publication, which is when engagement happens.
  return new Date(publishedAt.getTime() + Math.floor((random.next() ** 2) * span));
}

/** Insert a reaction once, keyed by the ledger. */
async function ensureReaction({
  db, ledger, seedKey, action, objectType, objectId, createdBy, createdAt
}) {
  const claim = await ledger.claim(KINDS.REACTION, seedKey, { action });
  if (await db.reactions.findOne({ _id: claim.refId })) return false;

  await db.reactions.insertOne({
    _id: claim.refId,
    action,
    objectType,
    objectId,
    createdBy,
    createdAt,
    updatedAt: createdAt
  });
  await ledger.activate(KINDS.REACTION, seedKey);
  return true;
}

async function seedFollows({
  plan, db, ledger, config, now
}) {
  const accounts = plan.accounts;
  const [minFollows, maxFollows] = config.seed.interactions.followsPerAccount;
  const bias = config.seed.interactions.sameThemeFollowBias;
  let created = 0;

  for (const account of accounts) {
    const random = createRandom(`follow:${account.username}`);
    const followerId = plan.userIds.get(account.username);

    const sameTheme = accounts.filter((a) => a.themeKey === account.themeKey && a.username !== account.username);
    const otherTheme = accounts.filter((a) => a.themeKey !== account.themeKey);

    const wanted = random.int(minFollows, maxFollows);
    const targets = new Set();
    // Draw one at a time so the theme bias applies per edge rather than
    // splitting the quota into two fixed buckets.
    for (let attempt = 0; attempt < wanted * 4 && targets.size < wanted; attempt += 1) {
      const pool = (random.chance(bias) && sameTheme.length > 0) ? sameTheme : otherTheme;
      if (pool.length === 0) continue;
      targets.add(random.pick(pool).username);
    }

    for (const targetUsername of targets) {
      const creatorId = plan.userIds.get(targetUsername);
      const wasCreated = await ensureReaction({
        db,
        ledger,
        seedKey: `follow:${account.username}->${targetUsername}`,
        action: REACTION.FOLLOW,
        objectType: TARGET.CREATOR,
        objectId: creatorId,
        createdBy: followerId,
        createdAt: new Date(now.getTime() - random.int(1, config.seed.postWindowDays * 24) * 3600000)
      });
      if (wasCreated) created += 1;
    }
  }

  return created;
}

async function seedPostEngagement({
  plan, postIndex, db, ledger, config, now
}) {
  // Both the interaction ratios and the social ratios are read here: a mention
  // and a comment like are interactions, they just happen to be the ones that
  // produce notification types nothing else would exercise.
  const settings = { ...config.seed.interactions, ...config.seed.social };
  const [minLikes, maxLikes] = settings.likesPerPost;
  const [minComments, maxComments] = settings.commentsPerPost;
  const [minShares, maxShares] = settings.sharesPerPost;

  const created = {
    likes: 0, comments: 0, replies: 0, shares: 0, commentLikes: 0
  };
  const commentPoolByTheme = new Map(
    plan.accounts.map((a) => [a.themeKey, a.commentPool])
  );

  for (const post of postIndex) {
    const random = createRandom(`engagement:${post.seedKey}`);
    // Everyone except the author. A self-like would be visible and wrong.
    const others = plan.accounts.filter((a) => a.username !== post.username);

    // Popularity split: a heavy tail rather than a flat distribution.
    const isPopular = random.chance(settings.popularPostRatio);
    const likeCount = isPopular
      ? Math.min(others.length, random.int(maxLikes, Math.max(maxLikes, others.length)))
      : random.int(minLikes, maxLikes);

    for (const liker of random.sample(others, likeCount)) {
      const wasCreated = await ensureReaction({
        db,
        ledger,
        seedKey: `like:${liker.username}->${post.seedKey}`,
        action: REACTION.LIKE,
        objectType: TARGET.POST,
        objectId: post.postId,
        createdBy: plan.userIds.get(liker.username),
        createdAt: timeAfter(random, post.publishedAt, now)
      });
      if (wasCreated) created.likes += 1;
    }

    const shareCount = isPopular ? random.int(1, maxShares + 2) : random.int(minShares, maxShares);
    for (const sharer of random.sample(others, Math.min(shareCount, others.length))) {
      const wasCreated = await ensureReaction({
        db,
        ledger,
        // Share reactions are created once per user per post and never removed,
        // so `totalShare` is a count of distinct sharers.
        seedKey: `share:${sharer.username}->${post.seedKey}`,
        action: REACTION.SHARE,
        objectType: TARGET.POST,
        objectId: post.postId,
        createdBy: plan.userIds.get(sharer.username),
        createdAt: timeAfter(random, post.publishedAt, now)
      });
      if (wasCreated) created.shares += 1;
    }

    const pool = commentPoolByTheme.get(post.themeKey) || [];
    const commentCount = Math.min(
      pool.length,
      isPopular ? random.int(2, maxComments + 2) : random.int(minComments, maxComments)
    );
    const commenters = random.sample(others, commentCount);
    const lines = random.sample(pool, commentCount);

    for (let i = 0; i < commenters.length; i += 1) {
      const commentSeedKey = `comment:${post.seedKey}:${i}`;
      const claim = await ledger.claim(KINDS.COMMENT, commentSeedKey, {});
      const commentedAt = timeAfter(random, post.publishedAt, now);

      /**
       * Some comments @-mention the post's author.
       *
       * Drawn unconditionally, before the database is consulted, for the reason
       * documented on the reply block below. The mention is of the author rather
       * than a random account so the comment reads as a reply to them, and the
       * text carries the handle because a mention with no handle in the body is
       * a notification pointing at nothing a reader can see.
       */
      const wantsMention = random.chance(settings.mentionRatio ?? 0);
      const mentionedUserIds = wantsMention ? [plan.userIds.get(post.username)] : [];
      const commentText = wantsMention
        ? `@${post.username} ${lines[i]}`
        : lines[i];

      if (!await db.comments.findOne({ _id: claim.refId })) {
        await db.comments.insertOne({
          _id: claim.refId,
          content: commentText,
          objectType: COMMENT_TARGET.POST,
          objectId: post.postId,
          totalReply: 0,
          totalLike: 0,
          mentionedUserIds,
          createdBy: plan.userIds.get(commenters[i].username),
          createdAt: commentedAt,
          updatedAt: commentedAt
        });
        await ledger.activate(KINDS.COMMENT, commentSeedKey);
        created.comments += 1;
      }

      /**
       * Comment likes, which are what `comment_like` notifications come from.
       *
       * Reactions on a comment use `objectType: 'comment'`, the same collection
       * and the same uniqueness index as post likes, so they de-duplicate the
       * same way.
       */
      const wantsCommentLike = random.chance(settings.commentLikeRatio ?? 0);
      const commentLikers = random.sample(
        others.filter((a) => a.username !== commenters[i].username),
        wantsCommentLike ? random.int(1, 4) : 0
      );
      for (const liker of commentLikers) {
        const wasCreated = await ensureReaction({
          db,
          ledger,
          seedKey: `commentlike:${liker.username}->${commentSeedKey}`,
          action: REACTION.LIKE,
          objectType: TARGET.COMMENT,
          objectId: claim.refId,
          createdBy: plan.userIds.get(liker.username),
          createdAt: timeAfter(random, commentedAt, now)
        });
        if (wasCreated) created.commentLikes += 1;
      }

      // A reply, usually from the post's author answering.
      //
      // Every draw below happens unconditionally, BEFORE the database is asked
      // whether the row already exists. That ordering is the whole reason this
      // is idempotent: a draw made inside an `if (!exists)` branch is skipped on
      // the second run, the generator's stream shifts, and every later decision
      // in this loop comes out differently — which is exactly how the first
      // version of this function produced 26 extra replies on a re-run while
      // reporting everything else as already present.
      //
      // The rule generalises: a seeded generator's stream must depend only on
      // the seed, never on what is in the database.
      const wantsReply = random.chance(settings.replyChance);
      const authorReplies = random.chance(0.7);
      const otherRepliers = others.filter((a) => a.username !== commenters[i].username);
      const replier = authorReplies || otherRepliers.length === 0
        ? post.username
        : random.pick(otherRepliers).username;
      const replyDelayMinutes = random.int(5, 2880);
      const replyContent = authorReplies ? random.pick(AUTHOR_REPLIES) : random.pick(pool);

      if (wantsReply) {
        const replySeedKey = `reply:${post.seedKey}:${i}`;
        const replyClaim = await ledger.claim(KINDS.COMMENT, replySeedKey, {});
        if (!await db.comments.findOne({ _id: replyClaim.refId })) {
          const repliedAt = new Date(Math.min(
            commentedAt.getTime() + replyDelayMinutes * 60000, now.getTime() - 60000
          ));
          await db.comments.insertOne({
            _id: replyClaim.refId,
            content: replyContent,
            objectType: COMMENT_TARGET.COMMENT,
            objectId: claim.refId,
            totalReply: 0,
            totalLike: 0,
            createdBy: plan.userIds.get(replier),
            createdAt: repliedAt,
            updatedAt: repliedAt
          });
          await ledger.activate(KINDS.COMMENT, replySeedKey);
          created.replies += 1;
        }
      }
    }
  }

  return created;
}

/** Short, generic acknowledgements a creator plausibly writes under their own post. */
const AUTHOR_REPLIES = [
  'Thank you! Means a lot.',
  'Appreciate you watching.',
  'Ha, glad it landed.',
  'Will do a longer one on this soon.',
  'Good question — I will cover it next time.',
  'Thanks! Took a few attempts.',
  'Yes! Exactly that.',
  'Cheers, more coming this week.'
];

async function seedInteractions({
  plan, postIndex, db, ledger, config
}) {
  const now = new Date();

  logger.detail('follows…');
  const follows = await seedFollows({
    plan, db, ledger, config, now
  });

  logger.detail('likes, comments, comment likes, mentions and shares…');
  const engagement = await seedPostEngagement({
    plan, postIndex, db, ledger, config, now
  });

  return { follows, ...engagement };
}

module.exports = {
  seedInteractions, seedFollows, seedPostEngagement, REACTION, TARGET
};
