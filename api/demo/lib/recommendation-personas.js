/**
 * Who each demo account watches like, and which of the 160 posts are left
 * deliberately untouched so the recommender's cold-start path has something
 * real to work on.
 *
 * ## Personas are data, never a special case in the engine
 *
 * The recommender must never know a username. What differentiates these
 * accounts is only the *history they accumulated* — the same rows any real
 * viewer's watching would produce. So a persona here is nothing more than a
 * weighting over category keys, derived from the account's own theme plus a
 * small neighbour graph below, and its only output is a set of
 * `recommendation_events`. Delete the events and every account is identical
 * again, which is the property that proves the differentiation is genuinely
 * learned rather than configured.
 *
 * The neighbour graph is hand-authored because taste adjacency is a judgement
 * ("someone who watches food also watches travel"), not something derivable
 * from the category rows. It is keyed on the real, seeded category keys — the
 * 13 in `migrations/data/post-categories.js` — so a renamed category degrades
 * to "no secondary interests" rather than throwing.
 */

/**
 * Secondary interests per primary category, strongest first.
 *
 * `food -> travel, photography` is the worked example in the task spec, and
 * the rest follow the same reasoning: an adjacency someone would actually
 * recognise, not a random pair.
 */
const TOPIC_NEIGHBOURS = Object.freeze({
  food: ['travel', 'photography'],
  travel: ['photography', 'food'],
  music: ['film', 'lifestyle'],
  sports: ['lifestyle', 'knowledge'],
  animals: ['photography', 'lifestyle'],
  beauty: ['lifestyle', 'photography'],
  knowledge: ['games', 'film'],
  photography: ['travel', 'animals'],
  games: ['anime', 'knowledge'],
  anime: ['games', 'film'],
  film: ['music', 'anime'],
  lifestyle: ['food', 'beauty'],
  parenting: ['lifestyle', 'food']
});

/** How strongly a viewer engages with each tier of their taste. */
const TIER = Object.freeze({
  PRIMARY: 'primary',
  SECONDARY: 'secondary',
  OFF: 'off'
});

/**
 * The persona for one account: its own theme's category as the primary
 * interest, that category's neighbours as secondary, everything else off.
 *
 * Note that an account's persona is about what it *watches*, which is
 * deliberately independent of what it *posts* — they coincide here only
 * because someone who films street food does tend to watch it.
 */
function personaFor(account) {
  const primary = account.topicKey || null;
  const secondary = (TOPIC_NEIGHBOURS[primary] || []).slice(0, 2);
  return {
    username: account.username,
    primary,
    secondary,
    tierOf(topicKey) {
      if (topicKey && topicKey === primary) return TIER.PRIMARY;
      if (topicKey && secondary.includes(topicKey)) return TIER.SECONDARY;
      return TIER.OFF;
    }
  };
}

/**
 * Chooses the posts that stay cold: zero likes, comments and shares, and only
 * a handful of impressions, so the exploration path in
 * `RecommendationCandidateService`'s fresh bucket has genuine cold-start
 * candidates instead of a dataset where every post is already popular.
 *
 * Chosen by a stable rule rather than a random draw so the same posts are
 * cold on every seed and `demo:verify` can assert on them:
 *
 *  - one post per account, so no creator is disproportionately cold and the
 *    fresh bucket's per-creator share guard
 *    (`EXPLORATION_STAGES.MAX_SHARE_PER_CREATOR_IN_FRESH_BUCKET`) is exercised
 *    rather than trivially satisfied;
 *  - the account's own newest post, because a brand-new post with no
 *    engagement is what cold start actually looks like;
 *  - spread across categories automatically, since the accounts already are.
 *
 * @param plan The built plan; each account's `posts` are in publish order.
 * @returns A `Set` of `seedKey` strings.
 */
function coldStartSeedKeys(plan) {
  const keys = new Set();
  for (const account of plan.accounts) {
    const posts = account.posts || [];
    if (!posts.length) continue;
    // `posts` is in ascending publish order, so the last one is the newest.
    // A pinned post is skipped: pinning something with no engagement at all
    // reads as a mistake rather than as a new post.
    const candidates = posts.filter((post) => !post.isPinned);
    const newest = candidates[candidates.length - 1] || null;
    if (newest) keys.add(newest.seedKey);
  }
  return keys;
}

module.exports = {
  TOPIC_NEIGHBOURS, TIER, personaFor, coldStartSeedKeys
};
