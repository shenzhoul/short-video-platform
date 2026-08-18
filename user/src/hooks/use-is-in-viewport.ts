import { useEffect, useMemo, useState } from 'react';

export function useIsInViewport(ref: React.RefObject<Element>, threshold = 0.1) {
  const [isIntersecting, setIsIntersecting] = useState(false);

  const observer = useMemo(() => {
    if (typeof window === 'undefined' || !window.IntersectionObserver) return null;

    return new IntersectionObserver(
      ([entry]) => setIsIntersecting(entry.isIntersecting),
      { threshold }
    );
  }, [threshold]);

  useEffect(() => {
    const element = ref.current;

    if (!observer || !element) {
      return;
    }

    try {
      observer.observe(element);
    } catch {
      // Ignore errors if element is not valid for observation
    }

    return () => {
      if (observer && element) {
        try {
          observer.unobserve(element);
        } catch {
          // Ignore errors if element was not being observed
        }
      }
    };
  }, [observer, ref]);

  // Cleanup observer when component unmounts
  useEffect(() => {
    return () => {
      if (observer) {
        observer.disconnect();
      }
    };
  }, [observer]);

  return isIntersecting;
}
