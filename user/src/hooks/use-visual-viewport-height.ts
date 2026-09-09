'use client';

import { useEffect } from 'react';

/**
 * Keeps `--app-viewport-height` equal to what the viewer can actually see.
 *
 * ## Why `100dvh` is not enough on its own
 *
 * `dvh` is defined as the viewport with any *dynamic* browser UI accounted
 * for, and on most browsers it is exactly right. It is not universally
 * honoured: several report the large viewport while a bottom toolbar is still
 * drawn, which leaves the shell taller than the window. Every surface here
 * sizes a full-height stage from this token and pins its transport bar to the
 * bottom of it, so the overshoot lands on precisely one row — the video
 * controls end up under the toolbar, and the post has to be dragged upward to
 * reach them.
 *
 * `visualViewport.height` is the measured visible area, so it cannot disagree
 * with what is on screen. It is applied only when it differs from what the
 * shell already resolved, so a browser where `dvh` is correct keeps the pure
 * CSS value and never re-layouts.
 *
 * ## Why this is not "shrinking every stage"
 *
 * It changes one token that already meant "the visible height", to a value
 * that is more often true. Surfaces with a different available height (the
 * popup, which covers the header) keep computing from their own boxes, and the
 * drag transform keeps measuring its slide distance from the stage element
 * rather than from this token.
 */
export function useVisualViewportHeight(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    const apply = () => {
      /*
       * Compare against what the shell currently resolves rather than against
       * `innerHeight`: the question is whether the *token* is wrong, and a
       * pinch-zoom shrinks `visualViewport` without the layout being wrong at
       * all. `scale > 1` is exactly that case and is left alone.
       */
      if (viewport.scale > 1.01) return;
      const measured = Math.round(viewport.height);
      const resolved = Math.round(root.getBoundingClientRect().height);
      if (!measured) return;
      if (Math.abs(measured - resolved) <= 1) {
        // The CSS value already agrees; do not pin a px value that would then
        // stop responding to a rotation before the next resize event.
        root.style.removeProperty('--app-viewport-height');
        return;
      }
      root.style.setProperty('--app-viewport-height', `${measured}px`);
    };

    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    window.addEventListener('orientationchange', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      window.removeEventListener('orientationchange', apply);
      document.documentElement.style.removeProperty('--app-viewport-height');
    };
  }, []);
}
