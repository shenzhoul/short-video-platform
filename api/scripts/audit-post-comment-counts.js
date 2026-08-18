/**
 * Audit (and optionally repair) drift in `Post.totalComment`.
 *
 * Before the fix in `CommentContentListener`, deleting a comment computed
 * `-(1 + totalReply)`. `totalReply` is absent on a comment that never had a
 * reply, so that became NaN, and the update pipeline's `$max: [0, NaN]`
 * resolved to 0 — a single deletion silently zeroed a post's entire comment
 * count. Live counting is fixed, but values written before then may still be
 * wrong, and nothing recomputes them at runtime.
 *
 * Usage:
 *   node scripts/audit-post-comment-counts.js            # dry run (default)
 *   node scripts/audit-post-comment-counts.js --apply    # write corrections
 *
 * Mutation is never the default. The script is a one-off maintenance tool and
 * is deliberately not wired into startup or any request path — the atomic live
 * counter remains the normal architecture.
 */
require('dotenv').config();
const mongoose = require('mongoose');

const APPLY = process.argv.includes('--apply');

/**
 * Authoritative count for one post.
 *
 * Mirrors the live semantics exactly: `totalComment` counts top-level comments
 * *and* replies. Comments are physically deleted in this schema — there is no
 * soft-delete flag — so anything still present is a real comment, and a deleted
 * comment's replies are removed with it.
 */
async function countComments(db, postId) {
  const topLevel = await db.collection('comments')
    .find({ objectType: 'post', objectId: postId })
    .project({ _id: 1 })
    .toArray();
  if (!topLevel.length) return 0;

  const replies = await db.collection('comments').countDocuments({
    objectType: 'comment',
    objectId: { $in: topLevel.map((comment) => comment._id) }
  });

  return topLevel.length + replies;
}

(async () => {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db;

  const posts = await db.collection('posts')
    .find({})
    .project({ _id: 1, totalComment: 1 })
    .toArray();

  const mismatches = [];
  for (const post of posts) {
    const stored = post.totalComment || 0;
    // Sequential on purpose: this is a maintenance pass, and hammering the
    // database in parallel is not worth the few seconds it would save.
    // eslint-disable-next-line no-await-in-loop
    const actual = await countComments(db, post._id);
    if (stored !== actual) mismatches.push({ postId: post._id, stored, actual });
  }

  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`posts scanned:    ${posts.length}`);
  console.log(`posts correct:    ${posts.length - mismatches.length}`);
  console.log(`posts mismatched: ${mismatches.length}`);

  if (mismatches.length) {
    const tooLow = mismatches.filter((m) => m.stored < m.actual).length;
    const drift = mismatches.map((m) => Math.abs(m.actual - m.stored));
    console.log(`  stored too low:  ${tooLow}`);
    console.log(`  stored too high: ${mismatches.length - tooLow}`);
    console.log(`  max drift:       ${Math.max(...drift)}`);
    console.log('\npostId                     stored  actual  diff');
    // Ids and counts only — no comment text or user data.
    mismatches.forEach((m) => console.log(
      `${m.postId}  ${String(m.stored).padStart(6)}  ${String(m.actual).padStart(6)}  ${m.actual - m.stored > 0 ? '+' : ''}${m.actual - m.stored}`
    ));
  }

  if (APPLY && mismatches.length) {
    // Idempotent: a second run recomputes and finds nothing to change.
    let repaired = 0;
    for (const m of mismatches) {
      // eslint-disable-next-line no-await-in-loop
      const result = await db.collection('posts').updateOne(
        { _id: m.postId },
        { $set: { totalComment: m.actual } }
      );
      if (result.modifiedCount) repaired += 1;
    }
    console.log(`\nrepaired: ${repaired}`);
  } else if (mismatches.length) {
    console.log('\ndry run — nothing written. Re-run with --apply to correct these.');
  }

  await mongoose.disconnect();
  process.exit(0);
})().catch((error) => {
  console.error('audit failed:', error.message);
  process.exit(1);
});
