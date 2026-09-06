/*
 * READ-ONLY production probe for the Home recommendation chain (deploy-2026-09-06g).
 *
 * Runs inside the `api` container, which already has MONGO_URI, REDIS_HOST/PORT/
 * PASSWORD and both drivers. Opens no write, deletes nothing, and prints:
 * counts, TTLs and 6-character id prefixes only — never a token, a Redis
 * password, a full post id, a user id or any PII.
 *
 * Usage (on the VM):
 *   ANON=<the recommendation-subject cookie value from your browser> \
 *   docker compose -f deploy/docker-compose.yml --env-file deploy/.env \
 *     exec -T -e ANON api node - < probe-home-chain.js
 */
/* eslint-disable no-console */
const Redis = require('ioredis');
const { MongoClient, ObjectId } = require('mongodb');

const NS = process.env.REDIS_NAMESPACE || 'douyin-clone';
const SUBJECT = process.env.ANON || process.env.SUBJECT || '';

/** 6 characters is enough to correlate two lines; not enough to address anything. */
const fp = (v) => (v ? `${String(v).slice(0, 6)}…` : '(none)');
const pad = (label) => `${label}${' '.repeat(Math.max(0, 34 - label.length))}`;
const say = (label, value) => console.log(`  ${pad(label)} ${value}`);

