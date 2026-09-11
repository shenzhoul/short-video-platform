/**
 * Turn an instant reflow into a glide (the FLIP technique).
 *
 * Call `captureTops` right before a state change that reflows a list, then
 * `glideFromTops` after React has committed it (in `useLayoutEffect`). Every
 * element that moved is played from where it was to where it now is, using the
 * Web Animations API — nothing is scheduled with timers, and a glide that is
 * still running when the next change arrives is continued from its current
 * on-screen position rather than snapping.
 *
 * Why it exists: the account menu mounts a 152px preview under one row and
 * removes the other. Without this, every row in between jumps the full 152px in
 * a single frame, which swamps any animation on the preview itself — measured on
 * the production build, the preview's own 10px entrance was invisible next to it.
 */

export const LAYOUT_GLIDE_ANIMATION_ID = 'layout-glide';

export function captureTops(elements: Iterable<HTMLElement>): Map<HTMLElement, number> {
  const tops = new Map<HTMLElement, number>();
  for (const element of elements) {
    // Bounding rects include transforms, so a glide in progress is measured
    // where it is drawn, which is where the next glide must start from.
    tops.set(element, element.getBoundingClientRect().top);
  }
  return tops;
}

interface GlideOptions {
  duration: number;
  easing: string;
}

export function glideFromTops(
  previousTops: Map<HTMLElement, number>,
  elements: Iterable<HTMLElement>,
  { duration, easing }: GlideOptions
): Animation[] {
  const started: Animation[] = [];
  for (const element of elements) {
    const before = previousTops.get(element);
    if (before === undefined || typeof element.animate !== 'function') continue;

    // Remove a running glide first so the resting position is measured without it.
    if (typeof element.getAnimations === 'function') {
      element.getAnimations()
        .filter((animation) => animation.id === LAYOUT_GLIDE_ANIMATION_ID)
        .forEach((animation) => animation.cancel());
    }

    const delta = before - element.getBoundingClientRect().top;
    if (Math.abs(delta) < 0.5) continue;

    const animation = element.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }],
      { duration, easing }
    );
    animation.id = LAYOUT_GLIDE_ANIMATION_ID;
    started.push(animation);
  }
  return started;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
