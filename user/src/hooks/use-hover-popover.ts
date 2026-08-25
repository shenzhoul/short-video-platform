'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/** How long the pointer must rest on the trigger before the panel opens. */
const OPEN_DELAY_MS = 120;

/**
 * How long the panel survives after the pointer leaves.
 *
 * This is the gap-crossing budget: the panel is anchored beside the trigger with
 * a few pixels between them, and for that moment the pointer is over neither.
 * Closing immediately makes the panel impossible to reach.
 */
const CLOSE_DELAY_MS = 220;

interface HoverPopoverOptions {
  /** Called when the panel opens, for lazily loading its contents. */
  onOpen?: () => void;
}

/**
 * Hover-with-intent popover state, with the keyboard and touch paths that a
 * CSS-only `group-hover` cannot express.
 *
 * Three things a pure CSS panel gets wrong here:
 *
 *  - it renders its contents whether or not anyone opened it, so a feed of
 *    twenty share buttons would mount twenty recipient lists and fetch twenty
 *    times;
 *  - it cannot be dismissed with Escape or by clicking elsewhere;
 *  - it has no notion of a pointer travelling *towards* it, so the gap between
 *    the button and the panel closes it mid-journey.
 *
 * Pointer type is read from the event rather than from a media query: a laptop
 * with a touchscreen is both, and what matters is how this particular
 * interaction arrived.
 */
export function useHoverPopover({ onOpen }: HoverPopoverOptions = {}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openedRef = useRef(false);

  const clearTimers = useCallback(() => {
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    openTimerRef.current = null;
    closeTimerRef.current = null;
  }, []);

  const show = useCallback(() => {
    clearTimers();
    setOpen(true);
    // Fired once per opening rather than on every render, so re-opening a panel
    // that is already loaded does not refetch it.
    if (!openedRef.current) {
      openedRef.current = true;
      onOpen?.();
    }
  }, [clearTimers, onOpen]);

  const hide = useCallback(() => {
    clearTimers();
    setOpen(false);
  }, [clearTimers]);

  const handlePointerEnter = useCallback((event: React.PointerEvent) => {
    // Touch has no hover: opening on the pointer entering would fire on the tap
    // that is also about to toggle it, and the panel would flicker.
    if (event.pointerType === 'touch') return;
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    openTimerRef.current = setTimeout(show, OPEN_DELAY_MS);
  }, [show]);

  const handlePointerLeave = useCallback((event: React.PointerEvent) => {
    if (event.pointerType === 'touch') return;
    if (openTimerRef.current) clearTimeout(openTimerRef.current);
    closeTimerRef.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }, []);

  /** Click toggles. On touch this is the only way in; with a mouse it pins the panel open. */
  const handleTriggerClick = useCallback(() => {
    if (open) hide();
    else show();
  }, [hide, open, show]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Escape closes the topmost layer and nothing else. This listener is on
      // `document`, which bubbles before `window`, so stopping here prevents the
      // surface underneath — the post detail modal listens on `window` — from
      // also closing. Without it, dismissing the share panel dismissed the post.
      event.stopPropagation();
      hide();
    };
    const onPointerDown = (event: PointerEvent) => {
      const container = containerRef.current;
      if (container && !container.contains(event.target as Node)) hide();
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [hide, open]);

  useEffect(() => clearTimers, [clearTimers]);

  return {
    open,
    show,
    hide,
    containerRef,
    /**
     * Spread onto the element wrapping *both* trigger and panel. Keeping them
     * in one hover region is what lets the pointer travel between them.
     */
    hoverProps: {
      onPointerEnter: handlePointerEnter,
      onPointerLeave: handlePointerLeave
    },
    triggerProps: {
      onClick: handleTriggerClick,
      'aria-expanded': open
    }
  };
}
