import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';

import { useNavigationInputActive } from './use-navigation-input-active';

/**
 * The `inputActive` term of the navigation matrix.
 *
 * It is the one rule that outranks creator mode, so it has to be right in both
 * directions: a scrub or a reply in progress must disable navigation, and an
 * ordinary tap on the media must not.
 */
function Probe() {
  const ref = useRef<HTMLDivElement>(null);
  const active = useNavigationInputActive(ref);
  return (
    <div ref={ref}>
      <span data-testid="active">{active ? 'yes' : 'no'}</span>
      <input data-testid="comment" />
      <button type="button" data-testid="plain">play</button>
      <div data-testid="seek" role="slider" aria-valuenow={0} tabIndex={-1} />
      <div data-testid="held" data-navigation-hold="true" />
    </div>
  );
}

// jsdom has no `PointerEvent` constructor; the hook only reads `type` and
// `target`, so a bubbling Event of the same name is an accurate stand-in.
function pointerDownOn(testId: string) {
  const target = screen.getByTestId(testId);
  act(() => {
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  });
}

function pointerUp() {
  act(() => {
    document.dispatchEvent(new Event('pointerup', { bubbles: true }));
  });
}

describe('useNavigationInputActive', () => {
  beforeEach(() => render(<Probe />));

  const state = () => screen.getByTestId('active').textContent;

  it('is inactive with nothing focused and nothing held', () => {
    expect(state()).toBe('no');
  });

  it('becomes active while a text field has focus', () => {
    act(() => screen.getByTestId('comment').focus());
    expect(state()).toBe('yes');
  });

  it('goes inactive again when the text field is blurred', () => {
    act(() => screen.getByTestId('comment').focus());
    act(() => screen.getByTestId('comment').blur());
    expect(state()).toBe('no');
  });

  it('becomes active while a pointer is held on the seek bar', () => {
    pointerDownOn('seek');
    expect(state()).toBe('yes');
  });

  it('releases the seek bar and re-enables navigation', () => {
    pointerDownOn('seek');
    pointerUp();
    expect(state()).toBe('no');
  });

  it('becomes active for anything explicitly marked as holding navigation', () => {
    pointerDownOn('held');
    expect(state()).toBe('yes');
  });

  it('does NOT activate for an ordinary press on the media or a plain control', () => {
    pointerDownOn('plain');
    expect(state()).toBe('no');
  });

  it('stays active after a release that lands inside a focused text field', () => {
    act(() => screen.getByTestId('comment').focus());
    pointerDownOn('comment');
    pointerUp();
    expect(state()).toBe('yes');
  });
});
