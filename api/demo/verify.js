#!/usr/bin/env node
/**
 * `yarn demo:verify` — check that the seeded dataset is actually serviceable.
 *
 * Seeding reporting success only means the writes did not throw. This asks the
 * questions a viewer would:
 *
 *  - does every avatar, cover, photo, video and poster URL actually serve bytes,
 *    with a content type matching what it claims to be?
 *  - did every file finish processing, or is a post pointing at a video the
 *    transcode never produced?
 *  - does every file carry the reference that stops the unused-file sweeper from
 *    deleting it out from under a published row?
 *  - do the cached counters equal a fresh count of the rows they cache?
 *  - does anything reference a document that does not exist?
 *
 * Read-only. It writes nothing, so it is safe to run against a seeded database
 * at any time, and safe to re-run after a partial `demo:clean`.
 */

const config = require('./demo.config');
const logger = require('./lib/logger');
const env = require('./lib/env');
const dbLib = require('./lib/db');
const { createLedger, KINDS } = require('./lib/ledger');
const { createFilePipeline } = require('./lib/file-pipeline');
const crypto = require('crypto');
const { ObjectId } = require('mongodb');

const path = require('path');
const { execFile } = require('child_process');

const manifestLib = require('./lib/manifest');
const { resolveAccountPlan, assertCategoryCoverage } = require('./lib/account-plan');
const { createRecommendationAdapter } = require('./lib/recommendation-adapter');
const { personaFor } = require('./lib/recommendation-personas');

/** How many URLs to probe at once. Polite, and enough to finish quickly. */
const PROBE_CONCURRENCY = 8;

const failures = [];
const warnings = [];
const fail = (message) => failures.push(message);
const warn = (message) => warnings.push(message);

/**
 * Fetch just enough of a URL to prove it serves.
 *
 * A ranged GET rather than HEAD: static file handlers answer HEAD
 * inconsistently, and a 200 on HEAD does not prove the body exists. One byte is
 * enough to prove it does, and costs nothing on a 30MB video.
 */
async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      signal: controller.signal
    });
    return {
      ok: response.status === 200 || response.status === 206,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      contentLength: response.headers.get('content-range') || response.headers.get('content-length') || null
    };
  } catch (error) {
    return { ok: false, status: 0, reason: logger.redact(error.message) };
  } finally {
    clearTimeout(timer);
  }
}

/** Run an async mapper over a list with bounded concurrency. */
async function mapLimited(items, limit, mapper) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...await Promise.all(items.slice(i, i + limit).map(mapper)));
  }
  return results;
}

/** Does a served content type match the kind of media we expect? */
function contentTypeMatches(expectKind, contentType) {
  if (!contentType) return false;
  if (expectKind === 'image') return contentType.startsWith('image/');
  if (expectKind === 'video') return contentType.startsWith('video/');
  return false;
}

