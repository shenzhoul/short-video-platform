/**
 * A one-off fixture creator with enough posts to page a profile grid.
 *
 * Why it exists: every seeded creator has exactly 10 posts against a 20-post
 * page size, so the profile grid is a single page on the demo dataset and its
 * pagination cannot be exercised in a browser at all. This adds one creator
 * with 45 posts — three pages plus a remainder — so `IntersectionObserver`,
 * page-two and page-three cursors, and the creator scope of each page can be
 * observed rather than reasoned about.
 *
 * It does not touch the demo dataset. Media goes through the same upload
 * pipeline `demo:seed` uses — a signed target, the bytes, processing, then the
 * reference attached after the owning row exists — because writing to `files`
 * directly would skip every validation the product performs and could produce
 * rows the app itself would refuse.
 *
 * Every id it creates is written to `output/profile-fixture.json`, and
 * `--cleanup` removes exactly those ids and nothing else.
 *
 * Usage:
 *   node scripts/profile-pagination-fixture.js --create [--posts 45]
 *   node scripts/profile-pagination-fixture.js --cleanup
 */

/* eslint-disable no-console */
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const dbLib = require('../demo/lib/db');
const { createFilePipeline } = require('../demo/lib/file-pipeline');
const manifestLib = require('../demo/lib/manifest');
const env = require('../demo/lib/env');
const config = require('../demo/demo.config');

const LEDGER_PATH = path.join(__dirname, '..', '..', 'output', 'profile-fixture.json');
const USERNAME = 'fixture.pagination';
const EMAIL = 'fixture.pagination@fixture.invalid';
/** Same password every demo account uses, so the browser harness can sign in. */
const PASSWORD = process.env.DEMO_PASSWORD || 'demodemo';

function saveLedger(ledger) {
  fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
  fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger, null, 2));
  console.log(`\nfixture ids written to ${LEDGER_PATH}`);
}

function loadLedger() {
  if (!fs.existsSync(LEDGER_PATH)) throw new Error(`no fixture ledger at ${LEDGER_PATH}`);
  return JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
}

/**
 * A stored credential in the format `PasswordHasherService` writes:
 * `scrypt$v=1$N=32768,r=8,p=1$<salt-base64>$<key-base64>`.
 *
 * The web client sha256s the password before sending and the API scrypts
 * whatever arrives, so the stored value is `scrypt(sha256(plain))`. There is
 * deliberately **no** `salt` column: scrypt carries its own salt inside the
 * value, and the legacy verifier keys off that column's presence — writing one
 * would make this look like a legacy credential and fail to verify.
 */
const SCRYPT = {
  N: 32768, r: 8, p: 1, keylen: 64, saltBytes: 16, maxmem: 64 * 1024 * 1024
};

function hashPassword(plain) {
  const preHashed = crypto.createHash('sha256').update(plain).digest('hex');
  const salt = crypto.randomBytes(SCRYPT.saltBytes);
  const derived = crypto.scryptSync(preHashed, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem
  });
  return [
    'scrypt$v=1',
    `N=${SCRYPT.N},r=${SCRYPT.r},p=${SCRYPT.p}`,
    salt.toString('base64'),
    derived.toString('base64')
  ].join('$');
}

function connections() {
  return env.loadSeedConnections();
}

function openPipeline(conn) {
  return createFilePipeline({
    baseUrl: conn.fileServerBaseUrl,
    apiKey: conn.fileServerApiKey,
    internalApiKey: conn.internalApiKey
  });
}

