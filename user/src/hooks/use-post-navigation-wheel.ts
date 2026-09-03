import { useCallback, useEffect, useRef, WheelEventHandler } from 'react';

export type PostNavigationDirection = 'previous' | 'next';

interface UsePostNavigationWheelOptions {
  canPrevious: boolean;
  canNext: boolean;
  onNavigate: (direction: PostNavigationDirection) => void;
}

export function usePostNavigationWheel({
  canPrevious,
  canNext,
  onNavigate
}: UsePostNavigationWheelOptions): WheelEventHandler<HTMLDivElement> {
  const wheelDeltaRef = useRef(0);
  const wheelLockRef = useRef(false);
  const wheelResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wheelUnlockRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (wheelResetRef.current) clearTimeout(wheelResetRef.current);
    if (wheelUnlockRef.current) clearTimeout(wheelUnlockRef.current);
  }, []);

  return useCallback(event => {
    /*
     * Only claim the wheel when it is actually going to move a post.
     *
     * With neither direction available — a reading panel is open, or the
     * sequence is at its end — this handler has nothing to do, and the scroll
     * belongs to whatever is under the pointer. Calling `preventDefault`
     * anyway is worse than useless: React attaches `wheel` passively, so the
     * call cannot suppress anything and instead logs "Unable to preventDefault
     * inside passive event listener invocation" on *every* wheel tick. Six
     * wheel gestures over an open Details panel produced a console full of it.
     */
    if (!canPrevious && !canNext) return;
    if (event.cancelable) event.preventDefault();
    if (wheelLockRef.current) return;

    wheelDeltaRef.current += event.deltaY;
    if (wheelResetRef.current) clearTimeout(wheelResetRef.current);
    wheelResetRef.current = setTimeout(() => {
      wheelDeltaRef.current = 0;
    }, 160);
    if (Math.abs(wheelDeltaRef.current) < 48) return;

    const direction = wheelDeltaRef.current > 0 ? 'next' : 'previous';
    wheelDeltaRef.current = 0;
    if ((direction === 'next' && !canNext) || (direction === 'previous' && !canPrevious)) return;

    wheelLockRef.current = true;
    onNavigate(direction);
    wheelUnlockRef.current = setTimeout(() => {
      wheelLockRef.current = false;
    }, 520);
  }, [canNext, canPrevious, onNavigate]);
}