async function checkProfileMedia(db, userIds) {
  const users = await db.users.find({ _id: { $in: userIds } }).toArray();
  logger.detail(`${users.length} accounts`);

  const targets = [];
  for (const user of users) {
    if (!user.avatar) fail(`${user.username}: no avatar URL`);
    if (!user.avatarId) fail(`${user.username}: no avatarId`);
    if (!user.cover) fail(`${user.username}: no cover URL`);
    if (!user.coverId) fail(`${user.username}: no coverId`);
    if (user.avatar) targets.push({ label: `${user.username} avatar`, url: user.avatar, kind: 'image' });
    if (user.cover) targets.push({ label: `${user.username} cover`, url: user.cover, kind: 'image' });
  }

  const probes = await mapLimited(targets, PROBE_CONCURRENCY, async (target) => ({
    target, result: await probe(target.url)
  }));
  for (const { target, result } of probes) {
    if (!result.ok) fail(`${target.label}: HTTP ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    else if (!contentTypeMatches(target.kind, result.contentType)) {
      fail(`${target.label}: served as '${result.contentType}', expected an ${target.kind}`);
    }
  }
  return { users, probed: targets.length };
}

async function checkPostMedia(db, postIds, pipeline) {
  const posts = await db.posts.find({ _id: { $in: postIds } }).toArray();
  logger.detail(`${posts.length} posts`);

  const fileIds = new Set();
  for (const post of posts) {
    if (!post.fileIds?.length) fail(`post ${post._id}: no fileIds`);
    else post.fileIds.forEach((id) => fileIds.add(String(id)));

    if (post.type === 'video') {
      if (!post.thumbnailId) fail(`video post ${post._id}: no thumbnailId`);
      else fileIds.add(String(post.thumbnailId));
    }
    if (!post.cover3x4Url || !post.cover4x3Url) fail(`post ${post._id}: missing cover URL`);
    if (!post.text) fail(`post ${post._id}: empty caption`);
    if (!post.topicKey) warn(`post ${post._id}: no topicKey`);
  }

  // Ask the file server about every referenced file: does it exist, did it
  // finish processing, and does it carry the reference?
  const records = await mapLimited([...fileIds], PROBE_CONCURRENCY, async (fileId) => {
    try {
      return { fileId, file: await pipeline.getFile(fileId) };
    } catch (error) {
      return { fileId, error: logger.redact(error.message) };
    }
  });

  const byId = new Map();
  for (const { fileId, file, error } of records) {
    if (error || !file) {
      fail(`file ${fileId}: not retrievable${error ? ` (${error})` : ''}`);
      continue;
    }
    byId.set(fileId, file);
    if (file.processingStatus !== 'completed') {
      fail(`file ${fileId}: processingStatus is '${file.processingStatus}', not completed`);
    }
    if (!file.url) fail(`file ${fileId}: no served URL`);
    if (!file.refItems?.length) {
      // This is the one that silently destroys a dataset: an unreferenced file
      // is what the unused-file sweeper collects, so the post keeps its URL and
      // the bytes disappear hours later.
      fail(`file ${fileId}: carries NO reference — the unused-file sweeper will delete it`);
    }
  }

  // Every post's files must reference that post, and nothing else's.
  for (const post of posts) {
    const expected = [...(post.fileIds || []).map(String), ...(post.thumbnailId ? [String(post.thumbnailId)] : [])];
    for (const fileId of expected) {
      const file = byId.get(fileId);
      if (!file) continue;
      const refs = (file.refItems || []).filter((r) => r.itemType === 'post');
      if (!refs.some((r) => String(r.itemId) === String(post._id))) {
        fail(`file ${fileId} is used by post ${post._id} but does not reference it`);
      }
    }
  }

  // Now the URLs themselves.
  const targets = [];
  for (const post of posts) {
    const mainId = String(post.fileIds?.[0] || '');
    const main = byId.get(mainId);
    if (main?.url) {
      targets.push({
        label: `post ${post._id} ${post.type}`, url: main.url, kind: post.type === 'video' ? 'video' : 'image'
      });
    }
    if (post.type === 'video' && post.thumbnailId) {
      const thumb = byId.get(String(post.thumbnailId));
      if (thumb?.url) targets.push({ label: `post ${post._id} poster`, url: thumb.url, kind: 'image' });
    }
    if (post.cover3x4Url) {
      targets.push({ label: `post ${post._id} cover3x4`, url: post.cover3x4Url, kind: 'image' });
    }
  }

  const probes = await mapLimited(targets, PROBE_CONCURRENCY, async (target) => ({
    target, result: await probe(target.url)
  }));
  for (const { target, result } of probes) {
    if (!result.ok) fail(`${target.label}: HTTP ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    else if (!contentTypeMatches(target.kind, result.contentType)) {
      fail(`${target.label}: served as '${result.contentType}', expected ${target.kind}`);
    }
  }

  return { posts, filesChecked: byId.size, urlsProbed: targets.length };
}

/** No file may appear in two posts, or on two profiles. */
async function checkNoSharedFiles(db, posts, users) {
  const owners = new Map();
  const claim = (fileId, owner) => {
    const key = String(fileId);
    if (owners.has(key)) fail(`file ${key} is used by both ${owners.get(key)} and ${owner}`);
    else owners.set(key, owner);
  };
  for (const user of users) {
    if (user.avatarId) claim(user.avatarId, `${user.username} avatar`);
    if (user.coverId) claim(user.coverId, `${user.username} cover`);
  }
  for (const post of posts) {
    (post.fileIds || []).forEach((id) => claim(id, `post ${post._id}`));
    if (post.thumbnailId) claim(post.thumbnailId, `post ${post._id} thumbnail`);
  }
  return owners.size;
}

/** Every cached counter must equal a fresh count of the rows it caches. */
async function checkCounters(db, userIds, postIds, commentIds) {
  const posts = await db.posts.find({ _id: { $in: postIds } }).toArray();

  for (const post of posts) {
    const [likes, shares, direct] = await Promise.all([
      db.reactions.countDocuments({ objectType: 'post', action: 'like', objectId: post._id }),
      db.reactions.countDocuments({ objectType: 'post', action: 'share', objectId: post._id }),
      db.comments.find({ objectType: 'post', objectId: post._id }, { projection: { _id: 1 } }).toArray()
    ]);
    const replies = direct.length === 0 ? 0 : await db.comments.countDocuments({
      objectType: 'comment', objectId: { $in: direct.map((c) => c._id) }
    });

    if ((post.totalLike || 0) !== likes) fail(`post ${post._id}: totalLike ${post.totalLike} but ${likes} like rows`);
    if ((post.totalShare || 0) !== shares) fail(`post ${post._id}: totalShare ${post.totalShare} but ${shares} share rows`);
    // `post.totalComment` includes replies — see comment.listener.ts.
    if ((post.totalComment || 0) !== direct.length + replies) {
      fail(`post ${post._id}: totalComment ${post.totalComment} but ${direct.length} comments + ${replies} replies`);
    }
  }

  const users = await db.users.find({ _id: { $in: userIds } }).toArray();
  for (const user of users) {
    const [followers, followings, postCount] = await Promise.all([
      db.reactions.countDocuments({ objectType: 'creator', action: 'follow', objectId: user._id }),
      db.reactions.countDocuments({ objectType: 'creator', action: 'follow', createdBy: user._id }),
      db.posts.countDocuments({ userId: user._id, status: 'active' })
    ]);
    const likesReceived = (await db.posts.aggregate([
      { $match: { userId: user._id, status: 'active' } },
      { $group: { _id: null, n: { $sum: { $ifNull: ['$totalLike', 0] } } } }
    ]).toArray())[0]?.n || 0;

    const stats = user.stats || {};
    if ((stats.followers || 0) !== followers) fail(`${user.username}: stats.followers ${stats.followers} but ${followers} follow rows`);
    if ((stats.followings || 0) !== followings) fail(`${user.username}: stats.followings ${stats.followings} but ${followings} follow rows`);
    if ((stats.totalPosts || 0) !== postCount) fail(`${user.username}: stats.totalPosts ${stats.totalPosts} but ${postCount} active posts`);
    if ((stats.totalLikes || 0) !== likesReceived) fail(`${user.username}: stats.totalLikes ${stats.totalLikes} but ${likesReceived} likes on their posts`);
  }

  /*
   * Root comments and replies alike. `totalLike` used to go unchecked here, and
   * unreconciled — a comment with four like rows read zero, so a
   * "somebody liked your comment" notification opened onto a comment claiming
   * no likes. Counting the rows is the whole check; it is what the product's
   * own listener increments towards.
   */
  const comments = await db.comments.find({ _id: { $in: commentIds } }).toArray();
  let repliesChecked = 0;
  for (const comment of comments) {
    if (comment.objectType === 'comment') repliesChecked += 1;
    const [replies, likers] = await Promise.all([
      db.comments.countDocuments({ objectType: 'comment', objectId: comment._id }),
      db.reactions.distinct('createdBy', {
        objectType: 'comment', action: 'like', objectId: comment._id
      })
    ]);
    if ((comment.totalReply || 0) !== replies) {
      fail(`comment ${comment._id}: totalReply ${comment.totalReply} but ${replies} reply rows`);
    }
    if ((comment.totalLike || 0) !== likers.length) {
      fail(`comment ${comment._id}: totalLike ${comment.totalLike} but ${likers.length} distinct likers`);
    }
    if (!Number.isInteger(comment.totalLike) || comment.totalLike < 0) {
      fail(`comment ${comment._id}: totalLike is ${JSON.stringify(comment.totalLike)}, expected a non-negative integer`);
    }
    if (!Number.isInteger(comment.totalReply) || comment.totalReply < 0) {
      fail(`comment ${comment._id}: totalReply is ${JSON.stringify(comment.totalReply)}, expected a non-negative integer`);
    }
  }

  return {
    posts: posts.length, users: users.length, comments: comments.length, replies: repliesChecked
  };
}

/** Nothing may point at a document that is not there. */
async function checkReferentialIntegrity(db, userIds, postIds) {
  const userSet = new Set(userIds.map(String));
  const postSet = new Set(postIds.map(String));

  const posts = await db.posts.find({ _id: { $in: postIds } }, { projection: { userId: 1 } }).toArray();
  for (const post of posts) {
    if (!userSet.has(String(post.userId))) fail(`post ${post._id}: author ${post.userId} is not a demo account`);
  }

  const media = await db.postMedia.find({ postId: { $in: postIds } }).toArray();
  for (const row of media) {
    if (!postSet.has(String(row.postId))) fail(`post_media ${row._id}: post ${row.postId} missing`);
    if (!userSet.has(String(row.userId))) fail(`post_media ${row._id}: user ${row.userId} missing`);
  }
  if (media.length !== posts.length) {
    fail(`${posts.length} posts but ${media.length} post_media rows`);
  }

  // Every interaction must be between demo accounts on demo posts. An edge
  // touching a real user would leave their counters wrong after demo:clean.
  const reactions = await db.reactions.find({
    $or: [{ objectId: { $in: postIds } }, { objectId: { $in: userIds } }]
  }).toArray();
  for (const reaction of reactions) {
    if (!userSet.has(String(reaction.createdBy))) {
      warn(`reaction ${reaction._id} (${reaction.action}) was made by a non-demo user — demo:clean will leave it`);
    }
  }

  const orphanComments = await db.comments.countDocuments({
    objectType: 'post', objectId: { $nin: postIds }, createdBy: { $in: userIds }
  });
  if (orphanComments > 0) fail(`${orphanComments} demo comment(s) point at a post outside the dataset`);

  return { posts: posts.length, media: media.length, reactions: reactions.length };
}

/**
 * The dataset is the shape the configuration asks for.
 *
 * Expectations are recomputed from `demo.config.js` rather than written down
 * here, so changing the mix changes what is built *and* what is checked. A test
 * that hardcodes "9 videos" stops testing the moment somebody edits the config.
 */
async function checkComposition(db, userIds) {
  const accountPlan = resolveAccountPlan(config, config.themes);
  if (!accountPlan.ok) {
    for (const problem of accountPlan.problems) fail(problem);
    return null;
  }
  const plan = accountPlan.plan;
  const expected = {
    landscape: config.counts.landscapeVideosPerAccount,
    portrait: config.counts.portraitVideosPerAccount,
    photos: config.counts.photoPostsPerAccount
  };
  const perAccount = expected.landscape + expected.portrait + expected.photos;

  if (userIds.length !== plan.totalAccounts) {
    fail(`${userIds.length} demo accounts but the configuration asks for ${plan.totalAccounts}`);
  }

  const users = await db.users.find(
    { _id: { $in: userIds } }, { projection: { username: 1, isAdmin: 1 } }
  ).toArray();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  const totals = {
    landscape: 0, portrait: 0, photos: 0, posts: 0
  };
  const perAccountOrientation = [];

  for (const userId of userIds) {
    const user = byId.get(String(userId));
    const name = user?.username || String(userId);

    // No demo account may be an administrator.
    if (user?.isAdmin) fail(`${name}: isAdmin is true — demo accounts must be normal users`);

    const posts = await db.posts.find(
      { userId, status: 'active' }, { projection: { type: 1, orientation: 1 } }
    ).toArray();

    const landscape = posts.filter((p) => p.type === 'video' && p.orientation === 'landscape').length;
    const portrait = posts.filter((p) => p.type === 'video' && p.orientation === 'portrait').length;
    const photos = posts.filter((p) => p.type === 'photo').length;

    totals.landscape += landscape;
    totals.portrait += portrait;
    totals.photos += photos;
    totals.posts += posts.length;
    perAccountOrientation.push({
      username: name, landscape, portrait, photos, posts: posts.length
    });

    if (posts.length !== perAccount) fail(`${name}: ${posts.length} posts, expected ${perAccount}`);
    if (landscape !== expected.landscape) fail(`${name}: ${landscape} landscape videos, expected ${expected.landscape}`);
    if (portrait !== expected.portrait) fail(`${name}: ${portrait} portrait videos, expected ${expected.portrait}`);
    if (photos !== expected.photos) fail(`${name}: ${photos} photo posts, expected ${expected.photos}`);
  }

  if (totals.landscape <= totals.portrait) {
    fail(`landscape videos (${totals.landscape}) must outnumber portrait (${totals.portrait})`);
  }
  const videoTotal = totals.landscape + totals.portrait;
  const videoShare = totals.posts ? videoTotal / totals.posts : 0;
  const expectedShare = (expected.landscape + expected.portrait) / perAccount;
  if (Math.abs(videoShare - expectedShare) > 0.001) {
    fail(`video share is ${(videoShare * 100).toFixed(1)}%, expected ${(expectedShare * 100).toFixed(1)}%`);
  }

  return { totals, perAccountOrientation, plan };
}

/** Every active category has demo content, and no theme names a dead one. */
async function checkCategoryCoverage(db, plan, postIds) {
  const active = await db.categories
    .find({ status: 'active' }, { projection: { key: 1, name: 1 } })
    .toArray();

  const coverage = assertCategoryCoverage(plan, active.map((c) => c.key));
  for (const key of coverage.unknown) {
    fail(`a theme names category '${key}', which is not active`);
  }

  const rows = [];
  for (const category of active) {
    const posts = await db.posts.countDocuments({ _id: { $in: postIds }, topicKey: category.key });
    const authors = await db.posts.distinct('userId', { _id: { $in: postIds }, topicKey: category.key });
    rows.push({
      key: category.key, name: category.name, posts, accounts: authors.length
    });
    if (posts === 0) fail(`active category '${category.key}' (${category.name}) has no demo post`);
  }
  return rows;
}

/**
 * Every account can sign in.
 *
 * Verified by deriving the credential the same way the login path does and
 * comparing it against what is stored — not by calling the API, so this works
 * with the API stopped and cannot be fooled by a session that is already open.
 */
async function checkCredentials(db, userIds) {
  const users = await db.users.find(
    { _id: { $in: userIds } }, { projection: { username: 1, email: 1 } }
  ).toArray();

  for (const user of users) {
    const auth = await db.auth.findOne({ userId: user._id, type: 'password' });
    if (!auth) { fail(`${user.username}: no password credential — cannot sign in`); continue; }
    if (!String(auth.value || '').startsWith('scrypt$')) {
      fail(`${user.username}: credential is not in the current scrypt format`);
      continue;
    }
    if (auth.salt !== undefined) {
      fail(`${user.username}: credential carries a legacy salt column, which makes it look like a legacy hash`);
    }
    if (auth.key !== user.email) {
      fail(`${user.username}: auth key '${auth.key}' does not match the account email '${user.email}'`);
    }
    // Re-derive using the parameters stored in the credential itself and
    // compare. This is the same computation the login path performs, so a pass
    // here means the configured password genuinely signs this account in —
    // without needing the API to be running.
    const [, , params, salt, key] = String(auth.value).split('$');
    // Parsed by splitting rather than with a regex: inside a template literal
    // `\d` is not a valid escape and collapses to a bare `d`, which silently
    // turned the pattern into `N=(d+)` and matched nothing.
    const scryptParams = Object.fromEntries(
      params.split(',').map((pair) => {
        const [name, value] = pair.split('=');
        return [name, Number(value)];
      })
    );
    const derived = crypto.scryptSync(
      // What the browser sends: the plaintext, SHA-256'd.
      crypto.createHash('sha256').update(config.seed.password).digest('hex'),
      Buffer.from(salt, 'base64'),
      Buffer.from(key, 'base64').length,
      {
        N: scryptParams.N, r: scryptParams.r, p: scryptParams.p, maxmem: 64 * 1024 * 1024
      }
    );
    if (derived.toString('base64') !== key) {
      fail(`${user.username}: the configured demo password does not verify against the stored credential`);
    }
  }
  return users.length;
}

/**
 * Pinned posts: present, owned, and first in the order the API actually returns.
 *
 * Ordering is not asserted from the schema or from the seeder's intent -- it is
 * read back through `PostSearchService`'s own sort, the same one the creator
 * grid and the detail modal's next/previous sequence page through. A pinned
 * post that sorts correctly in theory and second in practice is the failure
 * this is here to catch.
 */
async function checkPinnedPosts(db, userIds) {
  const perAccount = [];
  let pinnedTotal = 0;
  let pinnedPhotos = 0;
  let pinnedVideos = 0;

  for (const userId of userIds) {
    const user = await db.users.findOne({ _id: userId }, { projection: { username: 1 } });
    const label = user?.username || String(userId);

    // Exactly the sort `creatorPinnedSort` applies, including the `_id`
    // tie-break, so this is the order a client pages through.
    const ordered = await db.posts
      .find({ userId, status: 'active' })
      .sort({
        isPinned: -1, pinnedAt: -1, createdAt: -1, _id: -1
      })
      .toArray();

    const pinned = ordered.filter((post) => post.isPinned);
    if (pinned.length === 0) fail(`${label} has no pinned post`);
    pinnedTotal += pinned.length;

    for (const post of pinned) {
      if (String(post.userId) !== String(userId)) {
        fail(`pinned post ${post._id} is listed under ${label} but belongs to ${post.userId}`);
      }
      if (!post.pinnedAt) fail(`pinned post ${post._id} (${label}) has no pinnedAt, so pinned ordering is undefined`);
      if (post.type === 'photo') pinnedPhotos += 1; else pinnedVideos += 1;
    }

    // Every pinned post ahead of every unpinned one, in the returned order.
    const firstUnpinned = ordered.findIndex((post) => !post.isPinned);
    const lastPinned = ordered.map((post) => Boolean(post.isPinned)).lastIndexOf(true);
    if (firstUnpinned !== -1 && lastPinned > firstUnpinned) {
      fail(`${label}: a pinned post sits at index ${lastPinned}, behind an unpinned post at ${firstUnpinned}`);
    }
    // Pinned posts ordered among themselves, newest pin first.
    for (let i = 1; i < pinned.length; i += 1) {
      if (new Date(pinned[i - 1].pinnedAt).getTime() < new Date(pinned[i].pinnedAt).getTime()) {
        fail(`${label}: pinned posts are not ordered by pinnedAt descending`);
      }
    }

    perAccount.push({
      username: label,
      pinned: pinned.length,
      photos: pinned.filter((post) => post.type === 'photo').length,
      videos: pinned.filter((post) => post.type !== 'photo').length
    });
  }

  // The account a person signs in as must show both kinds pinned, because that
  // is where both are looked at by hand.
  const primary = perAccount.find((row) => row.username === config.seed.social.primaryUsername);
  if (!primary) {
    fail(`the primary account '${config.seed.social.primaryUsername}' is not in the dataset`);
  } else {
    if (primary.photos < 1) fail(`${primary.username} has no pinned photo post`);
    if (primary.videos < 1) fail(`${primary.username} has no pinned video post`);
  }

  if (pinnedPhotos === 0) fail('no pinned photo post anywhere in the dataset');
  if (pinnedVideos === 0) fail('no pinned video post anywhere in the dataset');
  if (!perAccount.some((row) => row.pinned >= 2)) {
    fail('no account pins two posts, so ordering between pinned posts is never exercised');
  }

  return {
    perAccount, pinnedTotal, pinnedPhotos, pinnedVideos
  };
}

/**
 * Notifications: every account has some, at least one unread, every target
 * exists, and nothing notifies its own actor.
 */
async function checkNotifications(db, userIds, postIds, commentIds) {
  const notifications = db.collection('notifications');
  const demoUsers = new Set(userIds.map(String));
  const postSet = new Set(postIds.map(String));
  const commentSet = new Set(commentIds.map(String));

  const rows = await notifications.find({ recipientId: { $in: userIds } }).toArray();
  const byType = {};
  for (const row of rows) byType[row.type] = (byType[row.type] || 0) + 1;

  // `post_share` is deliberately absent from NOTIFICATION_TYPES.
  if (byType.post_share) fail(`${byType.post_share} post_share notification(s) exist, but the product has no such type`);

  const perAccount = [];
  for (const userId of userIds) {
    const mine = rows.filter((r) => String(r.recipientId) === String(userId));
    const unread = mine.filter((r) => !r.read).length;
    const read = mine.length - unread;
    const types = new Set(mine.map((r) => r.type));
    perAccount.push({
      userId: String(userId), total: mine.length, unread, read, types: [...types]
    });

    if (mine.length === 0) fail(`account ${userId} has no notifications`);
    if (unread === 0) fail(`account ${userId} has no unread notification`);
    if (mine.length > 1 && types.size < 2) {
      fail(`account ${userId} has notifications of only one type (${[...types].join(',')})`);
    }

    const storedUnread = await notifications.countDocuments({ recipientId: userId, read: false });
    if (storedUnread !== unread) fail(`account ${userId}: unread count ${storedUnread} disagrees with ${unread}`);
  }

  for (const row of rows) {
    if (String(row.recipientId) === String(row.actorId)) {
      fail(`notification ${row._id} (${row.type}) is a self-notification`);
    }
    if (!demoUsers.has(String(row.actorId))) {
      warn(`notification ${row._id} has a non-demo actor; demo:clean will not remove their side`);
    }
    if (row.postId && !postSet.has(String(row.postId))) {
      fail(`notification ${row._id} points at post ${row.postId}, which is not in the dataset`);
    }
    if (row.commentId && !commentSet.has(String(row.commentId))) {
      fail(`notification ${row._id} points at comment ${row.commentId}, which is not in the dataset`);
    }
  }

  // Group uniqueness is what makes a second run a no-op.
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.recipientId}|${row.groupKey}`;
    if (groups.has(key)) fail(`duplicate notification group '${row.groupKey}' for recipient ${row.recipientId}`);
    groups.set(key, row._id);
  }

  /*
   * Every `comment_like` notification must open onto a comment that really is
   * liked, right now.
   *
   * In production a notification can outlive the like that caused it — somebody
   * likes a comment and later unlikes it, and the row stays as history. This
   * dataset does not model that: it never unlikes anything, so a
   * `comment_like` notification with no surviving like means the like was never
   * written, or the counter that represents it was never reconciled. That is
   * exactly what shipped — four like rows on a comment whose `totalLike` read
   * zero — and it was invisible until somebody clicked the notification.
   *
   * The recipient must own the comment, and the actor must not.
   */
  const commentLikes = rows.filter((row) => row.type === 'comment_like');
  const likedComments = await db.comments
    .find({ _id: { $in: commentLikes.map((row) => row.commentId).filter(Boolean) } })
    .toArray();
  const commentById = new Map(likedComments.map((c) => [String(c._id), c]));

  for (const row of commentLikes) {
    if (!row.commentId) {
      fail(`comment_like notification ${row._id} names no comment`);
      continue;
    }
    const comment = commentById.get(String(row.commentId));
    if (!comment) {
      fail(`comment_like notification ${row._id} points at comment ${row.commentId}, which does not exist`);
      continue;
    }
    const likers = await db.reactions.distinct('createdBy', {
      objectType: 'comment', action: 'like', objectId: comment._id
    });
    if (likers.length === 0) {
      fail(`comment_like notification ${row._id} targets comment ${comment._id}, which has no active like`);
    }
    if ((comment.totalLike || 0) !== likers.length) {
      fail(`comment_like notification ${row._id}: comment ${comment._id} shows totalLike ${comment.totalLike} against ${likers.length} distinct likers`);
    }
    // The actor named on the notification must be one of the people who liked
    // it -- otherwise the notification is describing something that did not
    // happen.
    if (!likers.some((id) => String(id) === String(row.actorId))) {
      fail(`comment_like notification ${row._id}: actor ${row.actorId} has no like on comment ${comment._id}`);
    }
    if (String(comment.createdBy) !== String(row.recipientId)) {
      fail(`comment_like notification ${row._id} goes to ${row.recipientId}, but comment ${comment._id} belongs to ${comment.createdBy}`);
    }
    if (String(comment.createdBy) === String(row.actorId)) {
      fail(`comment_like notification ${row._id}: the actor is the comment's own author`);
    }
  }

  return {
    total: rows.length, byType, perAccount, commentLikesChecked: commentLikes.length
  };
}

