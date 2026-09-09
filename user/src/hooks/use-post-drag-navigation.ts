'use client';

import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from 'react';

import { PostNavigationDirection } from './use-post-navigation-wheel';

/**
 * Fraction of one slide the finger must travel before the release commits.
 *
 * Douyin commits at roughly a sixth of the stage. Below this the slide springs
 * back, which is what makes an accidental brush during a tap harmless.
 */
export const DRAG_COMMIT_RATIO = 0.16;

/** Floor for the commit distance, so a short viewport is not hair-triggered. */
export const DRAG_COMMIT_MIN_PX = 48;

/**
 * How long the slide takes to finish travelling after the finger lifts.
 *
 * Inside the 200-300ms band: long enough to read as one continuous movement
 * rather than a cut, short enough that the next post is playing before the
 * viewer wonders whether the gesture registered.
 */
export const DRAG_COMMIT_MS = 240;

/** Springing back is a correction, so it is quicker than a commit. */
export const DRAG_ROLLBACK_MS = 200;

/** How far past the end of the sequence the stage may be pulled, as a fraction. */
const OVERSCROLL_DAMPING = 0.28;

/** Below this the gesture has no direction yet; beyond it, it is locked to one. */
const DIRECTION_LOCK_PX = 8;

/**
 * Anything a gesture may legitimately start on that is *not* a request to
 * change post: every control, and the reading panel beside the media.
 */
const INTERACTIVE = 'button, a, input, textarea, select, [role="slider"], [role="button"], [contenteditable="true"], aside';

/**
 * Full-bleed tap layers that must not block the gesture.
 *
 * The video's centre play affordance is `absolute inset-0`, so *every* touch on
 * the media lands on a `<button>`. Treating that as "a control was pressed"
 * disables the gesture over the entire stage.
 */
const PASSTHROUGH = '[data-swipe-passthrough]';

export type PostDragPhase = 'idle' | 'dragging' | 'committing' | 'rolling-back';

interface UsePostDragNavigationOptions {
  canPrevious: boolean;
  canNext: boolean;
  onNavigate: (direction: PostNavigationDirection) => void;
  /**
   * Height of one slide in CSS pixels — the unit every transform is expressed
   * in. `0` (before the stage has been measured) disables the gesture rather
   * than committing against a meaningless distance.
   */
  itemHeight: number;
  /** False whenever the navigation context is `disabled`. */
  enabled?: boolean;
}

export interface PostDragNavigationState {
  /**
   * How far the finger has moved, in CSS pixels, signed the same way as the
   * gesture: negative while dragging up towards the next post.
   *
   * The stage applies this directly:
   *   current  -> translate3d(0, dragDeltaY, 0)
   *   next     -> translate3d(0, itemHeight + dragDeltaY, 0)
   *   previous -> translate3d(0, -itemHeight + dragDeltaY, 0)
   */
  dragDeltaY: number;
  phase: PostDragPhase;
  /** `0` while the finger is down, so the slide tracks it exactly. */
  transitionMs: number;
  /**
   * Which neighbour is currently in view, and therefore the only one worth
   * mounting. Null while idle: an untouched stage renders one post.
   */
  previewDirection: PostNavigationDirection | null;
  /** True while a gesture owns the pointer. */
  dragging: boolean;
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void;
  };
}

