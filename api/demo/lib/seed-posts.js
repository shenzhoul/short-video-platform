/**
 * Creates the photo and video posts, with their media uploaded through the real
 * pipeline and their thumbnails pointing at the right files.
 *
 * ## Ordering
 *
 * Mirrors `PostCrudService.create`:
 *
 *   1. upload the media (its file record exists, unreferenced — the draft state);
 *   2. insert the post;
 *   3. create the `post_media` rows;
 *   4. attach the file references to the post.
 *
 * The post is written *before* the reference is attached because it is a new
 * row: referencing first would risk a file nothing points at, which the unused
 * file sweeper reclaims harmlessly. Doing it the other way — as profile images
 * must — would risk a published post pointing at a file with no reference, which
 * the sweeper deletes out from under it. See `seed-accounts.js` for the mirror
 * image of this argument.
 *
 * ## Video thumbnails
 *
 * A video post gets a `thumbnailId` and cover URLs from a frame extracted from
 * *that* video in phase 1, uploaded as a `post-thumbnail`. Not a stock still,
 * and not the file server's own generated thumbnail — using the extracted frame
 * means the poster a viewer sees is provably a frame of the clip behind it, and
 * makes the seed independent of when the transcode worker gets round to
 * generating its own.
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const logger = require('./logger');
const { KINDS } = require('./ledger');

/** `POST_TYPES` in api/src/common/constants/content.ts. */
const POST_TYPES = { PHOTO: 'photo', VIDEO: 'video' };
/** `FILE_REFERENCE_TYPES.POST`. */
const FILE_REF_POST = 'post';
/** `EMediaType` in api/src/schemas/content/post-media.schema.ts. */
const MEDIA_TYPES = { PHOTO: 'PHOTO', VIDEO: 'VIDEO' };

/**
 * `FileServerInfoDto.normalizeThumbnailUrls`, reproduced.
 *
 * A thumbnail entry is either a bare URL string or an object carrying `url` or
 * `path`; anything without one of those is dropped rather than turned into an
 * `undefined` cover.
 */
function normalizeThumbnailUrls(thumbnails) {
  return (thumbnails || [])
    .map((thumbnail) => (typeof thumbnail === 'string' ? thumbnail : thumbnail?.url || thumbnail?.path))
    .filter(Boolean)
    .map(stripSignature);
}

/**
 * Drop the signing query from a file-server URL before storing it.
 *
 * `FileDto.getThumbnails` signs even `public-read` thumbnails, so the URL it
 * returns carries `?token=...&expiresIn=3600`. That is fine to hand a browser
 * now and wrong to write into a database column that outlives the hour — a
 * stored cover would be pointing at an expired credential. The bare URL serves
 * the same bytes (verified: 200 without the query), because the file is public.
 */
function stripSignature(url) {
  const index = String(url).indexOf('?');
  return index === -1 ? url : String(url).slice(0, index);
}

/**
 * A stable, uniformly-distributed `recoShuffleKey` in [0, 1) for a seed key.
 *
 * Deterministic so a reseed produces the same sampling order — the product
 * uses `Math.random()`, which is right for real posts and wrong for a fixture
 * that has to be reproducible.
 */
function shuffleKeyFor(seedKey) {
  const digest = crypto.createHash('sha256').update(`reco-shuffle:${seedKey}`).digest();
  // 48 bits is plenty of resolution and stays inside a safe integer.
  return digest.readUIntBE(0, 6) / 2 ** 48;
}

