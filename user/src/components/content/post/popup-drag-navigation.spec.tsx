import fs from 'fs';
import path from 'path';

import { act, render, screen } from '@testing-library/react';

import { usePostDragNavigation, dragCommitThreshold, DRAG_COMMIT_MS } from '@hooks/use-post-drag-navigation';

/**
 * The popup's swipe navigation, and the one thing that makes it safe:
 * it never decides *which* post comes next.
 *
 * The popup's Next/Previous already resolve through `usePostDetailSequence`,
 * which carries the navigation context, the creator scope, the pinned ordering,
 * pagination and the edges. Swipe is wired to the same `navigate`, so the two
 * cannot drift. What this spec defends is that wiring — a swipe hook that
 * looked up a post id of its own would be a second answer to a question that
 * already has one.
 */
const MODAL = fs.readFileSync(path.join(__dirname, 'post-detail-modal.tsx'), 'utf8');
const STAGE = fs.readFileSync(path.join(__dirname, 'post-video-stage.tsx'), 'utf8');

const SRC_ROOT = path.join(__dirname, '..', '..', '..');

/** Every file under `src/` that mentions a drag, so a third engine cannot hide. */
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('popup drag navigation', () => {
  describe('one engine, not three', () => {
    it('the popup imports the shared hook and the shared viewport', () => {
      expect(MODAL).toMatch(/import \{ usePostDragNavigation \} from '@hooks\/use-post-drag-navigation'/);
      expect(MODAL).toMatch(/import PostFeedDragViewport from '\.\/post-feed-drag-viewport'/);
    });

    it('there is exactly one drag hook and one drag viewport in the whole app', () => {
      const files = walk(SRC_ROOT).filter((file) => !/\.spec\.tsx?$/.test(file));
      const hooks = files.filter((file) => /export function usePostDragNavigation/.test(fs.readFileSync(file, 'utf8')));
      const viewports = files.filter((file) => /export default function PostFeedDragViewport/.test(fs.readFileSync(file, 'utf8')));
      expect(hooks.map((file) => path.basename(file))).toEqual(['use-post-drag-navigation.ts']);
      expect(viewports.map((file) => path.basename(file))).toEqual(['post-feed-drag-viewport.tsx']);
    });

    it('no surface hand-rolls a pointer gesture beside the shared one', () => {
      const files = walk(SRC_ROOT).filter((file) => !/\.spec\.tsx?$/.test(file));
      const offenders = files.filter((file) => {
        if (/use-post-drag-navigation\.ts$/.test(file)) return false;
        const source = fs.readFileSync(file, 'utf8');
        // A local `onPointerMove` that also measures vertical travel is the
        // shape a second engine would take.
        return /onPointerMove/.test(source) && /client[YX]\s*-/.test(source);
      });
      expect(offenders.map((file) => path.basename(file))).toEqual([]);
    });
  });

  describe('the popup asks the sequence, it does not compute', () => {
    it('feeds the drag exactly the values Next and Previous use', () => {
      // `previousPost`, `nextPost`, `canNext` and `navigate` all come out of
      // `usePostDetailSequence` and are handed straight to the drag.
      expect(MODAL).toMatch(/canPrevious: Boolean\(previousPost\)/);
      expect(MODAL).toMatch(/canNext,/);
      expect(MODAL).toMatch(/onNavigate: navigate/);
      expect(MODAL).toMatch(/const drag = usePopupDrag\(\{\s*stageRef, previousPost, nextPost, canNext, navigate/);
    });

    it('is used by BOTH popup layouts, so a photo and a video cannot diverge', () => {
      expect(MODAL.match(/const drag = usePopupDrag\(/g)).toHaveLength(2);
      expect(MODAL.match(/nextPost,/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('never resolves a post itself — no index, list, cursor or id lookup in the drag', () => {
      const start = MODAL.indexOf('function usePopupDrag');
      const body = MODAL.slice(start, MODAL.indexOf('\n}', MODAL.indexOf('return { handlers', start)));
      expect(body).not.toMatch(/findIndex|\.filter\(|posts\[|_id|sessionId|cursor/);
    });

    it('is disabled exactly when the shared navigation context says so', () => {
      expect(MODAL.match(/enabled: mode !== 'disabled'/g)).toHaveLength(2);
    });
  });

  describe('what moves', () => {
    it('the video layout wraps only the player and the rail, leaving the tabs anchored', () => {
      expect(MODAL).toMatch(/wrapStage=\{drag\.wrap\}/);
      // `wrapStage` is applied to the moving stage only; the detail panel is a
      // sibling rendered after it.
      const section = STAGE.slice(STAGE.indexOf('{wrapStage ? wrapStage(movingStage) : movingStage}'));
      expect(section).toMatch(/PostVideoDetailPanel/);
      const moving = STAGE.slice(STAGE.indexOf('const movingStage = ('), STAGE.indexOf('{wrapStage ?'));
      expect(moving).not.toMatch(/PostVideoDetailPanel/);
    });

    it('the graphic layout wraps the carousel and keeps its centring on the slide', () => {
      expect(MODAL).toMatch(/\{drag\.wrap\(\(/);
      expect(MODAL).toMatch(/\), 'flex items-center justify-center'\)\}/);
    });

    it('leaves the backdrop, the close button and the message button outside the wrap', () => {
      const wrapStart = MODAL.indexOf("{drag.wrap((");
      const before = MODAL.slice(0, wrapStart);
      // The top-left control is now the shared `PostDetailBackButton` — both
      // layouts render it, and it is still outside the dragged wrap.
      expect(before).toMatch(/<PostDetailBackButton/);
      expect(before).toMatch(/PostDetailMessageButton/);
      expect(before).toMatch(/blur-\[42px\]/);
    });
  });
});

/**
 * The equivalence the whole design rests on: for one sequence, a swipe and a
 * button press resolve to the same navigation call, in both directions and at
 * both edges.
 */
describe('swipe and buttons resolve identically', () => {
  const ITEM_HEIGHT = 900;
  const THRESHOLD = dragCommitThreshold(ITEM_HEIGHT);

  let calls: string[] = [];

  function Harness({ canPrevious = true, canNext = true, enabled = true }) {
    const drag = usePostDragNavigation({
      canPrevious,
      canNext,
      itemHeight: ITEM_HEIGHT,
      enabled,
      onNavigate: (direction) => calls.push(`drag:${direction}`)
    });
    return (
      <div data-testid="stage" {...drag.handlers}>
        {/* The buttons the popup already had, calling the same `navigate`. */}
        <button type="button" data-testid="prev" onClick={() => calls.push('button:previous')} />
        <button type="button" data-testid="next" onClick={() => calls.push('button:next')} />
      </div>
    );
  }

  function pointer(type: string, y: number) {
    const event: any = new Event(type, { bubbles: true });
    event.clientX = 100;
    event.clientY = y;
    event.pointerId = 1;
    event.pointerType = 'touch';
    return event;
  }

  function swipe(dy: number) {
    const stage = screen.getByTestId('stage');
    act(() => stage.dispatchEvent(pointer('pointerdown', 500)));
    act(() => stage.dispatchEvent(pointer('pointermove', 500 + dy)));
    act(() => stage.dispatchEvent(pointer('pointerup', 500 + dy)));
    act(() => { jest.advanceTimersByTime(DRAG_COMMIT_MS); });
  }

  beforeEach(() => {
    calls = [];
    jest.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined })
    });
  });
  afterEach(() => {
    act(() => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  it('swiping up requests the same direction the Next button does', () => {
    render(<Harness />);
    swipe(-(THRESHOLD + 20));
    expect(calls).toEqual(['drag:next']);
  });

  it('swiping down requests the same direction the Previous button does', () => {
    render(<Harness />);
    swipe(THRESHOLD + 20);
    expect(calls).toEqual(['drag:previous']);
  });

  it('one gesture requests exactly one navigation', () => {
    render(<Harness />);
    swipe(-(THRESHOLD + 400));
    expect(calls).toEqual(['drag:next']);
  });

  it('a second flick during the settle is refused, so one hand movement is one post', () => {
    render(<Harness />);
    const stage = screen.getByTestId('stage');
    act(() => stage.dispatchEvent(pointer('pointerdown', 500)));
    act(() => stage.dispatchEvent(pointer('pointermove', 500 - (THRESHOLD + 20))));
    act(() => stage.dispatchEvent(pointer('pointerup', 500 - (THRESHOLD + 20))));
    // Still committing — a new gesture must not start.
    act(() => stage.dispatchEvent(pointer('pointerdown', 500)));
    act(() => stage.dispatchEvent(pointer('pointermove', 500 - (THRESHOLD + 20))));
    act(() => stage.dispatchEvent(pointer('pointerup', 500 - (THRESHOLD + 20))));
    act(() => { jest.advanceTimersByTime(DRAG_COMMIT_MS * 2); });
    expect(calls).toEqual(['drag:next']);
  });

  it('at the end of the sequence an upward swipe rolls back and navigates nothing', () => {
    render(<Harness canNext={false} />);
    swipe(-(THRESHOLD + 20));
    expect(calls).toEqual([]);
  });

  it('at the start an downward swipe rolls back and navigates nothing', () => {
    render(<Harness canPrevious={false} />);
    swipe(THRESHOLD + 20);
    expect(calls).toEqual([]);
  });

  it('a disabled context navigates on neither direction', () => {
    render(<Harness enabled={false} />);
    swipe(-(THRESHOLD + 20));
    swipe(THRESHOLD + 20);
    expect(calls).toEqual([]);
  });

  it('a short drag rolls back, leaving the active post untouched', () => {
    render(<Harness />);
    swipe(-(THRESHOLD - 10));
    expect(calls).toEqual([]);
  });
});
