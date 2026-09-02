/**
 * How many accounts exist, which category each covers, and what media each one
 * needs.
 *
 * Shared by both phases so they cannot disagree. `demo:fetch-media` uses it to
 * decide how much to download; `demo:seed` uses it to decide what to build and
 * checks the result against the live category catalogue; `demo:verify` uses it
 * to recompute what it should be seeing. Nothing downstream hardcodes a count.
 *
 * ## Coverage is structural, not a rule to remember
 *
 * One theme names one category, and every theme carries at least one account, so
 * every category a theme names is covered by construction. What the tooling adds
 * on top is the check in the other direction: `assertCategoryCoverage` compares
 * this plan against the categories that are actually active in the database, so
 * a category added to the product and not to `themes.js` fails the seed and the
 * verify rather than quietly going unrepresented.
 */

/** Posts one account publishes, derived from the configured mix. */
function postsPerAccount(config) {
  const { counts } = config;
  return counts.landscapeVideosPerAccount
    + counts.portraitVideosPerAccount
    + counts.photoPostsPerAccount;
}

/**
 * Media one theme needs, given how many accounts it hosts.
 *
 * Keyed by manifest purpose, which is also the key `demo:fetch-media` fills and
 * `plan.js` allocates from.
 */
function themeRequirements(config, accountCount) {
  const { counts } = config;
  return {
    'post-video-landscape': counts.landscapeVideosPerAccount * accountCount,
    'post-video-portrait': counts.portraitVideosPerAccount * accountCount,
    'post-photo': counts.photoPostsPerAccount * accountCount,
    cover: accountCount
  };
}

/**
 * Resolve the whole account plan from the themes file and the config.
 *
 * @returns `{ ok: true, plan }` or `{ ok: false, problems }` — every problem is
 *   collected, because a run that reports all of them is worth several that
 *   each report one.
 */
function resolveAccountPlan(config, themes) {
  const problems = [];
  const entries = [];

  const seenCategories = new Map();
  const seenUsernames = new Map();

  for (const theme of themes) {
    if (!theme.topicKey) {
      problems.push(`theme '${theme.key}' does not name a category (topicKey)`);
      continue;
    }
    if (seenCategories.has(theme.topicKey)) {
      problems.push(
        `themes '${seenCategories.get(theme.topicKey)}' and '${theme.key}' both claim category `
        + `'${theme.topicKey}'. One theme per category, so each account has one subject.`
      );
    }
    seenCategories.set(theme.topicKey, theme.key);

    const personas = theme.accounts || [];
    if (personas.length === 0) {
      problems.push(`theme '${theme.key}' has no accounts, so category '${theme.topicKey}' would have no coverage`);
      continue;
    }

    for (const persona of personas) {
      if (seenUsernames.has(persona.username)) {
        problems.push(`username '${persona.username}' is used by themes '${seenUsernames.get(persona.username)}' and '${theme.key}'`);
      }
      seenUsernames.set(persona.username, theme.key);
    }

    entries.push({
      theme,
      personas,
      requirements: themeRequirements(config, personas.length)
    });
  }

  const totalAccounts = entries.reduce((n, e) => n + e.personas.length, 0);
  if (totalAccounts < config.counts.minAccounts) {
    problems.push(
      `${totalAccounts} accounts across ${entries.length} themes, but minAccounts is `
      + `${config.counts.minAccounts}. Add personas to demo/themes.js, or lower minAccounts.`
    );
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    plan: {
      themes: entries,
      totalAccounts,
      postsPerAccount: postsPerAccount(config),
      totalPosts: totalAccounts * postsPerAccount(config),
      categories: [...seenCategories.keys()],
      /** Everything the fetch phase must have, summed across themes. */
      totals: entries.reduce((acc, entry) => {
        for (const [purpose, n] of Object.entries(entry.requirements)) {
          acc[purpose] = (acc[purpose] || 0) + n;
        }
        acc.avatar = (acc.avatar || 0) + entry.personas.length;
        return acc;
      }, {})
    }
  };
}

/**
 * Compare the plan against the categories that are actually active.
 *
 * @param activeCategoryKeys keys read from the `categories` collection
 * @returns `{ uncovered, unknown }` — categories with no demo content, and
 *   themes naming a category that is not active.
 */
function assertCategoryCoverage(plan, activeCategoryKeys) {
  const active = new Set(activeCategoryKeys);
  const claimed = new Set(plan.categories);

  return {
    uncovered: [...active].filter((key) => !claimed.has(key)),
    unknown: [...claimed].filter((key) => !active.has(key))
  };
}

module.exports = {
  resolveAccountPlan,
  assertCategoryCoverage,
  themeRequirements,
  postsPerAccount
};