/** Conversations, messages, participants and unread counts. */
async function checkMessaging(db, userIds, postIds) {
  const conversations = db.collection('conversations');
  const participants = db.collection('conversation_participants');
  const messages = db.collection('messages');
  const relationships = db.collection('user_relationships');

  const demoUsers = new Set(userIds.map(String));
  const postSet = new Set(postIds.map(String));

  const allConversations = await conversations.find({
    recipientIds: { $in: userIds }
  }).toArray();

  const perAccount = new Map(userIds.map((id) => [String(id), {
    conversations: 0, incoming: 0, outgoing: 0, unreadThreads: 0
  }]));

  let sharedPosts = 0;
  let systemNotices = 0;
  const noticeKeys = new Set();

  for (const conversation of allConversations) {
    if (conversation.recipientIds.length !== 2) {
      fail(`conversation ${conversation._id} has ${conversation.recipientIds.length} participants, expected 2`);
    }
    const [a, b] = conversation.recipientIds.map(String);
    const expectedHash = [a, b].sort().join('_');
    if (conversation.hashKey !== expectedHash) {
      fail(`conversation ${conversation._id}: hashKey does not match its participants`);
    }

    // A state the product cannot reach.
    if (conversation.requestAccepted && conversation.pendingSenderId) {
      fail(`conversation ${conversation._id} is accepted and still has a pending sender`);
    }

    const seats = await participants.find({ conversationId: conversation._id }).toArray();
    if (seats.length !== 2) {
      fail(`conversation ${conversation._id} has ${seats.length} participant rows, expected 2`);
    }
    for (const seat of seats) {
      if (!conversation.recipientIds.some((id) => String(id) === String(seat.userId))) {
        fail(`participant row ${seat._id} names a user who is not in conversation ${conversation._id}`);
      }
    }

    const thread = await messages.find({ conversationId: conversation._id })
      .sort({ createdAt: 1 }).toArray();
    const real = thread.filter((m) => m.type !== 'system');

    if (thread.length === 0) fail(`conversation ${conversation._id} has no messages`);

    for (const message of thread) {
      if (message.type === 'system') {
        systemNotices += 1;
        if (message.senderId) fail(`system notice ${message._id} has a sender`);
        if (!message.systemEventKey) fail(`system notice ${message._id} has no stable key`);
        if (noticeKeys.has(message.systemEventKey)) {
          fail(`duplicate system notice key '${message.systemEventKey}'`);
        }
        noticeKeys.add(message.systemEventKey);
        continue;
      }
      if (!message.senderId) { fail(`message ${message._id} has no sender`); continue; }
      if (!conversation.recipientIds.some((id) => String(id) === String(message.senderId))) {
        fail(`message ${message._id} was sent by somebody outside its conversation`);
      }
      if (message.type === 'post') {
        sharedPosts += 1;
        if (!message.postId) fail(`shared-post message ${message._id} carries no postId`);
        else if (!postSet.has(String(message.postId))) {
          fail(`shared-post message ${message._id} points at a post outside the dataset`);
        }
      }
      const stat = perAccount.get(String(message.senderId));
      if (stat) stat.outgoing += 1;
      const other = conversation.recipientIds.find((id) => String(id) !== String(message.senderId));
      const otherStat = perAccount.get(String(other));
      if (otherStat) otherStat.incoming += 1;
    }

    // A pending thread contains exactly one message, from the pending sender.
    if (conversation.pendingSenderId && !conversation.requestAccepted) {
      const senders = new Set(real.map((m) => String(m.senderId)));
      if (real.length !== 1) {
        fail(`pending conversation ${conversation._id} has ${real.length} messages; the product allows one`);
      }
      if (senders.size > 1 || (senders.size === 1 && !senders.has(String(conversation.pendingSenderId)))) {
        fail(`pending conversation ${conversation._id} contains a message from somebody other than the pending sender`);
      }
    }

    // Preview agrees with the newest non-system message.
    const last = real[real.length - 1] || null;
    if (last) {
      if (String(conversation.lastSenderId) !== String(last.senderId)) {
        fail(`conversation ${conversation._id}: lastSenderId disagrees with the newest message`);
      }
      if (conversation.lastMessageType !== last.type) {
        fail(`conversation ${conversation._id}: lastMessageType is '${conversation.lastMessageType}', newest message is '${last.type}'`);
      }
    }

    // Unread counts recomputed from the messages.
    for (const seat of seats) {
      const expectedUnread = real.filter((m) => String(m.senderId) !== String(seat.userId)
        && (!seat.lastReadAt || m.createdAt > seat.lastReadAt)).length;
      if ((seat.unreadCount || 0) !== expectedUnread) {
        fail(`participant ${seat.userId} in ${conversation._id}: unreadCount ${seat.unreadCount}, recount ${expectedUnread}`);
      }
      const stat = perAccount.get(String(seat.userId));
      if (stat) {
        stat.conversations += 1;
        if (expectedUnread > 0) stat.unreadThreads += 1;
      }
    }
  }

  // Permission states must not be violated by a seeded message.
  const flags = await relationships.find({
    $or: [{ userId: { $in: userIds } }, { targetId: { $in: userIds } }]
  }).toArray();
  const byPair = new Map();
  for (const flag of flags) byPair.set(`${flag.userId}|${flag.targetId}|${flag.type}`, flag);

  for (const conversation of allConversations) {
    const [a, b] = conversation.recipientIds;
    const thread = await messages.find({
      conversationId: conversation._id, type: { $ne: 'system' }
    }).sort({ createdAt: 1 }).toArray();
    for (const message of thread) {
      const sender = String(message.senderId);
      const recipient = String(a) === sender ? String(b) : String(a);
      const blocked = byPair.get(`${recipient}|${sender}|block`) || byPair.get(`${sender}|${recipient}|block`);
      const restricted = byPair.get(`${recipient}|${sender}|restrict`);
      // A flag set after the message was sent is legitimate history.
      if (blocked && message.createdAt > blocked.createdAt) {
        fail(`message ${message._id} was sent after a block was in place`);
      }
      if (restricted && message.createdAt > restricted.createdAt) {
        fail(`message ${message._id} was sent by a restricted sender`);
      }
    }
  }

  for (const [userId, stat] of perAccount.entries()) {
    if (stat.conversations < 2) fail(`account ${userId} has ${stat.conversations} conversation(s), expected at least 2`);
    if (stat.incoming === 0) fail(`account ${userId} has no incoming messages`);
    if (stat.outgoing === 0) fail(`account ${userId} has no outgoing messages`);
    if (stat.unreadThreads === 0) fail(`account ${userId} has no conversation with unread messages`);
  }

  return {
    conversations: allConversations.length,
    messages: await messages.countDocuments({
      conversationId: { $in: allConversations.map((c) => c._id) }
    }),
    sharedPosts,
    systemNotices,
    relationships: flags.length,
    perAccount
  };
}