async function create(postCount) {
  const conn = connections();
  const db = await dbLib.connect(conn.mongoUri);
  const manifest = manifestLib.index(manifestLib.load(config.MANIFEST_PATH), config.MEDIA_DIR);
  const pipeline = openPipeline(conn);

  const ledger = {
    createdAt: new Date().toISOString(),
    username: USERNAME,
    userId: null,
    authId: null,
    postIds: [],
    postMediaIds: [],
    fileIds: []
  };

  try {
    const existing = await db.users.findOne({ username: USERNAME });
    if (existing) throw new Error(`fixture user ${USERNAME} already exists — run --cleanup first`);

    // ---- the creator ------------------------------------------------
    const userId = new ObjectId();
    ledger.userId = String(userId);
    const now = new Date();
    await db.users.insertOne({
      _id: userId,
      name: 'Fixture Pagination',
      username: USERNAME,
      email: EMAIL,
      roles: ['user'],
      status: 'active',
      verifiedEmail: true,
      isPerformer: true,
      bio: 'A fixture account used to exercise profile pagination. Safe to delete.',
      stats: { totalLikes: 0, totalPosts: postCount, totalFollowers: 0, totalFollowings: 0 },
      createdAt: now,
      updatedAt: now
    });

    const authId = new ObjectId();
    ledger.authId = String(authId);
    await db.auth.insertOne({
      _id: authId,
      userId,
      type: 'password',
      key: EMAIL,
      value: hashPassword(PASSWORD),
      createdAt: now,
      updatedAt: now
    });
    console.log(`creator ${USERNAME} (${userId})`);

    // ---- posts ------------------------------------------------------
    /*
     * Both media kinds, so the grid's photo and video treatments are both
     * exercised, and a couple of pinned posts so pinned ordering is visible
     * across a page boundary rather than only on page one.
     */
    const photos = manifest.live.filter((item) => item.purpose === 'post-photo');
    const videos = manifest.live.filter((item) => item.purpose === 'post-video-portrait');
    if (!photos.length || !videos.length) throw new Error('media manifest has no post media cached');

    for (let index = 0; index < postCount; index += 1) {
      const isVideo = index % 3 !== 0; // two thirds video, one third photo
      const source = isVideo ? videos[index % videos.length] : photos[index % photos.length];
      const localPath = path.join(config.MEDIA_DIR, source.localFile);
      if (!fs.existsSync(localPath)) throw new Error(`cached media missing: ${localPath}`);
      const orientation = manifestLib.orientationOf(source.width, source.height);

      // The manifest distinguishes portrait and landscape video; the upload
      // pipeline has one `post-video` profile for both, and that profile is the
      // durable upload identity the file server resolves its policy from.
      const uploadPurpose = source.purpose.startsWith('post-video') ? 'post-video' : source.purpose;
      // eslint-disable-next-line no-await-in-loop
      const target = await pipeline.upload({
        filePath: localPath,
        purpose: uploadPurpose,
        mimeType: source.mimeType,
        createdBy: String(userId),
        metadata: { fixture: 'profile-pagination' }
      });
      ledger.fileIds.push(String(target.fileId));
      // eslint-disable-next-line no-await-in-loop
      await pipeline.sendBytes({
        uploadUrl: target.uploadUrl, token: target.token, filePath: localPath, mimeType: source.mimeType
      });
      // eslint-disable-next-line no-await-in-loop
      const processed = await pipeline.waitForProcessing(target.fileId, { timeoutMs: 900000 });
      if (!processed.ok) throw new Error(`post ${index}: ${processed.reason}`);

      const postId = new ObjectId();
      const mediaId = new ObjectId();
      // Descending by index so post 0 is newest — the order the grid renders.
      const publishedAt = new Date(Date.now() - ((index + 1) * 3600 * 1000));
      const isPinned = index === 7 || index === 25;

      // eslint-disable-next-line no-await-in-loop
      await db.posts.insertOne({
        _id: postId,
        type: isVideo ? 'video' : 'photo',
        mediaTypes: [isVideo ? 'video' : 'photo'],
        userId,
        text: `Fixture post ${index + 1} for profile pagination`,
        tags: [],
        topicKey: 'lifestyle',
        associatedTag: null,
        mentionedUserIds: [],
        fileIds: [new ObjectId(target.fileId)],
        orientation,
        cover4x3Url: processed.file.thumbnails?.[0] || processed.file.url,
        cover3x4Url: processed.file.thumbnails?.[0] || processed.file.url,
        coverDisplayRatio: orientation === 'landscape' ? '4:3' : '3:4',
        status: 'active',
        totalLike: 0,
        totalComment: 0,
        totalShare: 0,
        totalView: 0,
        isCreatorDeleted: false,
        // Two candidate sources find posts by an indexed range scan over this
        // field, and a missing value never satisfies `$gte`.
        recoShuffleKey: Math.random(),
        isPinned,
        pinnedAt: isPinned ? new Date(Date.now() - (index * 60 * 1000)) : null,
        createdAt: publishedAt,
        updatedAt: publishedAt
      });
      ledger.postIds.push(String(postId));

      // eslint-disable-next-line no-await-in-loop
      await db.postMedia.insertOne({
        _id: mediaId,
        postId,
        userId,
        mediaType: isVideo ? 'VIDEO' : 'PHOTO',
        fileId: new ObjectId(target.fileId),
        ordering: 0,
        ...(isVideo && source.durationMs ? { durationMs: source.durationMs } : {}),
        createdAt: publishedAt,
        updatedAt: publishedAt
      });
      ledger.postMediaIds.push(String(mediaId));

      // The reference is attached *after* the post exists: a file with no
      // reference is the draft state the unused-file sweeper collects, and a
      // post pointing at an unreferenced file is what it would delete.
      // eslint-disable-next-line no-await-in-loop
      await pipeline.attachReference({
        fileIds: [target.fileId], createdBy: String(userId), itemId: String(postId), itemType: 'post'
      });

      if ((index + 1) % 10 === 0) console.log(`  ${index + 1}/${postCount} posts`);
    }

    console.log(`\ncreated ${ledger.postIds.length} posts for @${USERNAME}`);
    console.log(`  pinned: ${ledger.postIds.length ? '2' : '0'}`);
    saveLedger(ledger);
  } catch (error) {
    // Whatever was created before the failure is still recorded, so cleanup can
    // remove it rather than leaving it behind.
    saveLedger(ledger);
    throw error;
  }
}

