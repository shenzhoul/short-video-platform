/**
 * Turns the manifest plus the theme content into a complete, deterministic plan
 * for the dataset — before a single document is written.
 *
 * Planning first, separately from executing, buys two things:
 *
 *  - **A real preflight.** "There are not enough videos for the fashion theme"
 *    is discovered while nothing has been created, rather than two hundred
 *    uploads in with half a dataset on disk.
 *  - **Idempotency that does not depend on the database.** Every seed key,
 *    caption, timestamp and file assignment is derived from stable inputs, so
 *    the second run plans exactly the same dataset as the first and finds every
 *    piece of it already present.
 *
 * ## No file is used twice
 *
 * Media is sorted by checksum (stable, content-derived, independent of the order
 * the fetch happened to return) and sliced per account. Two accounts therefore
 * cannot be handed the same file by construction rather than by a check — and
 * `assertNoSharedMedia` verifies it anyway, because "by construction" is a claim
 * that stops being true the moment someone edits the slicing.
 */

const { createRandom } = require('./random');

/** Deterministic order for a slot's media: content hash, not fetch order. */
const byChecksum = (entries) => [...entries].sort((a, b) => a.checksum.localeCompare(b.checksum));

/**
 * Publication times for one account's posts.
 *
 * Spread across the window with an evening bias, because a feed where every post
 * landed at 04:12 reads as generated. Times are sorted ascending and made
 * strictly distinct, so ordering by `createdAt` is stable and a profile's grid
 * has a real chronology.
 */
function publicationTimes(random, count, windowDays, now) {
  const times = [];
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  for (let i = 0; i < count; i += 1) {
    // Bias towards the recent half: a demo profile should look active now, not
    // uniformly spread across three months.
    const skewed = random.next() ** 1.4;
    const daysAgo = skewed * windowDays;
    // Evening hours carry most real posting activity.
    const hour = random.chance(0.55) ? random.int(17, 23) : random.int(8, 16);
    const at = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    at.setHours(hour, random.int(0, 59), random.int(0, 59), 0);
    // Guard the window edges after the hour was forced.
    const clamped = Math.min(Math.max(at.getTime(), now.getTime() - windowMs), now.getTime() - 60000);
    times.push(clamped);
  }

  times.sort((a, b) => a - b);
  // Force strict distinctness so createdAt ordering is total.
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] <= times[i - 1]) times[i] = times[i - 1] + 61000;
  }
  return times.map((t) => new Date(t));
}

/**
 * Build the whole plan.
 *
 * @returns `{ ok: true, plan }` or `{ ok: false, problems }` — every problem
 *   that can be found is collected rather than thrown one at a time, so one run
 *   tells you everything that needs fixing.
 */
