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
    event.preventDefault();
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