async function cleanup() {
  const ledger = loadLedger();
  const conn = connections();
  const db = await dbLib.connect(conn.mongoUri);
  const pipeline = openPipeline(conn);

  const toObjectIds = (ids) => ids.map((id) => new ObjectId(id));
  const report = {};

  if (ledger.postMediaIds.length) {
    report.postMedia = (await db.postMedia.deleteMany({ _id: { $in: toObjectIds(ledger.postMediaIds) } })).deletedCount;
  }
  if (ledger.postIds.length) {
    report.posts = (await db.posts.deleteMany({ _id: { $in: toObjectIds(ledger.postIds) } })).deletedCount;
    // Anything the browser run produced against these posts, by exact post id.
    report.recommendationEvents = (await db.collection('recommendation_events')
      .deleteMany({ postId: { $in: toObjectIds(ledger.postIds) } })).deletedCount;
    report.postStats = (await db.collection('post_recommendation_stats')
      .deleteMany({ postId: { $in: toObjectIds(ledger.postIds) } })).deletedCount;
    report.reactions = (await db.collection('reactions')
      .deleteMany({ objectId: { $in: toObjectIds(ledger.postIds) } })).deletedCount;
  }
  if (ledger.authId) {
    report.auth = (await db.auth.deleteMany({ _id: new ObjectId(ledger.authId) })).deletedCount;
  }
  if (ledger.userId) {
    report.users = (await db.users.deleteMany({ _id: new ObjectId(ledger.userId) })).deletedCount;
    report.affinities = (await db.collection('user_recommendation_affinities')
      .deleteMany({ subjectId: ledger.userId })).deletedCount;
  }

  if (ledger.fileIds.length) {
    const result = await pipeline.deleteFiles(ledger.fileIds);
    report.files = result.deleted;
    if (result.errors?.length) console.log(`  file removal errors: ${JSON.stringify(result.errors.slice(0, 3))}`);
  }

  console.log(`removed by exact id: ${JSON.stringify(report)}`);
  fs.unlinkSync(LEDGER_PATH);
  console.log(`ledger ${LEDGER_PATH} deleted`);
}

async function main() {
  const args = process.argv.slice(2);
  const postCount = args.includes('--posts') ? Number(args[args.indexOf('--posts') + 1]) : 45;

  if (args.includes('--cleanup')) return cleanup();
  if (args.includes('--create')) return create(postCount);
  throw new Error('pass --create or --cleanup');
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