/**
 * ffprobe the real dimensions of a local file.
 *
 * `{ unavailable: true }` and `null` mean different things: the first is "the
 * tool is not installed here", the second is "this file did not probe". Both
 * used to collapse into `null` and then into a per-file failure, so running
 * verification in the production api image — which carries no ffmpeg — reported
 * all 224 cached videos as broken. A check that cannot run has not failed.
 */
function probeDimensions(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', file],
      { timeout: 60000, maxBuffer: 262144, windowsHide: true },
      (error, stdout) => {
        if (error?.code === 'ENOENT') return resolve({ unavailable: true });
        if (error) return resolve(null);
        try {
          const streams = JSON.parse(stdout).streams || [];
          const video = streams.find((v) => v.codec_type === 'video' && v.disposition?.attached_pic !== 1);
          return resolve(video ? { width: Number(video.width), height: Number(video.height) } : null);
        } catch { return resolve(null); }
      });
  });
}

/**
 * The manifest's orientation claims are measurements, and each post's poster
 * came from that post's own video.
 *
 * The orientation of every post in the dataset is decided by the manifest, so an
 * entry whose `orientation` disagrees with the file it names would place a
 * portrait clip in a landscape slot and no other check would notice. Re-probing
 * is the only way to know.
 */
async function checkManifestOrientation(ledger) {
  const manifest = manifestLib.load(config.MANIFEST_PATH);
  const index = manifestLib.index(manifest, config.MEDIA_DIR);

  // Only the entries this dataset actually consumed: the ledger names them.
  const fileRows = await ledger.all(KINDS.FILE);
  const usedMediaKeys = new Set(
    fileRows.filter((r) => r.seedKey.startsWith('file:media:')).map((r) => r.seedKey.slice('file:media:'.length))
  );

  const planned = resolveAccountPlan(config, config.themes);
  if (!planned.ok) return { checked: 0, videos: 0 };

  const videos = index.live.filter((e) => e.kind === 'video');
  let checked = 0;
  const byLocalFile = new Map();

  // Poster-frame integrity needs no probe, so it runs whether ffprobe is here
  // or not.
  for (const entry of videos) {
    // A poster frame belongs to exactly one video.
    if (!entry.thumbnail) fail(`manifest: video ${entry.localFile} has no extracted poster frame`);
    else if (byLocalFile.has(entry.thumbnail.localFile)) {
      fail(`manifest: poster ${entry.thumbnail.localFile} is claimed by two videos`);
    } else byLocalFile.set(entry.thumbnail.localFile, entry.localFile);
  }

  // The measurements do.
  for (const entry of videos) {
    const real = await probeDimensions(path.join(config.MEDIA_DIR, entry.localFile));
    if (real?.unavailable) {
      warn(`ffprobe is not installed here, so the manifest's own width/height/orientation claims `
        + `were not re-checked (${videos.length} videos). The api image carries no ffmpeg by design; `
        + 'run this where it is available to cover that. Everything else above still ran.');
      break;
    }
    checked += 1;
    if (!real) { fail(`manifest: ${entry.localFile} could not be probed`); continue; }

    const realOrientation = real.width > real.height ? 'landscape'
      : real.width < real.height ? 'portrait' : 'square';
    if (real.width !== entry.width || real.height !== entry.height) {
      fail(`manifest: ${entry.localFile} claims ${entry.width}x${entry.height}, ffprobe says ${real.width}x${real.height}`);
    }
    if (realOrientation !== entry.orientation) {
      fail(`manifest: ${entry.localFile} claims orientation '${entry.orientation}', ffprobe says '${realOrientation}'`);
    }
    const realAspect = Math.round((real.width / real.height) * 100) / 100;
    if (Math.abs(realAspect - (entry.aspectRatio || 0)) > 0.011) {
      fail(`manifest: ${entry.localFile} claims aspectRatio ${entry.aspectRatio}, ffprobe says ${realAspect}`);
    }
    // The purpose bucket must agree with the measurement.
    const bucket = entry.purpose.endsWith('landscape') ? 'landscape'
      : entry.purpose.endsWith('portrait') ? 'portrait' : null;
    if (bucket && bucket !== realOrientation) {
      fail(`manifest: ${entry.localFile} sits in '${entry.purpose}' but is ${realOrientation}`);
    }
  }

  // No media file may be consumed by two posts.
  const seen = new Map();
  for (const key of usedMediaKeys) {
    if (seen.has(key)) fail(`media slot '${key}' is claimed twice`);
    seen.set(key, true);
  }

  return { checked, videos: videos.length };
}

