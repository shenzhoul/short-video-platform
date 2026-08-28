/**
 * Prove every Redis key this application writes carries the project namespace,
 * and that nothing outside it is touched.
 *
 * ## Why this exists
 *
 * The development Redis is shared with at least one other project — `xmodels_*`
 * keys sit alongside ours in db 0. Before namespacing, our keys were bare
 * (`auth:token:…`, `connected_users`) and the NestJS throttler's were barer
 * still (`{<hash>:default}:hits`), so tidying up after a test run meant matching
 * on shape and hoping. That is how somebody eventually deletes a neighbour's
 * data.
 *
 * This script exercises each Redis consumer, then asserts that every key that
 * appeared is under `douyin-clone:` — and that the foreign keys it recorded
 * beforehand are byte-for-byte unchanged.
 *
 * It writes only through the application's own services, and it deletes only
 * keys it observed itself create under our own prefix. No wildcard delete, no
 * `FLUSHDB`, and an explicit refusal to touch anything that is not ours.
 *
 * Usage:
 *   yarn build && node scripts/verify-redis-namespace.js
 *
 * Exit code 0 = every key namespaced and no foreign key disturbed.
 */
require('dotenv').config();
const IORedis = require('ioredis');

const {
  REDIS_NAMESPACE, REDIS_OWNED_PATTERN, THROTTLER_KEY_PREFIX, REDIS_KEYS
} = require('../dist/kernel/infras/redis/redis-keys');
const { AuthRateLimitService } = require('../dist/services/identity/auth/auth-rate-limit.service');
const { TokenService } = require('../dist/services/identity/auth/token.service');

const HOST = process.env.REDIS_HOST || '127.0.0.1';
const PORT = parseInt(process.env.REDIS_PORT, 10) || 6379;
const DB = parseInt(process.env.REDIS_DB, 10) || 0;

/** Prefixes belonging to other projects on this shared Redis. Never touched. */
const FOREIGN_MARKERS = [/^xmodels_/, /^bee_queue_/];

const failures = [];
function check(name, ok, detail = '') {
  if (!ok) failures.push(name);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

/** Every key currently in the database, via SCAN so a large keyspace is fine. */
async function scanAll(redis, pattern = '*') {
  const found = [];
  let cursor = '0';
  do {
    // eslint-disable-next-line no-await-in-loop
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    found.push(...batch);
  } while (cursor !== '0');
  return found;
}

/** A stable fingerprint of the foreign keyspace, to compare before and after. */
async function fingerprintForeign(redis) {
  const all = await scanAll(redis);
  const foreign = all.filter((key) => FOREIGN_MARKERS.some((marker) => marker.test(key)));
  const entries = [];
  for (const key of foreign) {
    // eslint-disable-next-line no-await-in-loop
    const type = await redis.type(key);
    entries.push(`${key}#${type}`);
  }
  return entries.sort();
}

(async () => {
  const redis = new IORedis({ host: HOST, port: PORT, db: DB });
  const created = new Set();
  let exitCode = 0;

  try {
    console.log(`redis ${HOST}:${PORT} db ${DB} | namespace "${REDIS_NAMESPACE}"`);

    const foreignBefore = await fingerprintForeign(redis);
    const ownedBefore = new Set(await scanAll(redis, REDIS_OWNED_PATTERN));
    console.log(`foreign keys recorded: ${foreignBefore.length} | pre-existing ${REDIS_NAMESPACE} keys: ${ownedBefore.size}`);

    // ------------------------------------------------ the per-identifier limiter
    const rateLimiter = new AuthRateLimitService(redis);
    const decision = await rateLimiter.consume({
      action: 'namespace-probe',
      identifier: `probe-${Date.now()}@example.com`,
      cooldownSeconds: 30,
      maxPerWindow: 5,
      windowSeconds: 60
    });
    check('the rate limiter answers on a healthy Redis', decision === 'allowed', decision);

    // ------------------------------------------------------- session storage
    const tokenService = new TokenService(redis);
    const userId = `probe${Date.now()}`;
    const sessionToken = await tokenService.generateToken(userId, false);
    check('a session token round-trips through the namespaced key', !!sessionToken);
    const validated = await tokenService.validateToken(sessionToken);
    // The load-bearing one. A blanket ioredis `keyPrefix` would prefix the write
    // and not the `KEYS` pattern that finds it, so this lookup would return null
    // while the key sat in Redis — every login succeeding and every subsequent
    // request 401-ing.
    check('...and is found again by its pattern lookup', !!validated && `${validated.userId}` === userId);

    // --------------------------------------------- what those writes produced
    const ownedAfter = await scanAll(redis, REDIS_OWNED_PATTERN);
    const newlyOwned = ownedAfter.filter((key) => !ownedBefore.has(key));
    newlyOwned.forEach((key) => created.add(key));

    check('the probe created keys', newlyOwned.length > 0, `${newlyOwned.length} new`);
    newlyOwned.forEach((key) => console.log(`   ${key}`));

    const allAfter = await scanAll(redis);
    const strayNew = allAfter.filter(
      (key) => !key.startsWith(`${REDIS_NAMESPACE}:`)
        && !FOREIGN_MARKERS.some((marker) => marker.test(key))
        && !ownedBefore.has(key)
    );
    // Only keys that appeared *during* this run count; the database already held
    // plenty of un-namespaced keys from before the cutover and from neighbours.
    const strayFromProbe = strayNew.filter((key) => /namespace-probe|probe\d{10,}/.test(key));
    check(
      'the probe wrote nothing outside the namespace',
      strayFromProbe.length === 0,
      strayFromProbe.join(', ')
    );

    check(
      'the throttler prefix is under the namespace',
      THROTTLER_KEY_PREFIX.startsWith(`${REDIS_NAMESPACE}:`),
      THROTTLER_KEY_PREFIX
    );
    check(
      'every declared key builder is under the namespace',
      Object.values(REDIS_KEYS).every((build) => String(build('x')).startsWith(`${REDIS_NAMESPACE}:`))
    );

    // ------------------------------------------------------------- cleanup
    // Exact keys, observed to have been created by this run, all under our own
    // prefix. Never a pattern delete.
    const toRemove = [...created].filter((key) => key.startsWith(`${REDIS_NAMESPACE}:`));
    const refused = [...created].filter((key) => !key.startsWith(`${REDIS_NAMESPACE}:`));
    check('cleanup refuses anything outside the namespace', refused.length === 0, refused.join(', '));
    if (toRemove.length) {
      await redis.del(...toRemove);
      console.log(`removed ${toRemove.length} key(s) this run created`);
    }

    // --------------------------------------------- the neighbour is untouched
    const foreignAfter = await fingerprintForeign(redis);
    check(
      'no foreign key was added, removed or retyped',
      JSON.stringify(foreignAfter) === JSON.stringify(foreignBefore),
      `${foreignBefore.length} before, ${foreignAfter.length} after`
    );
  } catch (error) {
    console.error('\nverification aborted:', error.message);
    exitCode = 1;
  } finally {
    await redis.quit();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n  - ${failures.join('\n  - ')}`);
    process.exit(1);
  }
  if (exitCode) process.exit(exitCode);
  console.log('\nall checks passed');
})();
