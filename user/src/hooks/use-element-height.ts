'use client';

import { RefObject, useEffect, useRef, useState } from 'react';

/**
 * The live height of an element, in CSS pixels.
 *
 * The drag transform is expressed in whole stage heights, so this is the unit
 * the whole gesture is measured in. It starts at `0`, which the drag hook reads
 * as "not measured yet" and refuses to commit against — a threshold computed
 * from a height of zero would fire on the first pixel.
 *
 * ## Why it re-attaches instead of observing once
 *
 * A ref object is stable for the life of the component, so an effect keyed on
 * `[ref]` runs exactly once — but the *element* behind it does not last that
 * long. `PostVideoStage` is mounted with `key={post._id}`, so every navigation
 * unmounts one stage and mounts another. The observer stayed bound to the
 * detached node, which reports a height of `0`, and `itemHeight: 0` is exactly
 * the value the drag hook treats as "unmeasured" and refuses to start on.
 *
 * Measured, alternating the popup's Next button with a swipe: the button moved
 * every time and the swipe after it was ignored on 2 of 4 cycles — the two
 * where the incoming post was a video, and therefore where the keyed stage
 * remounted. Photo posts survived because their layout's measured element is
 * the un-keyed `<main>`.
 *
 * So the element is re-checked after every render, and a detached node can
 * never write a zero over a good measurement.
 */
export function useElementHeight(ref: RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(0);
  const observedRef = useRef<HTMLElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  // No dependency array: the ref's *contents* change without anything in a
  // dependency list changing, and that swap is the case this exists for.
  useEffect(() => {
    const element = ref.current;
    if (element === observedRef.current) return;

    observerRef.current?.disconnect();
    observedRef.current = element;
    if (!element) return;

    const read = () => {
      const measured = element.getBoundingClientRect().height;
      // A detached or collapsed node measures 0. Keeping the last good value is
      // right either way: the stage that replaces it is the same size, and a 0
      // would disable the gesture until something else happened to resize.
      if (measured > 0) setHeight(measured);
    };
    read();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(read);
    observer.observe(element);
    observerRef.current = observer;
  });

  useEffect(() => () => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    observedRef.current = null;
  }, []);

  return height;
}