async function main() {
  if (!SUBJECT) {
    console.error('Set ANON=<recommendation-subject cookie value>. Nothing was read.');
    process.exit(2);
  }

  const redis = new Redis({
    host: process.env.REDIS_HOST || 'redis',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD,
    lazyConnect: true,
    maxRetriesPerRequest: 2
  });
  await redis.connect();

  const mongo = new MongoClient(process.env.MONGO_URI);
  await mongo.connect();
  const db = mongo.db();
  const posts = db.collection('posts');
  const affinities = db.collection('user_recommendation_affinities');

  console.log('');
  console.log('=== SUBJECT ===');
  say('subject fingerprint', fp(SUBJECT));

  // ---------------------------------------------------------------- corpus
  const eligibleBase = { status: 'active', isCreatorDeleted: { $ne: true } };
  const eligibleTotal = await posts.countDocuments(eligibleBase);
  const videoTotal = await posts.countDocuments({
    ...eligibleBase, $or: [{ type: 'video' }, { mediaTypes: 'video' }]
  });
  const last14d = await posts.countDocuments({
    ...eligibleBase, createdAt: { $gte: new Date(Date.now() - 14 * 864e5) }
  });
  const last72h = await posts.countDocuments({
    ...eligibleBase, createdAt: { $gte: new Date(Date.now() - 3 * 864e5) }
  });

  console.log('');
  console.log('=== CORPUS (candidate count BEFORE any exclusion) ===');
  say('eligible posts', eligibleTotal);
  say('  of which video', videoTotal);
  say('  created within 14d (trending)', last14d);
  say('  created within 72h (fresh)', last72h);

  // ------------------------------------------------- cross-session seen set
  const affinity = await affinities.findOne(
    { subjectId: SUBJECT },
    { projection: { recentlySeenPostIds: 1, isAuthenticatedUser: 1, updatedAt: 1 } }
  );
  const seenEntries = (affinity && affinity.recentlySeenPostIds) || [];
  const seenDistinct = new Set(seenEntries.map((id) => String(id)));

  console.log('');
  console.log('=== AFFINITY recentlySeenPostIds (impression-driven, cap 200) ===');
  say('affinity row exists', affinity ? 'yes' : 'no');
  say('isAuthenticatedUser', affinity ? String(!!affinity.isAuthenticatedUser) : '-');
  say('entries (with repeats)', seenEntries.length);
  say('DISTINCT post ids', seenDistinct.size);
  say('last written', affinity && affinity.updatedAt ? affinity.updatedAt.toISOString() : '-');

  const afterAffinity = seenDistinct.size
    ? await posts.countDocuments({
      ...eligibleBase,
      _id: { $nin: [...seenDistinct].map((id) => new ObjectId(id)) }
    })
    : eligibleTotal;

  say('candidates AFTER this exclusion', afterAffinity);

  // ------------------------------------------------------ sessions + chains
  const metaKeys = [];
  let cursor = '0';
  do {
    /* eslint-disable no-await-in-loop */
    const [next, batch] = await redis.scan(cursor, 'MATCH', `${NS}:reco-feed:*:meta`, 'COUNT', 500);
    cursor = next;
    metaKeys.push(...batch);
  } while (cursor !== '0');

  const mine = [];
  for (const key of metaKeys) {
    /* eslint-disable no-await-in-loop */
    const meta = await redis.hgetall(key);
    if (!meta || meta.subjectId !== SUBJECT) continue;
    const sessionId = key.slice(`${NS}:reco-feed:`.length, -':meta'.length);
    const itemsKey = `${NS}:reco-feed:${sessionId}:items`;
    mine.push({
      sessionId,
      chainId: meta.chainId || null,
      feedType: meta.feedType,
      topicKey: meta.topicKey || '(all)',
      createdAt: meta.createdAt,
      size: await redis.llen(itemsKey),
      itemsTtl: await redis.ttl(itemsKey),
      metaTtl: await redis.ttl(key)
    });
  }
  mine.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

  console.log('');
  console.log('=== LIVE FEED SESSIONS FOR THIS SUBJECT (Redis) ===');
  if (!mine.length) console.log('  (none — all expired, or the subject id does not match)');
  mine.forEach((s, i) => {
    console.log(`  [${i + 1}] session=${fp(s.sessionId)} chain=${fp(s.chainId)} feed=${s.feedType}`
      + ` topic=${s.topicKey} items=${s.size} ttl(items/meta)=${s.itemsTtl}/${s.metaTtl}s`
      + ` created=${s.createdAt}`);
  });

  const chainIds = [...new Set(mine.map((s) => s.chainId).filter(Boolean))];
  console.log('');
  console.log('=== CHAINS (reco-feed:chain:<id>:seen) ===');
  say('distinct chains alive', chainIds.length);
  for (const chainId of chainIds) {
    /* eslint-disable no-await-in-loop */
    const key = `${NS}:reco-feed:chain:${chainId}:seen`;
    const size = await redis.scard(key);
    const ttl = await redis.ttl(key);
    const sessions = mine.filter((s) => s.chainId === chainId);
    const served = sessions.reduce((sum, s) => sum + s.size, 0);
    const members = size ? await redis.smembers(key) : [];
    const afterBoth = members.length
      ? await posts.countDocuments({
        ...eligibleBase,
        _id: {
          $nin: [...new Set([...members, ...seenDistinct])].map((id) => new ObjectId(id))
        }
      })
      : afterAffinity;

    console.log('');
    say('chain', fp(chainId));
    say('  sessions in chain', sessions.length);
    say('  items across those sessions', served);
    say('  seen-set SCARD', size);
    say('  seen-set TTL (s)', ttl === -1 ? 'NO TTL (!)' : ttl === -2 ? 'missing' : ttl);
    say('  recycled? (SCARD < served)', size < served ? 'YES — reset happened' : 'no');
    say('  candidates after chain+affinity', afterBoth);
    say('  < RELAXED_SUPPRESSION_MIN_POOL(10)?', afterBoth < 10 ? 'YES → blanket relax fires' : 'NO → no relax');
  }

  // -------------------------------------------------------------- verdict
  const newestHome = [...mine].reverse().find((s) => s.feedType === 'home');
  console.log('');
  console.log('=== VERDICT ===');
  say('newest Home session size', newestHome ? newestHome.size : '(none alive)');
  say('homeSessionItemLimit (policy)', 70);
  if (newestHome && newestHome.size < 70) {
    console.log('  → The newest Home session is SHORT. It was capped by the candidate pool,');
    console.log('    not by the session limit: the pool after exclusion was exactly its size.');
  }
  console.log('  catalogueSpent is a CLIENT flag in 06g (set when a rollover page adds no');
  console.log('  post the client did not already hold). It is not stored anywhere, so it');
  console.log('  cannot be read here — compare "candidates after chain+affinity" above');
  console.log('  against the number of cards on screen instead.');
  console.log('');

  await redis.quit();
  await mongo.close();
}

main().catch((error) => {
  console.error(`probe failed: ${error.message}`);
  process.exit(1);
});
