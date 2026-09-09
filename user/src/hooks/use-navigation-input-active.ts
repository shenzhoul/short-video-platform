'use client';

import { useEffect, useState } from 'react';

/**
 * Elements that own the keyboard while focused. Arrow keys move a caret, a
 * selection or a slider thumb inside them — never the feed.
 */
const TEXT_ENTRY = 'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], [role="slider"]';

/**
 * Controls a pointer can be *held* on: the seek bar, and anything a surface has
 * explicitly marked as holding navigation while dragged.
 *
 * Scrubbing is a vertical-ish drag directly on top of the media, so without
 * this a scrub past the swipe threshold changes post and loses the position the
 * viewer was looking for.
 */
const HOLD = '[role="slider"], [data-navigation-hold]';

/** Whether an element scrolls its own content, and so owns a wheel or a drag. */
function isOwnScroller(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.scrollHeight <= element.clientHeight + 1) return false;
  const overflowY = getComputedStyle(element).overflowY;
  return overflowY === 'auto' || overflowY === 'scroll';
}

function hasScrollingAncestor(target: Element | null, root: Element | null): boolean {
  let node: Element | null = target;
  while (node && node !== root) {
    if (isOwnScroller(node)) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Whether something other than the feed currently owns pointer and keyboard
 * input.
 *
 * This is the `inputActive` term of `resolveNavigationContext` — the one rule
 * that outranks every other, including creator mode. It is computed here rather
 * than guessed at each call site so the comment box, the seek bar and a
 * scrolling panel all disable navigation by the same definition.
 *
 * Listeners are attached in the capture phase on `document`, because the
 * elements involved (a portal'd comment box, a slider inside the player)
 * are not all descendants of the surface that navigates.
 */
export function useNavigationInputActive(rootRef?: { current: HTMLElement | null }): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const syncFocus = () => {
      const focused = document.activeElement;
      setActive(Boolean(focused && focused !== document.body && focused.matches?.(TEXT_ENTRY)));
    };

    const onPointerDown = (event: Event) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest?.(HOLD) || hasScrollingAncestor(target, rootRef?.current ?? null)) {
        setActive(true);
      }
    };
    // A release re-reads focus rather than clearing outright: releasing inside a
    // comment box must leave navigation disabled, not re-enable it.
    const onPointerRelease = () => syncFocus();

    document.addEventListener('focusin', syncFocus);
    document.addEventListener('focusout', syncFocus);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerRelease, true);
    document.addEventListener('pointercancel', onPointerRelease, true);
    syncFocus();

    return () => {
      document.removeEventListener('focusin', syncFocus);
      document.removeEventListener('focusout', syncFocus);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointerup', onPointerRelease, true);
      document.removeEventListener('pointercancel', onPointerRelease, true);
    };
  }, [rootRef]);

  return active;
}