function buildPlan({ config, themes, index }) {
  const problems = [];
  const accounts = [];
  const now = new Date();

  const perAccount = {
    photos: config.counts.photoPostsPerAccount,
    landscape: config.counts.landscapeVideosPerAccount,
    portrait: config.counts.portraitVideosPerAccount
  };
  const videosPerAccount = perAccount.landscape + perAccount.portrait;

  for (const theme of themes) {
    const themeAccounts = theme.accounts || [];
    if (themeAccounts.length === 0) {
      problems.push(`theme '${theme.key}' defines no accounts, so category '${theme.topicKey}' gets no coverage.`);
      continue;
    }

    const photos = byChecksum(index.forSlot(theme.key, 'post-photo'));
    const landscape = byChecksum(index.forSlot(theme.key, 'post-video-landscape'));
    const portrait = byChecksum(index.forSlot(theme.key, 'post-video-portrait'));
    const covers = byChecksum(index.forSlot(theme.key, 'cover'));
    const avatars = index.forSlot(theme.key, 'avatar');

    const needPhotos = themeAccounts.length * perAccount.photos;
    const needLandscape = themeAccounts.length * perAccount.landscape;
    const needPortrait = themeAccounts.length * perAccount.portrait;
    const needCovers = themeAccounts.length;

    if (photos.length < needPhotos) problems.push(shortfall(theme, 'post-photo', photos.length, needPhotos));
    if (landscape.length < needLandscape) problems.push(shortfall(theme, 'post-video-landscape', landscape.length, needLandscape));
    if (portrait.length < needPortrait) problems.push(shortfall(theme, 'post-video-portrait', portrait.length, needPortrait));
    if (covers.length < needCovers) problems.push(shortfall(theme, 'cover', covers.length, needCovers));
    if (theme.photoCaptions.length < needPhotos) {
      problems.push(`theme '${theme.key}' has ${theme.photoCaptions.length} photo captions but needs ${needPhotos}. Add lines to demo/themes.js — repeating one would be visible in the feed.`);
    }
    if (theme.videoCaptions.length < themeAccounts.length * videosPerAccount) {
      problems.push(`theme '${theme.key}' has ${theme.videoCaptions.length} video captions but needs ${themeAccounts.length * videosPerAccount}.`);
    }
    if (problems.length > 0) continue;

    themeAccounts.forEach((persona, accountIndex) => {
      const avatar = avatars.find((entry) => entry.sourceMediaId === persona.username);
      if (!avatar) {
        problems.push(`no generated avatar for '${persona.username}'. Re-run yarn demo:fetch-media.`);
        return;
      }

      const random = createRandom(`plan:${theme.key}:${persona.username}`);
      const slice = (items, per) => items.slice(accountIndex * per, (accountIndex + 1) * per);

      const photoSlice = slice(photos, perAccount.photos);
      const landscapeSlice = slice(landscape, perAccount.landscape);
      const portraitSlice = slice(portrait, perAccount.portrait);
      const photoCaptions = slice(theme.photoCaptions, perAccount.photos);
      const videoCaptions = slice(theme.videoCaptions, videosPerAccount);

      const times = publicationTimes(
        random,
        photoSlice.length + landscapeSlice.length + portraitSlice.length,
        config.seed.postWindowDays,
        now
      );

      // Interleave rather than "all photos then all videos", so a profile grid
      // and the chronological feed both look like someone actually posting.
      // Video captions come from one pool across both orientations: a caption is
      // about the subject, not about the shape of the frame.
      const videoDraft = [...landscapeSlice, ...portraitSlice].map((media, i) => ({
        kind: 'video', media, caption: videoCaptions[i]
      }));
      const draft = [
        ...photoSlice.map((media, i) => ({ kind: 'photo', media, caption: photoCaptions[i] })),
        ...videoDraft
      ];
      const ordered = random.shuffle(draft).map((post, i) => ({
        ...post,
        seedKey: `post:${persona.username}:${i}`,
        publishedAt: times[i],
        topicKey: theme.topicKey
      }));

      /*
       * Which of this account's posts are pinned.
       *
       * Chosen here, in the plan, from the account's own seeded generator — so
       * the answer is a property of the plan and is identical on every run. The
       * seeder must never decide this by looking at what is already pinned in
       * the database; that is the mistake that made the showcase threads grow on
       * a second seed (see `ringAndChordPartnersOf`).
       *
       * The primary account is guaranteed one pinned photo *and* one pinned
       * video, because it is the account a person signs in as to look at the
       * dataset, and both cases need to be visible there.
       */
      const isPrimary = persona.username === config.seed.social.primaryUsername;
      const wantsTwo = isPrimary || random.chance(config.counts.twoPinnedAccountRatio);
      const pinCount = Math.max(
        config.counts.pinnedPostsPerAccount,
        wantsTwo ? 2 : config.counts.pinnedPostsPerAccount
      );

      const pinnedSeedKeys = [];
      if (isPrimary) {
        // One of each kind, so the primary account shows a pinned photo beside a
        // pinned video.
        const photoPost = ordered.find((post) => post.kind === 'photo');
        const videoPost = ordered.find((post) => post.kind === 'video');
        if (photoPost) pinnedSeedKeys.push(photoPost.seedKey);
        if (videoPost) pinnedSeedKeys.push(videoPost.seedKey);
      }
      // Fill the rest by drawing from the account's posts. Drawn unconditionally
      // and from the plan's own order, never from what is stored.
      for (const post of random.shuffle([...ordered])) {
        if (pinnedSeedKeys.length >= pinCount) break;
        if (!pinnedSeedKeys.includes(post.seedKey)) pinnedSeedKeys.push(post.seedKey);
      }

      /*
       * `pinnedAt` orders pinned posts among themselves, newest pin first. Given
       * a fixed offset per position so the ordering is deterministic and the
       * pins read as having happened after the posts they promote.
       */
      const pinnedAtBySeedKey = new Map(
        pinnedSeedKeys.map((seedKey, index) => [
          seedKey,
          new Date(now.getTime() - (index + 1) * 60 * 60 * 1000)
        ])
      );
      for (const post of ordered) {
        post.isPinned = pinnedAtBySeedKey.has(post.seedKey);
        post.pinnedAt = pinnedAtBySeedKey.get(post.seedKey) || null;
      }

      accounts.push({
        themeKey: theme.key,
        themeLabel: theme.label,
        topicKey: theme.topicKey,
        accountIndex,
        seedKey: `user:${theme.key}:${persona.username}`,
        username: persona.username,
        name: persona.name,
        bio: persona.bio,
        email: `${persona.username.replace(/[^a-z0-9]/gi, '.')}@${config.seed.emailDomain}`.toLowerCase(),
        avatar,
        cover: covers[accountIndex],
        posts: ordered,
        commentPool: theme.comments
      });
    });
  }

  if (problems.length > 0) return { ok: false, problems };

  const duplicate = assertNoSharedMedia(accounts);
  if (duplicate) return { ok: false, problems: [duplicate] };

  return {
    ok: true,
    plan: {
      accounts,
      totals: {
        accounts: accounts.length,
        posts: accounts.reduce((n, a) => n + a.posts.length, 0),
        photoPosts: accounts.reduce((n, a) => n + a.posts.filter((p) => p.kind === 'photo').length, 0),
        videoPosts: accounts.reduce((n, a) => n + a.posts.filter((p) => p.kind === 'video').length, 0),
        landscapeVideos: accounts.reduce((n, a) => n + a.posts.filter((p) => p.kind === 'video' && p.media.orientation === 'landscape').length, 0),
        portraitVideos: accounts.reduce((n, a) => n + a.posts.filter((p) => p.kind === 'video' && p.media.orientation === 'portrait').length, 0)
      }
    }
  };
}

/**
 * No two accounts, and no two posts, may reference the same bytes.
 *
 * Checked on the checksum rather than the path, so the same photograph saved
 * under two names is still caught.
 */
function assertNoSharedMedia(accounts) {
  const seen = new Map();
  const claim = (checksum, owner) => {
    if (seen.has(checksum)) {
      return `media reuse: ${owner} and ${seen.get(checksum)} were both assigned the same file (${checksum.slice(0, 12)}…)`;
    }
    seen.set(checksum, owner);
    return null;
  };

  for (const account of accounts) {
    const conflicts = [
      claim(account.avatar.checksum, `${account.username} avatar`),
      claim(account.cover.checksum, `${account.username} cover`),
      ...account.posts.map((post) => claim(post.media.checksum, `${account.username} ${post.seedKey}`))
    ].filter(Boolean);
    if (conflicts.length > 0) return conflicts[0];
  }
  return null;
}

const shortfall = (theme, purpose, have, need) => `theme '${theme.key}' has ${have} ${purpose} file(s) but needs ${need}. Run: yarn demo:fetch-media --themes=${theme.key}`;

module.exports = { buildPlan, publicationTimes, byChecksum };
