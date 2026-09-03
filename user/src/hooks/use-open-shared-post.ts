'use client';

import { MESSAGES_ROUTE } from '@providers/message-workspace.provider';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback } from 'react';

/** `modal_src` value marking an open that came from a shared-post message. */
export const SHARED_POST_MODAL_SOURCE = 'message';

/** Routes that already render the post detail modal from `modal_id`. */
const MODAL_HOST_ROUTES = ['/', '/for-you', '/following', '/search'];

/**
 * Does this route render the post detail modal itself?
 *
 * A single-segment path is a creator profile, which hosts its own modal — that
 * is checked by shape rather than by listing usernames, since they are user
 * data and cannot be enumerated.
 */
function hostsPostDetail(pathname: string): boolean {
  if (MODAL_HOST_ROUTES.includes(pathname)) return true;
  if (pathname === MESSAGES_ROUTE || pathname.startsWith(`${MESSAGES_ROUTE}/`)) return false;

  const segments = pathname.split('/').filter(Boolean);
  return segments.length === 1;
}

/**
 * Opens a post in the application's own post detail modal.
 *
 * Deliberately the same `modal_id` search param every other surface uses —
 * notifications, the feed, a copied share link — rather than a post viewer built
 * inside Messages. One modal means one set of playback rules, one deep link, and
 * one back button.
 *
 * When the current page already hosts that modal, the param is added to the URL
 * in place. Nothing unmounts: the message workspace lives in the shell around
 * the page, so the conversation stays open behind the modal with its scroll
 * position intact, and closing the modal drops the param and reveals it again.
 *
 * From the dedicated `/messages` page there is no modal to open — that route
 * does not render one — so this falls back to home, which does.
 */
export function useOpenSharedPost() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return useCallback((postId: string) => {
    if (!postId) return;

    if (!hostsPostDetail(pathname)) {
      router.push(`/?modal_id=${encodeURIComponent(postId)}&modal_src=${SHARED_POST_MODAL_SOURCE}`);
      return;
    }

    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('modal_id', postId);
    // Names where this open came from, so the detail modal can report it as a
    // genuine message context (`PostDetailSource` `'message-shared-post'`)
    // rather than the generic `'direct-link'` every other `modal_id` arrival
    // gets. Only affects attribution: a shared-post open is feed-scoped and
    // uses the same anchor-based recommendation detail session either way
    // (rules/instructions §3).
    params.set('modal_src', SHARED_POST_MODAL_SOURCE);
    // `push`, not `replace`: opening a post is a step the back button should
    // undo, which is also how the feed and notifications behave.
    router.push(`${pathname}?${params.toString()}`);
  }, [pathname, router, searchParams]);
}
