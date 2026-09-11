'use client';

import type { ReactNode } from 'react';
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState
} from 'react';

interface HoverRevealPanelProps {
  children: ReactNode;
  panel: ReactNode;
  className?: string;
  panelClassName?: string;
  panelPositionClassName?: string;
  disabled?: boolean;
  revealOnFocus?: boolean;
  /**
   * Keep the panel inside the nearest ancestor that clips horizontally (the
   * page's scroll container) and inside the viewport, moving it only as far as
   * it would otherwise cross an edge.
   *
   * A closed panel here is `invisible`, not `display: none`, so it is still laid
   * out — and a laid-out box past a scroll container's edge is sideways scroll
   * even while nobody can see it. On the creator profile at 1440px the "More"
   * panel (anchored 10px past a trigger that is flush with the viewport) made the
   * profile scroll 10px, and the Save login help (anchored 180px past its icon)
   * 52px; opened, the same panels were cut off by that edge.
   */
  fitWithinScrollport?: boolean;
}

/** The closest ancestor whose `overflow-x` clips, which is what the panel must stay inside. */
function findHorizontalClip(node: HTMLElement): HTMLElement | null {
  let current = node.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    if (getComputedStyle(current).overflowX !== 'visible') return current;
    current = current.parentElement;
  }
  return null;
}

export default function HoverRevealPanel({
  children,
  panel,
  className = '',
  panelClassName = '',
  panelPositionClassName = 'left-0 top-full mt-2',
  disabled = false,
  revealOnFocus = false,
  fitWithinScrollport = false
}: HoverRevealPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  /*
   * A fitted panel is rendered only once the page is interactive. Server HTML
   * cannot know where the edge is, so rendering it there would reintroduce the
   * overflow until hydration; the panel is a hover affordance with nothing to
   * index, and the first client render still matches the server's.
   */
  const [mounted, setMounted] = useState(!fitWithinScrollport);

  useEffect(() => {
    if (fitWithinScrollport) setMounted(true);
  }, [fitWithinScrollport]);

  const place = useCallback(() => {
    const root = rootRef.current;
    const panelElement = panelRef.current;
    if (!root || !panelElement) return;

    const clip = findHorizontalClip(root);
    let left = 0;
    let right = document.documentElement.clientWidth || window.innerWidth;
    if (clip) {
      const clipRect = clip.getBoundingClientRect();
      const clipLeft = clipRect.left + clip.clientLeft;
      left = Math.max(left, clipLeft);
      right = Math.min(right, clipLeft + clip.clientWidth);
    }

    // The correction already applied lives on the element itself, so a remounted
    // panel (one that starts with no margins) can never inherit a stale value.
    const applied = parseFloat(panelElement.style.marginLeft) || 0;
    const rect = panelElement.getBoundingClientRect();
    const naturalLeft = rect.left - applied;
    const naturalRight = rect.right - applied;
    let offset = 0;
    if (naturalRight > right) offset = right - naturalRight;
    // A panel wider than the room it has keeps its start edge visible.
    if (naturalLeft + offset < left) offset = left - naturalLeft;
    if (Math.abs(offset - applied) < 0.5) return;

    /*
     * Equal and opposite margins move the box whichever edge it is anchored by
     * (`right-*` moves with margin-right, `left-*` with margin-left) and leave
     * its shrink-to-fit width unchanged, because the two cancel out of the
     * available width. Not `translate`: the panel's `transition` animates it,
     * so a correction would slide into place and read wrong mid-flight.
     */
    if (offset) {
      panelElement.style.setProperty('margin-left', `${offset}px`);
      panelElement.style.setProperty('margin-right', `${-offset}px`);
    } else {
      panelElement.style.removeProperty('margin-left');
      panelElement.style.removeProperty('margin-right');
    }
  }, []);

  useLayoutEffect(() => {
    if (!fitWithinScrollport || disabled || !mounted) return undefined;
    const root = rootRef.current;
    const panelElement = panelRef.current;
    if (!root || !panelElement) return undefined;

    place();
    const clip = findHorizontalClip(root);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(root);
    observer?.observe(panelElement);
    if (clip) observer?.observe(clip);
    window.addEventListener('resize', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
    };
  }, [disabled, fitWithinScrollport, mounted, place]);

  const focusRevealClassName = revealOnFocus
    ? 'group-focus-within/hover-reveal:pointer-events-auto group-focus-within/hover-reveal:visible group-focus-within/hover-reveal:opacity-100'
    : '';

  return (
    <div
      ref={rootRef}
      className={`group/hover-reveal relative ${className}`}
      // Re-checked as the panel is about to show: its trigger can move without
      // anything resizing. Runs before the hover style paints.
      onPointerEnter={fitWithinScrollport ? place : undefined}
      onFocus={fitWithinScrollport ? place : undefined}
    >
      {children}
      {!disabled && mounted ? (
        <div
          ref={panelRef}
          data-hover-reveal-panel
          className={`pointer-events-none invisible absolute z-50 opacity-0 transition duration-150 group-hover/hover-reveal:pointer-events-auto group-hover/hover-reveal:visible group-hover/hover-reveal:opacity-100 ${focusRevealClassName} ${panelPositionClassName} ${panelClassName}`}
        >
          {panel}
        </div>
      ) : null}
    </div>
  );
}