/**
 * Recommendation histories: that they exist, that the aggregates match the raw
 * events they were built from, and that the personas they encode really are
 * different from one another.
 *
 * The aggregates are **re-derived** here from the raw `recommendation_events`
 * rows through the same adapter the seeder wrote them with, rather than
 * compared against numbers this file decides on. That is the point: if the
 * seeder's arithmetic and the engine's policy ever disagree, this fails —
 * whereas a hand-written expectation would just encode the same mistake twice.
 */
async function checkRecommendations(db, userIds, postIds) {
  const adapter = createRecommendationAdapter({ db, ledger: null });
  /*
   * A lightweight stand-in for the seeder's plan. Verification deliberately
   * does not rebuild the full plan: that needs the media manifest, and a check
   * that cannot run without the fetch phase's output is a check that stops
   * running. Everything needed here — who the accounts are and which category
   * each one's persona is built around — comes from the themes config plus the
   * seeded users themselves.
   */
  const seededUsers = await db.users.find(
    { _id: { $in: userIds } }, { projection: { username: 1 } }
  ).toArray();
  const userIdByUsername = new Map(seededUsers.map((user) => [user.username, user._id]));
  const accounts = config.themes.flatMap((theme) => (theme.accounts || [])
    .filter((persona) => userIdByUsername.has(persona.username))
    .map((persona) => ({ username: persona.username, topicKey: theme.topicKey })));
  const plan = { accounts, userIds: userIdByUsername };
  const report = {
    events: 0, subjects: 0, statRows: 0, coldStart: 0, distinctPrimaries: 0
  };

  const events = await db.recommendationEvents.find({ userId: { $in: userIds } }).toArray();
  report.events = events.length;
  if (!events.length) {
    fail('no recommendation events seeded — every account would fall back to the guest mix');
    return report;
  }

  const posts = await db.posts.find({ _id: { $in: postIds } }).toArray();
  const postById = new Map(posts.map((post) => [post._id.toString(), post]));
  const mediaRows = await db.postMedia.find({ postId: { $in: postIds }, ordering: 0 }).toArray();
  const durationByPost = new Map(mediaRows.map((row) => [row.postId.toString(), row.durationMs ?? null]));

  const expectedStats = new Map();
  const expectedAffinity = new Map();
  const commentClaims = [];
  const followCredited = new Set();
  const impressionPairs = new Set();

  // Impressions first: `follow_after_view` is only legitimate after one, and
  // the events are not necessarily read back in the order they were written.
  for (const event of events) {
    if (event.eventType === 'impression') impressionPairs.add(`${event.userId}:${event.postId}`);
  }

  for (const event of events) {
    const post = postById.get(event.postId.toString());
    if (!post) {
      fail(`recommendation event ${event._id} points at a post outside the demo dataset`);
      continue;
    }
    const media = {
      creatorId: post.userId,
      topicKey: post.topicKey || null,
      tags: post.tags || [],
      isPhoto: (post.mediaTypes || []).includes('photo') || post.type === 'photo',
      isVideo: (post.mediaTypes || []).includes('video') || post.type === 'video',
      canonicalDurationMs: durationByPost.get(event.postId.toString()) || null
    };
    const { inc, affinityWeight } = adapter.effectsOf({
      eventType: event.eventType,
      watchMs: event.watchMs === null ? undefined : event.watchMs,
      dwellMs: event.dwellMs === null ? undefined : event.dwellMs
    }, media);

    const postKey = event.postId.toString();
    const stat = expectedStats.get(postKey) || {};
    for (const [field, value] of Object.entries(inc)) stat[field] = (stat[field] || 0) + value;
    expectedStats.set(postKey, stat);

    if (affinityWeight && media.topicKey) {
      const subject = event.userId.toString();
      const byTopic = expectedAffinity.get(subject) || new Map();
      byTopic.set(media.topicKey, (byTopic.get(media.topicKey) || 0) + affinityWeight);
      expectedAffinity.set(subject, byTopic);
    }

    if (event.eventType === 'comment') commentClaims.push(event);

    if (event.eventType === 'follow_after_view') {
      const key = `${event.userId}:${post.userId}`;
      if (followCredited.has(key)) {
        fail(`follow_after_view credited twice for subject ${event.userId} and creator ${post.userId}`);
      }
      followCredited.add(key);
      if (!impressionPairs.has(`${event.userId}:${event.postId}`)) {
        fail(`follow_after_view for post ${event.postId} has no real impression by ${event.userId}`);
      }
      const follows = await db.reactions.countDocuments({
        action: 'follow', objectType: 'creator', objectId: post.userId, createdBy: event.userId
      });
      if (!follows) {
        fail(`follow_after_view for creator ${post.userId} but ${event.userId} does not actually follow them`);
      }
    }
  }

  // A completion must rest on a canonical duration, never on the client's word.
  const completionMinRatio = adapter.policy.WATCH_QUALITY_POLICY.video.completionMinRatio;
  for (const event of events) {
    if (event.eventType !== 'completion') continue;
    if (!durationByPost.get(event.postId.toString())) {
      fail(`completion recorded for post ${event.postId}, which has no canonical duration`);
    } else if (event.watchRatio === null || event.watchRatio < completionMinRatio) {
      fail(`completion for post ${event.postId} has watchRatio ${event.watchRatio}, below the threshold`);
    }
  }

  // Each replay is its own occurrence; a retry of one would share its key.
  const replayKeys = events.filter((event) => event.eventType === 'replay').map((event) => event.dedupeKey);
  if (replayKeys.some((key) => !key)) fail('a replay event has no dedupe key, so a retry would double-count it');
  if (new Set(replayKeys).size !== replayKeys.length) {
    fail('two replay events share a dedupe key — occurrences are not distinct');
  }

  // A comment signal must name a real comment, written by that account, on that post.
  for (const event of commentClaims) {
    const claimedId = String(event.dedupeKey || '').split(':').pop();
    if (!ObjectId.isValid(claimedId)) {
      fail(`comment event ${event._id} carries no usable comment id`);
      continue;
    }
    const comment = await db.comments.findOne({ _id: new ObjectId(claimedId) });
    if (!comment) {
      fail(`comment event ${event._id} names comment ${claimedId}, which does not exist`);
      continue;
    }
    if (comment.createdBy.toString() !== event.userId.toString()) {
      fail(`comment event ${event._id} claims credit for a comment written by somebody else`);
    }
    const belongsDirectly = comment.objectType === 'post'
      && comment.objectId.toString() === event.postId.toString();
    if (!belongsDirectly) {
      fail(`comment event ${event._id} names a comment that does not belong to post ${event.postId}`);
    }
  }

  // The stats must equal what the events imply.
  const statRows = await db.postRecommendationStats.find({ postId: { $in: postIds } }).toArray();
  report.statRows = statRows.length;
  for (const row of statRows) {
    const expected = expectedStats.get(row.postId.toString()) || {};
    for (const [field, value] of Object.entries(expected)) {
      const actual = row[field] || 0;
      if (Math.abs(actual - value) > 1e-6) {
        fail(`post ${row.postId}: ${field} is ${actual} but its events imply ${value}`);
      }
    }
  }

  // The affinities must equal what the events imply, per category.
  const affinities = await db.userRecommendationAffinities.find({
    subjectId: { $in: userIds.map((id) => id.toString()) }
  }).toArray();
  report.subjects = affinities.length;
  for (const affinity of affinities) {
    if (affinity.isAuthenticatedUser !== true) {
      fail(`affinity ${affinity.subjectId} is not marked as an authenticated subject`);
    }
    const expected = expectedAffinity.get(affinity.subjectId) || new Map();
    for (const [topicKey, value] of expected) {
      const actual = affinity.categoryScores?.[topicKey]?.score ?? 0;
      if (Math.abs(actual - value) > 1e-6) {
        fail(`affinity ${affinity.subjectId}: category '${topicKey}' is ${actual} but its events imply ${value}`);
      }
    }
  }

  // A guest has no affinity profile — the seed writes nothing anonymous.
  const anonymous = await db.userRecommendationAffinities.countDocuments({ isAuthenticatedUser: false });
  if (anonymous > 0) fail(`${anonymous} anonymous affinity profile(s) exist; the seed writes none`);

  /*
   * Personas genuinely differ.
   *
   * The assertion is *not* "each account's strongest category is its own",
   * which sounds right and is wrong here: nobody is ever shown their own
   * posts, and ten of the thirteen seeded categories have a single account,
   * so those accounts can never accumulate any affinity in their own
   * category at all. What must hold is that the strongest signal lands
   * somewhere inside that persona's declared taste — its primary category or
   * one of its two neighbours — and never on an off-persona category, which
   * is what would happen if the histories were undifferentiated noise.
   */
  const tops = new Map();
  for (const account of plan.accounts) {
    const subjectId = plan.userIds.get(account.username)?.toString();
    const affinity = affinities.find((row) => row.subjectId === subjectId);
    if (!affinity) {
      fail(`account ${account.username} has no recommendation affinity profile`);
      continue;
    }
    const ranked = Object.entries(affinity.categoryScores || {})
      .map(([key, value]) => [key, value?.score ?? 0])
      .sort((a, b) => b[1] - a[1]);
    const top = ranked[0]?.[0];
    const persona = personaFor({ username: account.username, topicKey: account.topicKey, posts: [] });
    const withinTaste = [persona.primary, ...persona.secondary];
    if (!withinTaste.includes(top)) {
      fail(`account ${account.username}: strongest category is '${top}', outside its persona `
        + `(${withinTaste.join(', ')}) — the history is not differentiated`);
    }
    // And the off-persona categories must sit below the persona's own.
    const topOff = ranked.find(([key]) => !withinTaste.includes(key));
    const topWithin = ranked.find(([key]) => withinTaste.includes(key));
    if (topOff && topWithin && topOff[1] >= topWithin[1]) {
      fail(`account ${account.username}: off-persona category '${topOff[0]}' (${topOff[1].toFixed(2)}) `
        + `outranks its own '${topWithin[0]}' (${topWithin[1].toFixed(2)})`);
    }
    tops.set(account.username, top);
  }
  report.distinctPrimaries = new Set(tops.values()).size;
  if (report.distinctPrimaries < 5) {
    fail(`only ${report.distinctPrimaries} distinct strongest categories across `
      + `${plan.accounts.length} accounts — the personas are not meaningfully different`);
  }

  // Cold start: a handful of impressions, no watch, no engagement at all.
  const coldRows = statRows.filter((row) => (row.weightedEngagement || 0) === 0
    && (row.impressions || 0) > 0
    && (row.watchSampleCount || 0) === 0
    && (row.dwellSampleCount || 0) === 0);
  report.coldStart = coldRows.length;
  if (coldRows.length === 0) {
    fail('no cold-start posts found — every post already carries watch or engagement history');
  }
  for (const row of coldRows) {
    const post = postById.get(row.postId.toString());
    if (!post) continue;
    if ((post.totalLike || 0) || (post.totalComment || 0) || (post.totalShare || 0)) {
      fail(`cold-start post ${post._id} has real engagement `
        + `(${post.totalLike}/${post.totalComment}/${post.totalShare})`);
    }
    if (post.status !== 'active') fail(`cold-start post ${post._id} is not active, so it can never be explored`);
    if (!post.userId) fail(`cold-start post ${post._id} has no creator`);
  }

  // Everything the recommender can serve must be servable.
  const inactive = await db.posts.countDocuments({ _id: { $in: postIds }, status: { $ne: 'active' } });
  if (inactive > 0) fail(`${inactive} demo post(s) are not active and would never be recommended`);

  /*
   * Every post needs a `recoShuffleKey`, and a missing one is invisible
   * rather than loud.
   *
   * Two of the five candidate sources — fresh discovery and diverse
   * discovery — find candidates with an indexed range scan over this field,
   * and a missing field never satisfies `$gte`. When the seeder omitted it,
   * both buckets returned nothing at all and every feed was quietly built
   * from the 14-day trending window alone: a guest session held 36 of 160
   * posts, all labelled `trending`, and nothing errored. This is the check
   * that would have caught it.
   */
  const missingShuffleKey = await db.posts.countDocuments({
    _id: { $in: postIds },
    $or: [{ recoShuffleKey: { $exists: false } }, { recoShuffleKey: null }]
  });
  if (missingShuffleKey > 0) {
    fail(`${missingShuffleKey} demo post(s) have no recoShuffleKey — the fresh and diverse `
      + 'candidate sources cannot see them, so the feed silently degrades to trending only');
  }
  report.missingShuffleKey = missingShuffleKey;

  return report;
}

