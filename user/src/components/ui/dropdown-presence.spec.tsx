/**
 * The shared dropdown surface's lifecycle: enter, exit, and one-at-a-time groups.
 *
 * jsdom has no Web Animations API, so the exit animation the stylesheet would
 * start is stood in for by a controllable fake returned from `getAnimations()`
 * while the surface is `data-state="closed"`. What is pinned is the lifecycle,
 * not the keyframes: a closing surface stays mounted until its exit animation
 * reports finished, a reopen during the exit keeps the same element, a surface
 * with nothing to wait for unmounts at once, and opening one member of a group
 * closes the others.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import Dropdown from './dropdown-menu';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };
function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const surfaces = () => document.querySelectorAll('[data-dropdown-surface]');

describe('dropdown surface presence', () => {
  const original = (Element.prototype as any).getAnimations;
  let exit: Deferred;

  beforeEach(() => {
    exit = deferred();
    (Element.prototype as any).getAnimations = function getAnimations(this: Element) {
      if (!this.hasAttribute('data-dropdown-surface') || this.getAttribute('data-state') !== 'closed') return [];
      return [{ animationName: 'dropdown-surface-exit', finished: exit.promise }];
    };
  });

  afterEach(() => {
    if (original) (Element.prototype as any).getAnimations = original;
    else delete (Element.prototype as any).getAnimations;
  });

  it('opens with data-state="open" on the first render of the surface', () => {
    render(<Dropdown trigger={<button type="button">Open</button>}>menu</Dropdown>);

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(surfaces()).toHaveLength(1);
    expect(surfaces()[0]).toHaveAttribute('data-state', 'open');
    expect(surfaces()[0]).toHaveClass('dropdown-menu-motion');
  });

  it('keeps a closing surface mounted until its exit animation has finished', async () => {
    render(<Dropdown trigger={<button type="button">Open</button>}>menu</Dropdown>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect(surfaces()).toHaveLength(1);
    expect(surfaces()[0]).toHaveAttribute('data-state', 'closed');
    await act(async () => { exit.resolve(); await exit.promise; });
    expect(surfaces()).toHaveLength(0);
  });

  it('reopening during the exit keeps the same element and does not unmount it later', async () => {
    render(<Dropdown trigger={<button type="button">Open</button>}>menu</Dropdown>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const surface = surfaces()[0];

    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    await act(async () => { exit.resolve(); await exit.promise; });

    expect(surfaces()).toHaveLength(1);
    expect(surfaces()[0]).toBe(surface);
    expect(surface).toHaveAttribute('data-state', 'open');
  });

  it('closes with Escape through the same exit', async () => {
    render(<Dropdown trigger={<button type="button">Open</button>}>menu</Dropdown>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(surfaces()[0]).toHaveAttribute('data-state', 'closed');
    await act(async () => { exit.resolve(); await exit.promise; });
    expect(surfaces()).toHaveLength(0);
  });

  it('opening one member of a group closes the other at once', () => {
    render(
      <>
        <Dropdown group="header" trigger={<button type="button">First</button>}>first menu</Dropdown>
        <Dropdown group="header" trigger={<button type="button">Second</button>}>second menu</Dropdown>
        <Dropdown trigger={<button type="button">Elsewhere</button>}>other menu</Dropdown>
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(screen.getByText('first menu').closest('[data-dropdown-surface]')).toHaveAttribute('data-state', 'open');

    fireEvent.click(screen.getByRole('button', { name: 'Second' }));

    expect(screen.getByText('first menu').closest('[data-dropdown-surface]')).toHaveAttribute('data-state', 'closed');
    expect(screen.getByText('second menu').closest('[data-dropdown-surface]')).toHaveAttribute('data-state', 'open');
    // A dropdown outside the group is left alone.
    expect(screen.getByText('other menu').closest('[data-dropdown-surface]')).toHaveAttribute('data-state', 'open');
  });

  it('sets the transform origin from the position', () => {
    render(<Dropdown position="left" trigger={<button type="button">Open</button>}>menu</Dropdown>);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));

    expect((surfaces()[0] as HTMLElement).style.transformOrigin).toBe('top left');
  });
});

describe('dropdown surface without animations', () => {
  it('unmounts immediately when there is no exit animation to wait for (reduced motion, no WAAPI)', () => {
    const original = (Element.prototype as any).getAnimations;
    (Element.prototype as any).getAnimations = () => [];
    try {
      render(<Dropdown trigger={<button type="button">Open</button>}>menu</Dropdown>);
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));
      fireEvent.click(screen.getByRole('button', { name: 'Open' }));

      expect(surfaces()).toHaveLength(0);
    } finally {
      if (original) (Element.prototype as any).getAnimations = original;
      else delete (Element.prototype as any).getAnimations;
    }
  });
});
