import { act, render, screen } from '@testing-library/react';

import {
  DRAG_COMMIT_MS,
  DRAG_ROLLBACK_MS,
  dragCommitThreshold,
  usePostDragNavigation
} from './use-post-drag-navigation';

/**
 * The Douyin-style drag transform, asserted as a state machine.
 *
 * What is being defended is the arithmetic the stage renders from — the signed
 * delta, the transition that must be off while the finger is down, which
 * neighbour is worth mounting, and the two ways a release can end. Rendering a
 * real feed would exercise the player, the PiP bridge and the recommendation
 * queue to answer questions about four numbers.
 */
const ITEM_HEIGHT = 956;
const THRESHOLD = dragCommitThreshold(ITEM_HEIGHT);

let navigated: string[] = [];
let reducedMotion = false;

interface HarnessProps {
  canPrevious?: boolean;
  canNext?: boolean;
  itemHeight?: number;
  enabled?: boolean;
}

function Harness({
  canPrevious = true,
  canNext = true,
  itemHeight = ITEM_HEIGHT,
  enabled = true
}: HarnessProps) {
  const drag = usePostDragNavigation({
    canPrevious,
    canNext,
    itemHeight,
    enabled,
    onNavigate: (direction) => navigated.push(direction)
  });

  return (
    <div data-testid="stage" {...drag.handlers}>
      <span data-testid="delta">{drag.dragDeltaY}</span>
      <span data-testid="phase">{drag.phase}</span>
      <span data-testid="transition">{drag.transitionMs}</span>
      <span data-testid="preview">{drag.previewDirection ?? 'none'}</span>
      {/* Exactly the expressions the stage renders. */}
      <span data-testid="current-transform">{`translate3d(0, ${drag.dragDeltaY}px, 0)`}</span>
      <span data-testid="next-transform">{`translate3d(0, ${itemHeight + drag.dragDeltaY}px, 0)`}</span>
      <span data-testid="previous-transform">{`translate3d(0, ${-itemHeight + drag.dragDeltaY}px, 0)`}</span>
    </div>
  );
}

/** jsdom has no PointerEvent constructor; the hook reads only these fields. */
function pointer(type: string, init: { clientX?: number; clientY?: number; pointerId?: number; pointerType?: string }) {
  const event: any = new Event(type, { bubbles: true });
  event.clientX = init.clientX ?? 0;
  event.clientY = init.clientY ?? 0;
  event.pointerId = init.pointerId ?? 1;
  event.pointerType = init.pointerType ?? 'touch';
  return event;
}

function dragBy(dy: number, options: { dx?: number; pointerType?: string; release?: boolean } = {}) {
  const stage = screen.getByTestId('stage');
  const dx = options.dx ?? 0;
  act(() => {
    stage.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 500, pointerType: options.pointerType }));
  });
  act(() => {
    stage.dispatchEvent(pointer('pointermove', { clientX: 100 + dx, clientY: 500 + dy, pointerType: options.pointerType }));
  });
  if (options.release !== false) {
    act(() => {
      stage.dispatchEvent(pointer('pointerup', { clientX: 100 + dx, clientY: 500 + dy, pointerType: options.pointerType }));
    });
  }
}

const delta = () => Number(screen.getByTestId('delta').textContent);
const phase = () => screen.getByTestId('phase').textContent;
const transition = () => Number(screen.getByTestId('transition').textContent);
const preview = () => screen.getByTestId('preview').textContent;

beforeEach(() => {
  navigated = [];
  reducedMotion = false;
  jest.useFakeTimers();
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: query.includes('prefers-reduced-motion') ? reducedMotion : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false
    })
  });
});