/** The distance a release must have covered to commit, for a given stage height. */
export function dragCommitThreshold(itemHeight: number): number {
  return Math.max(DRAG_COMMIT_MIN_PX, Math.round(itemHeight * DRAG_COMMIT_RATIO));
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Drag-to-navigate for the vertical post feeds: the stage follows the finger,
 * and the neighbour it is uncovering is visible the whole way.
 *
 * ## Why this replaced the fire-at-threshold swipe
 *
 * The previous handler navigated the moment the finger passed 48px and drew
 * nothing in between, so a swipe was a cut: no feedback while the gesture was
 * in progress, no sight of what was coming, and no way to change your mind.
 * Following the finger is what makes the feed feel like a stack of cards rather
 * than a slideshow -- and the rollback below the threshold is what makes an
 * accidental drag recoverable.
 *
 * ## Reduced motion
 *
 * Following the finger is direct manipulation, not animation, so it stays: the
 * slide is exactly where the finger put it. What `prefers-reduced-motion`
 * removes is the *unattended* part -- the 240ms glide after release, and the
 * spring-back -- which become instant.
 */
export function usePostDragNavigation({
  canPrevious,
  canNext,
  onNavigate,
  itemHeight,
  enabled = true
}: UsePostDragNavigationOptions): PostDragNavigationState {
  const [dragDeltaY, setDragDeltaY] = useState(0);
  const [phase, setPhase] = useState<PostDragPhase>('idle');
  // Read inside `onPointerDown`, which must see the phase as it is *now* rather
  // than as it was when the callback was last built.
  const phaseRef = useRef<PostDragPhase>('idle');
  phaseRef.current = phase;

  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const lockedRef = useRef<'vertical' | 'horizontal' | null>(null);
  const settleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deltaRef = useRef(0);
  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;

  const setDelta = useCallback((value: number) => {
    deltaRef.current = value;
    setDragDeltaY(value);
  }, []);

  const clearSettle = useCallback(() => {
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = null;
  }, []);

  useEffect(() => () => {
    if (settleRef.current) clearTimeout(settleRef.current);
  }, []);

  // A context change mid-gesture (the panel opening, Messages appearing) must
  // not leave the stage parked off-centre.
  useEffect(() => {
    if (enabled) return;
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = null;
    startRef.current = null;
    lockedRef.current = null;
    deltaRef.current = 0;
    setDragDeltaY(0);
    setPhase('idle');
  }, [enabled]);

  const settleTo = useCallback((target: number, ms: number, after?: () => void) => {
    clearSettle();
    if (ms <= 0) {
      setDelta(0);
      setPhase('idle');
      after?.();
      return;
    }
    setDelta(target);
    setPhase(target === 0 ? 'rolling-back' : 'committing');
    settleRef.current = setTimeout(() => {
      settleRef.current = null;
      /*
       * Reset and navigate in the same commit: the stage under it becomes the
       * post that just slid into place, at offset 0, with the transition
       * already switched off by `phase === 'idle'`. Two separate commits show
       * one frame of the new post at the old offset.
       */
      deltaRef.current = 0;
      setDragDeltaY(0);
      setPhase('idle');
      after?.();
    }, ms);
  }, [clearSettle, setDelta]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (!enabled || itemHeight <= 0) return;
    if (!canPrevious && !canNext) return;
    /*
     * A slide that is still travelling is not accepting a new gesture.
     *
     * Without this a second flick during the 240ms commit starts over from the
     * settled target, so one continuous hand movement could step two posts and
     * the second one would land while the first was still animating. "One
     * gesture navigates exactly one post" has to hold across the settle, not
     * only within a single pointer stream.
     */
    if (phaseRef.current === 'committing' || phaseRef.current === 'rolling-back') return;
    // A mouse press is a click or a drag on a control, never a feed gesture;
    // the wheel already serves the pointer device.
    if (event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement | null;
    const control = target?.closest(INTERACTIVE);
    if (control && !control.closest(PASSTHROUGH) && !control.matches(PASSTHROUGH)) return;

    clearSettle();
    startRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    lockedRef.current = null;
  }, [canNext, canPrevious, clearSettle, enabled, itemHeight]);

  /*
   * A resize changes the unit every offset is expressed in, so a delta measured
   * against the old height is meaningless against the new one. Recentre rather
   * than leave the stage parked at a fraction of a size that no longer exists.
   */
  useEffect(() => {
    if (settleRef.current) clearTimeout(settleRef.current);
    settleRef.current = null;
    startRef.current = null;
    lockedRef.current = null;
    deltaRef.current = 0;
    setDragDeltaY(0);
    setPhase('idle');
  }, [itemHeight]);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const start = startRef.current;
    if (!start || start.id !== event.pointerId) return;

    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;

    if (!lockedRef.current) {
      if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return;
      // A mostly-horizontal drag belongs to whatever is underneath -- a photo
      // carousel, a text selection -- not to the feed.
      lockedRef.current = Math.abs(dy) > Math.abs(dx) ? 'vertical' : 'horizontal';
    }
    if (lockedRef.current === 'horizontal') return;

    /*
     * Past the end of the sequence the stage still moves, but heavily damped and
     * never far enough to commit -- the resistance *is* the message that there
     * is nothing beyond.
     */
    const wantsNext = dy < 0;
    const blocked = (wantsNext && !canNext) || (!wantsNext && !canPrevious);
    setDelta(blocked ? dy * OVERSCROLL_DAMPING : dy);
    setPhase('dragging');
  }, [canNext, canPrevious, setDelta]);

  const endGesture = useCallback(() => {
    const start = startRef.current;
    startRef.current = null;
    const wasVertical = lockedRef.current === 'vertical';
    lockedRef.current = null;
    if (!start || !wasVertical) return;

    const delta = deltaRef.current;
    const reduced = prefersReducedMotion();
    const threshold = dragCommitThreshold(itemHeight);
    const direction: PostNavigationDirection = delta < 0 ? 'next' : 'previous';
    const allowed = direction === 'next' ? canNext : canPrevious;

    if (Math.abs(delta) >= threshold && allowed) {
      // Finish the journey the finger started: the current slide travels the
      // rest of the way off, which puts the neighbour exactly at 0.
      settleTo(direction === 'next' ? -itemHeight : itemHeight, reduced ? 0 : DRAG_COMMIT_MS, () => {
        onNavigateRef.current(direction);
      });
      return;
    }
    settleTo(0, reduced ? 0 : DRAG_ROLLBACK_MS);
  }, [canNext, canPrevious, itemHeight, settleTo]);

  const previewDirection: PostNavigationDirection | null = dragDeltaY === 0
    ? null
    : dragDeltaY < 0 ? 'next' : 'previous';

  return {
    dragDeltaY,
    phase,
    // No transition while the finger is down: any easing there would put the
    // slide somewhere other than where the finger is.
    transitionMs: phase === 'committing'
      ? DRAG_COMMIT_MS
      : phase === 'rolling-back' ? DRAG_ROLLBACK_MS : 0,
    previewDirection,
    dragging: phase === 'dragging',
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endGesture,
      onPointerCancel: endGesture
    }
  };
}
