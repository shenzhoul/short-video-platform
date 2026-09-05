/**
 * Every Redis key this application writes, under one project namespace.
 *
 * ## Why
 *
 * The development Redis is shared with at least one other project (`xmodels_*`
 * keys are visible in db 0). Before this module, our keys were bare — `auth:token:…`,
 * `connected_users`, `comment:stats:dirty` — and the NestJS throttler's were
 * barer still (`{<hash>:default}:hits`). Nothing in a key said which application
 * owned it, so tidying up after a test run meant matching on shape and hoping,
 * which is exactly how somebody eventually deletes another project's data.
 *
 * With a namespace, cleanup is `SCAN MATCH douyin-clone:*` and can never touch a
 * neighbour.
 *
 * ## Why not `ioredis`'s `keyPrefix`
 *
 * Because it would silently break sessions. `keyPrefix` is applied to key
 * *arguments* — `GET`, `SET`, `SADD` — but **not** to the pattern given to
 * `KEYS` or `SCAN`, and the names those return come back already prefixed.
 * `TokenService` looks sessions up with `redis.keys('auth:token:*:<token>')`, so
 * a blanket prefix would store `douyin-clone:auth:token:…` and then search for
 * `auth:token:…`, matching nothing. Every login would succeed and every
 * subsequent request would 401.
 *
 * Verified rather than assumed: with `keyPrefix: 'probe:'`, `set('k1')` stores
 * `probe:k1` while `keys('*')` returns `probe:k1` and `keys('k1')` returns
 * nothing.
 *
 * So application keys are prefixed **explicitly, here**, where the same constant
 * builds both the key and the pattern that finds it. `keyPrefix` is used in
 * exactly one place — the throttler's own client — because that library only
 * ever addresses keys through `EVAL`, and `EVAL` key arguments *are* prefixed
 * (including suffixes the Lua script appends to them, since it builds from the
 * already-prefixed `KEYS[1]`).
 *
 * ## Cutover
 *
 * Adding the namespace makes previously written keys unreachable: dev sessions,
 * the settings cache, online-presence sets and coalescer sets all start empty.
 * That is an intentional one-way cutover, not a migration. Old keys are left
 * alone — they carry TTLs or are rebuilt on demand, and deleting un-namespaced
 * keys in a shared Redis is the thing this module exists to stop.
 */

/** The one string that says these keys are ours. */
export const REDIS_NAMESPACE = process.env.REDIS_NAMESPACE || 'douyin-clone';

/** `douyin-clone:<group>:<rest>` */
function key(group: string, rest = ''): string {
  return rest ? `${REDIS_NAMESPACE}:${group}:${rest}` : `${REDIS_NAMESPACE}:${group}`;
}

export const REDIS_KEYS = {
  /** Redis-backed API session tokens. Looked up by pattern — see the note above. */
  session: (rest = '') => key('session', rest),
  /** Cached `AuthUserDto`, keyed by user id. */
  authUserCache: (userId: string) => key('auth-user', userId),
  /** Per-identifier mail cooldowns and windows. */
  authRateLimit: (rest: string) => key('auth-rate', rest),
  /** Distributed lock guarding the settings cache rebuild. */
  settingCacheLock: () => key('setting', 'cache-sync-lock'),
  /** Set of user ids currently holding a socket. */
  connectedUsers: () => key('socket', 'connected-users'),
  /** Per-user set of socket ids. */
  userSockets: (userId: string) => key('socket', `user:${userId}`),
  /** Coalescer working sets, flushed to Mongo on a schedule. */
  dirtyComments: () => key('stats', 'comment:dirty'),
  dirtyPosts: () => key('stats', 'post:dirty'),
  dirtyFollowUsers: () => key('stats', 'user-follow:dirty'),
  /** Share de-duplication marker. */
  sharePost: (rest: string) => key('share', `post:${rest}`),

  /** Ordered post-id list for one Home/For You recommendation feed session. */
  recoFeedSessionItems: (sessionId: string) => key('reco-feed', `${sessionId}:items`),
  /** Session metadata hash (subjectId, feedType, topicKey, sessionSeed, createdAt). */
  recoFeedSessionMeta: (sessionId: string) => key('reco-feed', `${sessionId}:meta`),
  /**
   * Every post id served by one *chain* of feed sessions.
   *
   * A chain is what a continuous scroll looks like on the server: the first
   * session is the root and each rollover creates a successor that inherits the
   * root's id. The set is the chain's seen-post exclusion, so a rollover starts
   * from what the viewer has *not* been shown rather than re-ranking the same
   * catalogue. Bounded by `FEED_SESSION_POLICY.maxChainSeenIds` and cleared
   * when the eligible corpus is exhausted (`RecommendationSessionService`).
   */
  recoFeedChainSeen: (chainId: string) => key('reco-feed', `chain:${chainId}:seen`),
  /** Ordered post-id list for one Post Detail recommendation session (Home/notification/direct-link anchors). */
  recoDetailSessionItems: (sessionId: string) => key('reco-detail', `${sessionId}:items`),
  /** Detail session metadata hash (subjectId, anchorPostId, cursorIndex, sessionSeed). */
  recoDetailSessionMeta: (sessionId: string) => key('reco-detail', `${sessionId}:meta`),
  /**
   * The post ids that recently led a feed for one subject, so a reload does not
   * open on the same post every time. Keyed by subject and feed type: Home and
   * For You rank differently and should not share a cooldown.
   */
  recoRecentHeroes: (feedType: string, subjectId: string) => key('reco-hero', `${feedType}:${subjectId}`)
} as const;

/**
 * `keyPrefix` for the throttler's dedicated ioredis client.
 *
 * Safe here and nowhere else: `@nest-lab/throttler-storage-redis` addresses its
 * counters only through `EVAL`, never `KEYS`/`SCAN`.
 */
export const THROTTLER_KEY_PREFIX = `${REDIS_NAMESPACE}:throttle:`;

/**
 * BullMQ's own namespace, passed as its `prefix` option.
 *
 * BullMQ does not use `keyPrefix` — it builds keys as `<prefix>:<queue>:<id>`
 * and needs the braces for Redis Cluster hash-tagging, so it gets its own
 * mechanism rather than an ioredis-level one.
 */
export const QUEUE_PREFIX_NAMESPACE = REDIS_NAMESPACE;

/** Everything this application may ever delete during a test cleanup. */
export const REDIS_OWNED_PATTERN = `${REDIS_NAMESPACE}:*`;