async function main() {
  logger.step('Demo dataset verification');

  const connections = env.loadSeedConnections();
  const db = await dbLib.connect(connections.mongoUri);
  const pipeline = createFilePipeline({
    baseUrl: connections.fileServerBaseUrl,
    apiKey: connections.fileServerApiKey,
    internalApiKey: connections.internalApiKey
  });

  try {
    const health = await pipeline.ping();
    if (!health.ok) throw new Error(health.reason);

    const ledger = createLedger(db.ledger, config.seed.namespace);
    const counts = await ledger.counts();
    if (!counts.user) {
      logger.error('nothing seeded — the demo ledger has no accounts. Run: yarn demo:seed');
      process.exitCode = 1;
      return;
    }

    const userIds = await ledger.idsOf(KINDS.USER);
    const postIds = await ledger.idsOf(KINDS.POST);
    const commentIds = await ledger.idsOf(KINDS.COMMENT);

    logger.step('Profile media (avatar + cover)');
    const profiles = await checkProfileMedia(db, userIds);
    logger.detail(`${profiles.probed} URLs probed`);

    logger.step('Post media (photos, videos, posters, covers)');
    const postMedia = await checkPostMedia(db, postIds, pipeline);
    logger.detail(`${postMedia.filesChecked} file records checked, ${postMedia.urlsProbed} URLs probed`);

    logger.step('File uniqueness');
    const uniqueFiles = await checkNoSharedFiles(db, postMedia.posts, profiles.users);
    logger.detail(`${uniqueFiles} distinct files, none shared between posts or profiles`);

    logger.step('Counters');
    const counters = await checkCounters(db, userIds, postIds, commentIds);
    logger.detail(`${counters.posts} posts, ${counters.users} users, ${counters.comments} comments (${counters.replies} of them replies) recounted — totalLike and totalReply both against their rows`);

    logger.step('Referential integrity');
    const integrity = await checkReferentialIntegrity(db, userIds, postIds);
    logger.detail(`${integrity.posts} posts, ${integrity.media} media rows, ${integrity.reactions} reactions`);

    logger.step('Composition (accounts, post mix, orientation)');
    const composition = await checkComposition(db, userIds);
    if (composition) {
      logger.detail(`${userIds.length} accounts, ${composition.totals.posts} posts: `
        + `${composition.totals.landscape} landscape video, ${composition.totals.portrait} portrait video, `
        + `${composition.totals.photos} photo`);
    }

    logger.step('Pinned posts');
    const pinnedReport = await checkPinnedPosts(db, userIds);
    logger.detail(`${pinnedReport.pinnedTotal} pinned posts across ${userIds.length} accounts `
      + `(${pinnedReport.pinnedPhotos} photo, ${pinnedReport.pinnedVideos} video), `
      + 'each ahead of every unpinned post in the API sort');
    for (const row of pinnedReport.perAccount) {
      logger.detail(`  ${row.username.padEnd(20)} ${row.pinned} pinned `
        + `(${row.photos} photo, ${row.videos} video)`);
    }

    logger.step('Category coverage');
    const categories = composition
      ? await checkCategoryCoverage(db, composition.plan, postIds)
      : [];
    for (const row of categories) {
      logger.detail(`${row.key.padEnd(13)} ${String(row.posts).padStart(3)} posts  ${row.accounts} account(s)  ${row.name}`);
    }

    logger.step('Credentials');
    const checked = await checkCredentials(db, userIds);
    logger.detail(`${checked} accounts checked against the configured demo password`);

    logger.step('Notifications');
    const notificationReport = await checkNotifications(db, userIds, postIds, commentIds);
    logger.detail(`${notificationReport.total} notifications: `
      + Object.entries(notificationReport.byType).map(([t, n]) => `${t}=${n}`).join(', '));
    logger.detail(`${notificationReport.commentLikesChecked} comment_like notifications traced to an active like `
      + 'on the comment they name, with matching totalLike');

    logger.step('Manifest orientation (re-probed with ffprobe)');
    const manifestReport = await checkManifestOrientation(ledger);
    logger.detail(`${manifestReport.checked} of ${manifestReport.videos} cached videos re-probed`);

    logger.step('Recommendation histories');
    const reco = await checkRecommendations(db, userIds, postIds);
    logger.detail(`${reco.events} events, ${reco.subjects} viewer profiles, ${reco.statRows} post stat rows, `
      + `${reco.coldStart} cold-start posts, ${reco.distinctPrimaries} distinct persona categories, `
      + `${reco.missingShuffleKey} posts missing a recoShuffleKey`);

    logger.step('Conversations and messages');
    const messagingReport = await checkMessaging(db, userIds, postIds);
    logger.detail(`${messagingReport.conversations} conversations, ${messagingReport.messages} messages, `
      + `${messagingReport.sharedPosts} shared posts, ${messagingReport.systemNotices} system notices, `
      + `${messagingReport.relationships} block/restrict rows`);

    logger.step('Result');
    for (const message of warnings) logger.warn(message);
    if (failures.length === 0) {
      logger.ok(`everything checks out — ${counters.users} accounts, ${counters.posts} posts, `
        + `${postMedia.filesChecked} files all served and referenced`);
      if (warnings.length > 0) logger.detail(`${warnings.length} warning(s) above are informational`);
      return;
    }
    for (const message of failures) logger.error(message);
    logger.error(`${failures.length} problem(s) found`);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  logger.error(error);
  process.exit(1);
});
