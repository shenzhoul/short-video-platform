/**
 * Where, precisely, a session breaks its diversity constraints.
 *
 * `RecommendationDiversityService.rerank` enforces its caps per output batch
 * (`DIVERSITY_POLICY.batchSize`), so a violation at a batch *boundary* is a
 * different fact from a violation *inside* one: the first is a known
 * consequence of batch-local re-ranking, the second means the re-ranker
 * failed at its own job. A count that lumps them together cannot tell you
 * which you have.
 *
 * Read-only. Usage:
 *   node scripts/audit-feed-diversity.js
 *   node scripts/audit-feed-diversity.js --sessions=3
 */

const API = (process.argv.find((a) => a.startsWith('--api=')) || '--api=http://localhost:8080').split('=')[1];
const SESSIONS = Number((process.argv.find((a) => a.startsWith('--sessions=')) || '--sessions=3').split('=')[1]);

const BATCH_SIZE = 20;
const MAX_SAME_CREATOR_PER_BATCH = 2;
const MAX_SAME_CATEGORY_PER_BATCH = 6;

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function fullSession(anonymousId) {
  const url = new URL(`${API}/posts/home-posts`);
  url.searchParams.set('anonymousId', anonymousId);
  const body = (await (await fetch(url)).json())?.data;
  const posts = [...(body?.data || [])];
  let cursor = body?.nextCursor;
  let pages = 0;
  while (cursor && pages < 25) {
    const next = new URL(`${API}/posts/home-posts`);
    next.searchParams.set('anonymousId', anonymousId);
    next.searchParams.set('sessionId', body.sessionId);
    next.searchParams.set('cursor', cursor);
    // eslint-disable-next-line no-await-in-loop
    const page = (await (await fetch(next)).json())?.data;
    posts.push(...(page?.data || []));
    cursor = page?.hasMore ? page.nextCursor : null;
    pages += 1;
    // eslint-disable-next-line no-await-in-loop
    await sleep(120);
  }
  return { sessionId: body?.sessionId, posts };
}

const creatorOf = (post) => post?.user?.username || post?.user?._id || '(unknown)';

function analyse(posts) {
  const adjacentInside = [];
  const adjacentAcrossBoundary = [];
  posts.forEach((post, index) => {
    if (index === 0) return;
    if (creatorOf(post) !== creatorOf(posts[index - 1])) return;
    // Positions are 1-based batches: index 20 is the first of batch 2.
    const sameBatch = Math.floor((index - 1) / BATCH_SIZE) === Math.floor(index / BATCH_SIZE);
    (sameBatch ? adjacentInside : adjacentAcrossBoundary).push({
      position: index + 1, creator: creatorOf(post)
    });
  });

  const creatorCapBreaches = [];
  const categoryCapBreaches = [];
  for (let start = 0; start < posts.length; start += BATCH_SIZE) {
    const batch = posts.slice(start, start + BATCH_SIZE);
    // A trailing partial batch is not a batch the re-ranker ever shaped.
    if (batch.length < BATCH_SIZE) break;
    const byCreator = new Map();
    const byCategory = new Map();
    batch.forEach((post) => {
      byCreator.set(creatorOf(post), (byCreator.get(creatorOf(post)) || 0) + 1);
      byCategory.set(post.topicKey, (byCategory.get(post.topicKey) || 0) + 1);
    });
    byCreator.forEach((count, creator) => {
      if (count > MAX_SAME_CREATOR_PER_BATCH) {
        creatorCapBreaches.push({ batch: start / BATCH_SIZE + 1, creator, count });
      }
    });
    byCategory.forEach((count, category) => {
      if (count > MAX_SAME_CATEGORY_PER_BATCH) {
        categoryCapBreaches.push({ batch: start / BATCH_SIZE + 1, category, count });
      }
    });
  }

  return {
    adjacentInside, adjacentAcrossBoundary, creatorCapBreaches, categoryCapBreaches
  };
}

async function main() {
  console.log(`batch size ${BATCH_SIZE}, max ${MAX_SAME_CREATOR_PER_BATCH} per creator, `
    + `max ${MAX_SAME_CATEGORY_PER_BATCH} per category\n`);

  let insideTotal = 0;
  let boundaryTotal = 0;
  let creatorBreachTotal = 0;
  let categoryBreachTotal = 0;

  for (let i = 0; i < SESSIONS; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    const session = await fullSession(`diversity-audit-${Date.now()}-${i}`);
    const report = analyse(session.posts);
    insideTotal += report.adjacentInside.length;
    boundaryTotal += report.adjacentAcrossBoundary.length;
    creatorBreachTotal += report.creatorCapBreaches.length;
    categoryBreachTotal += report.categoryCapBreaches.length;

    console.log(`session ${i + 1}: ${session.posts.length} posts`);
    console.log(`  same-creator adjacency INSIDE a batch:   ${report.adjacentInside.length}`
      + (report.adjacentInside.length ? ` ${JSON.stringify(report.adjacentInside)}` : ''));
    console.log(`  same-creator adjacency ACROSS a boundary: ${report.adjacentAcrossBoundary.length}`
      + (report.adjacentAcrossBoundary.length ? ` ${JSON.stringify(report.adjacentAcrossBoundary)}` : ''));
    console.log(`  creator cap breaches:  ${report.creatorCapBreaches.length}`
      + (report.creatorCapBreaches.length ? ` ${JSON.stringify(report.creatorCapBreaches)}` : ''));
    console.log(`  category cap breaches: ${report.categoryCapBreaches.length}`
      + (report.categoryCapBreaches.length ? ` ${JSON.stringify(report.categoryCapBreaches)}` : ''));
    // eslint-disable-next-line no-await-in-loop
    await sleep(6000);
  }

  console.log('\n=== Verdict ===');
  console.log(`  ${insideTotal === 0 ? '✓' : '✗'} no same-creator adjacency inside a batch (${insideTotal})`);
  console.log(`  ${creatorBreachTotal === 0 ? '✓' : '✗'} creator cap holds in every full batch (${creatorBreachTotal})`);
  console.log(`  ${categoryBreachTotal === 0 ? '✓' : '✗'} category cap holds in every full batch (${categoryBreachTotal})`);
  console.log(`  ~ same-creator adjacency across a batch boundary: ${boundaryTotal} `
    + '(the re-ranker shapes each batch independently, so a boundary pair is outside what it constrains)');

  if (insideTotal || creatorBreachTotal || categoryBreachTotal) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
