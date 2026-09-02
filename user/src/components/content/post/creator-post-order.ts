import { IPost } from '@interfaces/post';

/**
 * The order a creator's own posts are listed in.
 *
 * This mirrors, exactly, the sort the API applies to `GET /posts/creator/:id`
 * (`creatorPinnedSort` in `post-search.service.ts`):
 *
 *     { isPinned: -1, pinnedAt: -1, createdAt: -1, _id: -1 }
 *
 * It exists so that the creator grid, the current-post highlight and the
 * next/previous sequence all read from **one** definition of "the order". When
 * each of those sorted for itself, the grid and the arrows could disagree about
 * what came next, and the disagreement only showed up on the posts that happened
 * to sit near a boundary.
 *
 * Keep it in step with the API. A change to `creatorPinnedSort` that is not
 * mirrored here shows up as a thumbnail highlight that lands on the wrong tile.
 */

const time = (value?: Date | string | null) => (value ? new Date(value).getTime() : 0);

/**
 * Compare two posts as the creator list orders them.
 *
 * Returns < 0 when `a` comes first, matching `Array.prototype.sort`.
 */
export function compareCreatorPosts(a: IPost, b: IPost): number {
  // 1. Pinned posts lead, whatever their date.
  const pinned = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
  if (pinned !== 0) return pinned;

  // 2. Within the pinned group, most recently pinned first. Non-pinned posts
  //    all carry no `pinnedAt`, so this is a no-op for them and the comparison
  //    falls through to the date.
  const byPinnedAt = time(b.pinnedAt) - time(a.pinnedAt);
  if (byPinnedAt !== 0) return byPinnedAt;

  // 3. Newest first.
  const byCreatedAt = time(b.createdAt) - time(a.createdAt);
  if (byCreatedAt !== 0) return byCreatedAt;

  // 4. A stable tie-break, so two posts written in the same millisecond do not
  //    swap places between renders. ObjectId hex sorts the same way the server's
  //    `_id: -1` does, because the bytes are encoded most-significant first.
  return String(b._id).localeCompare(String(a._id));
}

/**
 * Place `post` into an already-ordered list, without disturbing that order.
 *
 * The list is what the API returned; `post` is the one currently open, which may
 * not have arrived yet if it lives on a later page. Appending it -- which is what
 * this used to do -- put it at the end of the grid no matter where it belongs,
 * so the highlighted tile and the arrows pointed at different neighbours.
 *
 * Returns the same array instance when the post is already present, so callers
 * can keep their state identity and skip a re-render.
 */
export function insertPostInOrder(posts: IPost[], post: IPost | null | undefined): IPost[] {
  if (!post) return posts;
  if (posts.some((item) => item._id === post._id)) return posts;

  const index = posts.findIndex((item) => compareCreatorPosts(post, item) < 0);
  if (index === -1) return [...posts, post];
  return [...posts.slice(0, index), post, ...posts.slice(index)];
}

/**
 * Merge a freshly fetched page into the list, keeping one entry per post and the
 * list in creator order.
 *
 * De-duplication is by `_id` and prefers the **incoming** copy: a page fetched
 * now carries fresher counters than a copy that has been sitting in state.
 */
export function mergeCreatorPosts(existing: IPost[], incoming: IPost[]): IPost[] {
  const merged = new Map(existing.map((post) => [post._id, post]));
  for (const post of incoming) merged.set(post._id, post);
  return Array.from(merged.values()).sort(compareCreatorPosts);
}
