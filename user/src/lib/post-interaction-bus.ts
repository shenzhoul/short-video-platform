'use client';

import { PostInteractionPatch } from '@interfaces/post';

/**
 * One place a post's interaction state changes, for every copy of that post on
 * screen.
 *
 * ## Why this exists
 *
 * The app keeps **many independent copies of the same post**. Twelve hooks own
 * an `IPost[]` of their own (Home, For You, Following, search, liked posts,
 * creator grid, creator videos, the detail sequence, …) and
 * `usePostInteractionState` keeps a thirteenth for whichever post is open.
 * There is one `IPost` shape and one `PostDto` behind it, so the copies are
 * compatible — what was missing was any way to update more than one of them.
 *
 * An update travelled exactly one edge: `usePostInteractionState` called the
 * `onInteractionChange` prop it had been handed, which patched the single list
 * that supplied it. Measured in production: liking a post from the detail
 * modal's action rail updated the modal and left the *same post's* card in the
 * creator "Videos" tab showing the old total, side by side on screen.
 *
 * So changes are published here and every mounted list applies them by post id.
 * This is a fan-out, not a store: no post lives in this module, nothing is
 * cached, and each list keeps owning its own array.
 *
 * ## Why re-applying is safe
 *
 * Every field of `PostInteractionPatch` is **absolute** — `totalLike: 42`, never
 * `+1`. A subscriber that receives its own publish, or the same patch twice
 * from two paths, assigns the same value and `applyPostInteractionPatchToPosts`
 * returns the original array unchanged. That is also what stops an optimistic
 * like and the websocket snapshot that follows it from counting twice.
 */
type PostInteractionListener = (postId: string, patch: PostInteractionPatch) => void;

const listeners = new Set<PostInteractionListener>();

/**
 * Announce a change to every mounted copy of a post.
 *
 * Publish absolute values only. A delta here would double-count the moment two
 * sources describe the same change.
 */
export function publishPostInteraction(postId: string, patch: PostInteractionPatch): void {
  if (!postId) return;
  // Iterated over a copy: a listener that unsubscribes while being notified
  // (an unmount inside a state update) must not corrupt the walk.
  [...listeners].forEach((listener) => listener(postId, patch));
}

/** Subscribe a list (or a single post's state) to changes made anywhere else. */
export function subscribePostInteraction(listener: PostInteractionListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Test seam — a page load is the real reset. */
export function __clearPostInteractionListenersForTest(): void {
  listeners.clear();
}