/** Same regex and normalisation as `parseHashtags` in api/src/common/utils. */
function extractHashtags(text) {
  if (!text) return [];
  const matches = text.match(/#[\wÀ-ſЀ-ӿ一-鿿]+/g) || [];
  return [...new Set(matches.map((tag) => tag.slice(1).toLowerCase()))]
    .filter((tag) => tag.length > 0 && tag.length <= 50)
    .slice(0, 20);
}

/**
 * Upload one local file and return its finished record.
 *
 * Idempotent through the ledger: a file a previous run already uploaded and
 * which is still present and processed is reused rather than duplicated.
 */
async function uploadOnce({
  seedKey, localPath, purpose, mimeType, userId, ledger, pipeline, waitMs, meta
}) {
  const existing = await ledger.find(KINDS.FILE, seedKey);
  if (existing?.refId) {
    try {
      const file = await pipeline.getFile(String(existing.refId));
      if (file && file.processingStatus === 'completed' && file.url) {
        return { fileId: String(existing.refId), file, reused: true };
      }
    } catch {
      logger.warn(`recorded file for ${seedKey} is gone; re-uploading`);
    }
  }

  const target = await pipeline.upload({
    filePath: localPath, purpose, mimeType, createdBy: String(userId), metadata: meta
  });
  await ledger.record(KINDS.FILE, seedKey, target.fileId, meta);

  await pipeline.sendBytes({
    uploadUrl: target.uploadUrl, token: target.token, filePath: localPath, mimeType
  });

  const processed = await pipeline.waitForProcessing(target.fileId, { timeoutMs: waitMs });
  if (!processed.ok) throw new Error(`${seedKey}: ${processed.reason}`);

  return { fileId: target.fileId, file: processed.file, reused: false };
}

async function seedPosts({
  plan, db, ledger, pipeline, mediaDir, path: pathLib, videoWaitMs = 900000
}) {
  const stats = {
    created: 0, reused: 0, uploads: 0, photos: 0, videos: 0
  };
  const postIndex = [];

  for (const account of plan.accounts) {
    const userId = plan.userIds.get(account.username);

    for (const post of account.posts) {
      const claimed = await ledger.claim(KINDS.POST, post.seedKey, {
        username: account.username, kind: post.kind
      });
      const postId = claimed.refId;
      const isVideo = post.kind === 'video';

      const already = await db.posts.findOne({ _id: postId });
      if (already) {
        stats.reused += 1;
        postIndex.push({
          postId,
          userId,
          username: account.username,
          themeKey: account.themeKey,
          topicKey: account.topicKey,
          kind: post.kind,
          durationMs: post.media.durationMs ?? null,
          tags: extractHashtags(post.caption),
          publishedAt: post.publishedAt,
          seedKey: post.seedKey
        });
        continue;
      }

      // 1. Media first: the post cannot name files that do not exist.
      const mainPath = pathLib.join(mediaDir, post.media.localFile);
      const main = await uploadOnce({
        seedKey: `file:media:${post.seedKey}`,
        localPath: mainPath,
        purpose: isVideo ? 'post-video' : 'post-photo',
        mimeType: post.media.mimeType,
        userId,
        ledger,
        pipeline,
        waitMs: isVideo ? videoWaitMs : 180000,
        meta: {
          demo: true, category: 'post', fileType: post.kind, theme: account.themeKey
        }
      });
      if (!main.reused) stats.uploads += 1;

      let thumbnail = null;
      if (isVideo) {
        if (!post.media.thumbnail) {
          throw new Error(`${post.seedKey}: manifest entry has no extracted poster frame. Re-run yarn demo:fetch-media.`);
        }
        thumbnail = await uploadOnce({
          seedKey: `file:thumb:${post.seedKey}`,
          localPath: pathLib.join(mediaDir, post.media.thumbnail.localFile),
          purpose: 'post-thumbnail',
          mimeType: post.media.thumbnail.mimeType,
          userId,
          ledger,
          pipeline,
          waitMs: 180000,
          meta: { demo: true, category: 'post', fileType: 'thumbnail', theme: account.themeKey }
        });
        if (!thumbnail.reused) stats.uploads += 1;
      }

      /**
       * The cover URLs, resolved exactly as `PostCrudService.create` resolves
       * them:
       *
       *   cover4x3Url = the uploaded thumbnail, else a generated one
       *   cover3x4Url = a generated one, else cover4x3Url
       *
       * **Not the full-size image.** An earlier version pointed a photo post's
       * cover at the processed original, and a feed card ended up downloading and
       * decoding a 4160x6240 WebP — 3.2MB and 26 megapixels — to fill a box about
       * 265 CSS pixels wide. Measured, painting those covers was the entire
       * remaining cost of scrolling the feed: with the images not painted, a
       * 40-step scroll spent 0ms in long tasks against 1.8s with them. The
       * generated thumbnail for the same photo is 7KB.
       *
       * The file server produces these thumbnails already (`generateThumbnail:
       * true` on the upload), and production has always used them. This was a
       * divergence in the seeder, not a gap in the product.
       */
      const generatedCovers = normalizeThumbnailUrls(main.file.thumbnails);
      const generatedCover = generatedCovers[0] || null;
      // A video's uploaded poster is the frame extracted from that video in
      // phase 1, which is what the product calls a creator-chosen thumbnail.
      const cover4x3Url = (isVideo ? thumbnail.file.url : null) || generatedCover || main.file.url;
      const cover3x4Url = generatedCover || cover4x3Url;
      const tags = extractHashtags(post.caption);

      // 2. The post row.
      await db.posts.insertOne({
        _id: postId,
        type: isVideo ? POST_TYPES.VIDEO : POST_TYPES.PHOTO,
        mediaTypes: [post.kind],
        userId,
        text: post.caption,
        tags,
        topicKey: post.topicKey,
        associatedTag: null,
        mentionedUserIds: [],
        fileIds: [new ObjectId(main.fileId)],
        // Taken from the manifest, where it was recorded from the decoded
        // dimensions rather than from the search that found the file.
        orientation: post.media.orientation,
        ...(thumbnail ? { thumbnailId: new ObjectId(thumbnail.fileId) } : {}),
        cover4x3Url,
        cover3x4Url,
        /**
         * The ratio Home renders the card at, chosen from the media's own shape.
         *
         * A landscape clip in a 3:4 slot is letterboxed into a third of the box
         * with the rest painted from a blurred backdrop, which is both ugly and
         * the most expensive thing the feed can paint. Matching the slot to the
         * media means the common case fills its box exactly.
         */
        coverDisplayRatio: post.media.orientation === 'landscape' ? '4:3' : '3:4',
        status: 'active',
        totalLike: 0,
        totalComment: 0,
        totalShare: 0,
        totalView: 0,
        isCreatorDeleted: false,
        /*
         * `Post.recoShuffleKey` carries a Mongoose `default: () => Math.random()`,
         * and a Mongoose default only fires on `save()`. This seeder writes
         * through the raw driver, so the field has to be written explicitly —
         * and it is not optional decoration.
         *
         * Two of the five recommendation candidate sources (fresh discovery
         * and diverse discovery) find their candidates with an indexed range
         * scan over this field, and a missing field never satisfies `$gte`.
         * Without it those two buckets return **nothing at all**, silently:
         * the feed still works, still looks plausible, and is quietly built
         * from the trending window alone. The
         * `1788000100000-backfill-post-reco-shuffle-key` migration repairs
         * documents written before the field existed, but a `demo:clean` +
         * `demo:seed` cycle creates brand-new posts long after that migration
         * ran, so the seeder has to hold up its own end. Derived from the seed
         * key rather than `Math.random()` so a reseed reproduces the same
         * sample order.
         */
        recoShuffleKey: shuffleKeyFor(post.seedKey),
        /*
         * Pinned state comes from the plan, so it is the same on every seed.
         * Same two fields `PostCrudService.setPinned` writes -- nothing here
         * invents a field the product does not understand.
         */
        isPinned: Boolean(post.isPinned),
        pinnedAt: post.pinnedAt || null,
        createdAt: post.publishedAt,
        updatedAt: post.publishedAt
      });
      await ledger.activate(KINDS.POST, post.seedKey);

      // 3. post_media rows.
      const mediaSeedKey = `post_media:${post.seedKey}:0`;
      const mediaClaim = await ledger.claim(KINDS.POST_MEDIA, mediaSeedKey, {});
      if (!await db.postMedia.findOne({ _id: mediaClaim.refId })) {
        await db.postMedia.insertOne({
          _id: mediaClaim.refId,
          postId,
          userId,
          mediaType: isVideo ? MEDIA_TYPES.VIDEO : MEDIA_TYPES.PHOTO,
          fileId: new ObjectId(main.fileId),
          ordering: 0,
          /*
           * The canonical, ffprobe-measured duration, exactly as
           * `PostMediaService.createMultiplePostMedia` records it for a real
           * upload. Without it the recommendation engine treats every demo
           * video as a legacy post with no known length, and can therefore
           * never classify a watch as a completion or a quick skip — so the
           * seeded histories would exercise none of that path. Measured at
           * fetch time and carried on the manifest, never guessed here.
           */
          ...(isVideo && post.media.durationMs ? { durationMs: post.media.durationMs } : {}),
          createdAt: post.publishedAt,
          updatedAt: post.publishedAt
        });
        await ledger.activate(KINDS.POST_MEDIA, mediaSeedKey);
      }

      // 4. Attach the references now the post exists. `attachReference` throws
      //    if the file server did not match every id, because a post pointing at
      //    a file with no reference is what the sweeper deletes.
      const fileIds = [main.fileId, ...(thumbnail ? [thumbnail.fileId] : [])];
      await pipeline.attachReference({
        fileIds, createdBy: String(userId), itemId: String(postId), itemType: FILE_REF_POST
      });

      stats.created += 1;
      if (isVideo) stats.videos += 1; else stats.photos += 1;
      postIndex.push({
        postId,
        userId,
        username: account.username,
        themeKey: account.themeKey,
        topicKey: account.topicKey,
        kind: post.kind,
        durationMs: post.media.durationMs ?? null,
        tags: extractHashtags(post.caption),
        publishedAt: post.publishedAt,
        seedKey: post.seedKey
      });

      if (stats.created % 10 === 0) logger.detail(`${stats.created} posts created…`);
    }
  }

  return { stats, postIndex };
}

module.exports = {
  seedPosts, extractHashtags, normalizeThumbnailUrls, stripSignature
};