afterEach(() => {
  act(() => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('usePostDragNavigation', () => {
  it('1. the current slide tracks the finger exactly, one pixel per pixel', () => {
    render(<Harness />);
    dragBy(-137, { release: false });
    expect(delta()).toBe(-137);
    expect(screen.getByTestId('current-transform').textContent).toBe('translate3d(0, -137px, 0)');
  });

  it('2. the next slide sits one stage below and moves with it', () => {
    render(<Harness />);
    dragBy(-137, { release: false });
    expect(screen.getByTestId('next-transform').textContent)
      .toBe(`translate3d(0, ${ITEM_HEIGHT - 137}px, 0)`);
  });

  it('3. the previous slide sits one stage above and moves with it', () => {
    render(<Harness />);
    dragBy(137, { release: false });
    expect(screen.getByTestId('previous-transform').textContent)
      .toBe(`translate3d(0, ${-ITEM_HEIGHT + 137}px, 0)`);
  });

  it('4. at rest all three are exactly one stage apart with the current at zero', () => {
    render(<Harness />);
    expect(screen.getByTestId('current-transform').textContent).toBe('translate3d(0, 0px, 0)');
    expect(screen.getByTestId('next-transform').textContent).toBe(`translate3d(0, ${ITEM_HEIGHT}px, 0)`);
    expect(screen.getByTestId('previous-transform').textContent).toBe(`translate3d(0, ${-ITEM_HEIGHT}px, 0)`);
  });

  it('5. the transition is off while the finger is down', () => {
    render(<Harness />);
    dragBy(-137, { release: false });
    expect(phase()).toBe('dragging');
    expect(transition()).toBe(0);
  });

  it('6. only the neighbour being uncovered is worth mounting', () => {
    render(<Harness />);
    expect(preview()).toBe('none');
    dragBy(-137, { release: false });
    expect(preview()).toBe('next');
  });

  it('7. dragging down previews the previous post instead', () => {
    render(<Harness />);
    dragBy(137, { release: false });
    expect(preview()).toBe('previous');
  });

  it('8. a release past the threshold commits over 240ms, inside the 200-300ms band', () => {
    render(<Harness />);
    dragBy(-(THRESHOLD + 10));
    expect(phase()).toBe('committing');
    expect(transition()).toBe(DRAG_COMMIT_MS);
    expect(DRAG_COMMIT_MS).toBeGreaterThanOrEqual(200);
    expect(DRAG_COMMIT_MS).toBeLessThanOrEqual(300);
  });

  it('9. the commit finishes the journey: the current slide travels a full stage off', () => {
    render(<Harness />);
    dragBy(-(THRESHOLD + 10));
    expect(delta()).toBe(-ITEM_HEIGHT);
  });

  it('10. navigation fires only when the animation lands, and the delta resets with it', () => {
    render(<Harness />);
    dragBy(-(THRESHOLD + 10));
    expect(navigated).toEqual([]);
    act(() => {
      jest.advanceTimersByTime(DRAG_COMMIT_MS);
    });
    expect(navigated).toEqual(['next']);
    // Same commit: no frame of the new post at the old offset.
    expect(delta()).toBe(0);
    expect(phase()).toBe('idle');
    expect(transition()).toBe(0);
  });

  it('11. dragging down past the threshold navigates to the previous post', () => {
    render(<Harness />);
    dragBy(THRESHOLD + 10);
    act(() => {
      jest.advanceTimersByTime(DRAG_COMMIT_MS);
    });
    expect(navigated).toEqual(['previous']);
  });

  it('12. a release short of the threshold rolls back and navigates nothing', () => {
    render(<Harness />);
    dragBy(-(THRESHOLD - 10));
    expect(phase()).toBe('rolling-back');
    expect(transition()).toBe(DRAG_ROLLBACK_MS);
    expect(delta()).toBe(0);
    act(() => {
      jest.advanceTimersByTime(DRAG_ROLLBACK_MS);
    });
    expect(navigated).toEqual([]);
    expect(phase()).toBe('idle');
  });

  it('13. the end of the sequence resists instead of committing', () => {
    render(<Harness canNext={false} />);
    dragBy(-(THRESHOLD + 10), { release: false });
    // Damped: it moves, so the gesture is acknowledged, but not by the full
    // distance and never far enough to commit.
    expect(Math.abs(delta())).toBeLessThan(THRESHOLD + 10);
    expect(Math.abs(delta())).toBeGreaterThan(0);
    act(() => {
      screen.getByTestId('stage').dispatchEvent(pointer('pointerup', {}));
      jest.advanceTimersByTime(DRAG_COMMIT_MS);
    });
    expect(navigated).toEqual([]);
  });

  it('14. prefers-reduced-motion removes the unattended animation, not the gesture', () => {
    reducedMotion = true;
    render(<Harness />);
    dragBy(-(THRESHOLD + 10));
    // No committing phase to wait through, and no transition to animate.
    expect(phase()).toBe('idle');
    expect(transition()).toBe(0);
    expect(delta()).toBe(0);
    expect(navigated).toEqual(['next']);
  });

  it('15. a mostly-horizontal drag belongs to whatever is underneath', () => {
    render(<Harness />);
    dragBy(-40, { dx: 200, release: false });
    expect(delta()).toBe(0);
    expect(preview()).toBe('none');
  });

  it('16. a mouse press is a click, not a feed gesture — the wheel serves that device', () => {
    render(<Harness />);
    dragBy(-(THRESHOLD + 10), { pointerType: 'mouse' });
    expect(delta()).toBe(0);
    expect(navigated).toEqual([]);
  });

  it('17. an unmeasured stage refuses the gesture rather than committing against zero', () => {
    render(<Harness itemHeight={0} />);
    dragBy(-200);
    expect(delta()).toBe(0);
    expect(navigated).toEqual([]);
  });

  it('18. a disabled navigation context recentres the stage mid-gesture', () => {
    const { rerender } = render(<Harness />);
    dragBy(-137, { release: false });
    expect(delta()).toBe(-137);
    rerender(<Harness enabled={false} />);
    expect(delta()).toBe(0);
    expect(phase()).toBe('idle');
  });
});
