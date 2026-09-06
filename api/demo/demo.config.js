/**
 * Demo dataset configuration.
 *
 * Everything the two phases are allowed to differ on lives here, so changing the
 * size of the dataset never means editing a script. The defaults produce
 * 8 themes x 2 accounts x (4 photo + 3 video) = 16 accounts and 112 posts.
 *
 * Phase 1 (`yarn demo:fetch-media`) reads this to decide how much media to
 * fetch. Phase 2 (`yarn demo:seed`) reads it to decide how much to build, and
 * refuses to start if the manifest on disk cannot cover it.
 */

const path = require('path');

const THEMES = require('./themes');

/** Where downloaded media and the manifest live. Git-ignored. */
const MEDIA_DIR = path.join(__dirname, 'media');
const MANIFEST_PATH = path.join(MEDIA_DIR, 'manifest.json');

module.exports = {
  MEDIA_DIR,
  MANIFEST_PATH,

  /** Themes to build. Trim this array to build a smaller dataset. */
  themes: THEMES,

  /**
   * The post mix, per account.
   *
   * The platform is a video platform, so the dataset is 90% video. The split
   * between landscape and portrait is deliberate too: the product had only ever
   * been exercised with vertical clips, and a feed card is a 16:9 box, so
   * landscape is the majority case and the one most likely to expose layout
   * problems.
   *
   * These are the only place the numbers live. Nothing downstream hardcodes a
   * count, a ratio, or an orientation; `demo:verify` recomputes its expectations
   * from here, so changing a number changes what is built *and* what is checked.
   */
  counts: {
    /** Landscape videos per account, preferring ~16:9. */
    landscapeVideosPerAccount: 6,
    /** Portrait videos per account, preferring ~9:16. */
    portraitVideosPerAccount: 3,
    /** Single-photo posts per account. */
    photoPostsPerAccount: 1,
    /**
     * Posts each account pins to the top of its own list.
     *
     * One for most accounts, two for a share of them so that ordering *between*
     * pinned posts is actually exercised rather than assumed. The product sets
     * no upper bound, so neither does this -- but a dataset where every account
     * pinned everything would show nothing about ordering.
     */
    pinnedPostsPerAccount: 1,
    /** Fraction of accounts that pin a second post, so pinned ordering is testable. */
    twoPinnedAccountRatio: 0.35,
    /**
     * Accounts to build, at minimum.
     *
     * The real number is whatever it takes to give every *active* category its
     * own account, floored at this value — see `resolveAccountPlan`. A category
     * added to the product therefore raises the account count on the next run
     * rather than silently going uncovered.
     */
    minAccounts: 16
  },

  /**
   * Spare media kept beyond what the dataset consumes, as a ratio.
   *
   * Not a rejection allowance — a rejected file is discarded before it counts,
   * so the fetch keeps going until enough *valid* files exist regardless of this
   * number. It is purely a spare-parts buffer, so that a file which later fails
   * to upload does not send you back to the network.
   *
   * It was 0.35, which kept half a gigabyte of video that nothing ever reads.
   * 0.1 leaves roughly one spare per slot, which is what a buffer is for.
   */
  fetchOverheadRatio: 0.1,

  /**
   * Politeness. Both providers publish generous limits (Pexels 25k/hour), and
   * neither is the reason these exist: a seeder that opens 100 sockets at once
   * is rude regardless of what the quota allows.
   */
  network: {
    /** Minimum gap between two search calls to the same provider, ms. */
    searchIntervalMs: 350,
    /** Minimum gap between two file downloads, ms. */
    downloadIntervalMs: 250,
    /** Concurrent downloads. Deliberately low. */
    downloadConcurrency: 3,
    /** Per-request timeout, ms. Videos are large; this is the whole transfer. */
    requestTimeoutMs: 180000,
    /** Retries for a transient failure (5xx, socket error, timeout). */
    maxRetries: 3,
    retryBaseDelayMs: 1200,
    /**
     * Stop calling a provider when its published remaining-quota header drops
     * below this. Leaves room for whatever else uses the same key.
     */
    rateLimitFloor: 50
  },

  /** Bounds applied on top of the project's upload policies. */
  media: {
    photo: {
      /** Post photos are shown in a vertical feed. */
      minAspect: 0.5,
      maxAspect: 0.85,
      minWidth: 720,
      minHeight: 1000
    },
    cover: {
      /**
       * Profile covers are wide. 1.45 rather than 1.5 so an exactly-3:2 photo —
       * the single most common landscape crop there is — lands inside the range
       * instead of on its boundary, where float comparison decides it.
       */
      minAspect: 1.45,
      maxAspect: 3.2,
      minWidth: 1400
    },
    /**
     * Landscape video: wide, and close to 16:9.
     *
     * The upper bound keeps out ultra-wide cinema crops, which letterbox badly
     * in a 16:9 card; the lower bound keeps out 4:3, which is neither shape.
     * Orientation is decided from the real decoded dimensions, never from the
     * search filter that found the clip.
     */
    videoLandscape: {
      minAspect: 1.5,
      maxAspect: 2.1,
      minWidth: 960,
      minHeight: 540,
      minDurationMs: 4000,
      maxDurationMs: 30000,
      maxBytes: 30 * 1024 * 1024,
      /**
       * 1280x720 is already more than a feed card ever shows, and ninety-six
       * landscape clips at 1920 would roughly double the cache for pixels
       * nobody sees.
       */
      preferredMaxWidth: 1280
    },
    /** Portrait video: tall, and close to 9:16. */
    videoPortrait: {
      minAspect: 0.4,
      maxAspect: 0.85,
      minWidth: 540,
      minHeight: 900,
      minDurationMs: 4000,
      /**
       * Short-form, deliberately well inside the 10-minute policy limit. A
       * 75-second clip is both unrepresentative of the product and, at these
       * bitrates, ninety megabytes on its own.
       */
      maxDurationMs: 30000,
      /**
       * Dataset byte ceiling, enforced in `validate.js` alongside the shape
       * checks. Distinct from the 500MB the `post-video` policy permits: that
       * is what the product accepts, this is what a demo cache is worth. Without
       * it the eight themes come to roughly 1.5GB of video.
       */
      maxBytes: 30 * 1024 * 1024,
      /**
       * Preferred rendition width. The policy allows 4K, but a vertical feed
       * card never shows more than 1080 across, so anything larger is bytes
       * nobody sees.
       */
      preferredMaxWidth: 1080
    },
    /** Generated avatars. Not fetched — drawn locally from a stable seed. */
    avatar: {
      size: 512
    }
  },

  seed: {
    /**
     * Marks every account this tool creates. Also the prefix of the ledger, so
     * two datasets built from different namespaces never collide.
     */
    namespace: 'demo',

    /**
     * Shared password for every demo account, so the dataset can be logged into.
     *
     * **This is a local fixture, and it is committed to a public repository — so
     * it is a password in name only.** It stays because local seeding and
     * `demo:verify` need a deterministic login.
     *
     * It is NOT the production credential, and the earlier claim here that
     * production "never runs this script" was wrong: production *was* seeded
     * from it. The seeded production accounts have since been rotated to a value
     * held only in `deploy/.env` as `DEMO_ACCOUNT_PASSWORD`, by
     * `api/scripts/rotate-demo-passwords.js`.
     *
     * Changing this constant does not affect any account that already exists —
     * `seedAccounts` hashes it into the `auth` collection at seed time, so it
     * only ever governs a future seed.
     */
    password: 'demodemo',

    /** Email domain for demo accounts. Reserved by RFC 2606, never deliverable. */
    emailDomain: 'demo.invalid',

    /** Posts are backdated across this many days ending now. */
    postWindowDays: 90,

    /**
     * Notifications, conversations and messages.
     *
     * The conversation graph is a ring with chords rather than every pair:
     * every account gets at least two threads, traffic in both directions and an
     * unread one, while the row count stays linear in the number of accounts
     * instead of quadratic.
     */
    social: {
      /**
       * The account a person signs in as to check the dataset by hand. It gets
       * one thread of every reachable state on top of its ring threads.
       */
      primaryUsername: 'maitran.eats',
      /** How far back conversations start. */
      conversationWindowDays: 45,
      /**
       * Share of each account's notifications that are already read.
       *
       * Never all of them: `demo:verify` requires every account to have at least
       * one unread, because an inbox with a zero badge tests nothing.
       */
      notificationsReadRatio: 0.45,
      /** Comments that carry an @mention, as a share of all comments. */
      mentionRatio: 0.12,
      /** Comments that receive at least one like. */
      commentLikeRatio: 0.35
    },

    interactions: {
      /** Follows each demo account makes, picked per account in this range. */
      followsPerAccount: [3, 11],
      /** Chance a same-theme account is preferred when picking who to follow. */
      sameThemeFollowBias: 0.55,
      /** Likes per post, before popularity skew. */
      likesPerPost: [0, 12],
      /** Fraction of posts that become "popular" and attract most likes. */
      popularPostRatio: 0.18,
      /** Comments per post. */
      commentsPerPost: [0, 5],
      /** Chance a comment gets a reply. */
      replyChance: 0.28,
      /** Shares per post. */
      sharesPerPost: [0, 3]
    }
  }
};
