import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import Modal from './modal';

/**
 * A dialog must be a solid thing over the page, and must not take the page's
 * keyboard events with it.
 *
 * The panel carried no background of its own, so any caller that did not supply
 * one rendered a transparent dialog — legible over a plain page by accident, and
 * unreadable over video. Escape was unhandled too, which meant it reached the
 * Post Detail listener on `window` and closed the *post* instead of the dialog.
 */
describe('Modal panel surface', () => {
  const panel = () => screen.getByRole('dialog');

  it('paints its own opaque surface by default', () => {
    render(<Modal open title="Are you sure?"><p>body</p></Modal>);

    // A dialog with no background is never correct, whatever the caller forgot.
    expect(panel().className).toMatch(/bg-\(--surface-raised\)/);
    expect(panel().className).toMatch(/border/);
  });

  it('marks itself as a modal dialog', () => {
    render(<Modal open title="Titled"><p>body</p></Modal>);

    expect(panel().getAttribute('aria-modal')).toBe('true');
  });

  it('lets a caller with its own surface keep control', () => {
    // Two competing `bg-` classes have equal specificity, so the default is
    // omitted rather than layered under the caller's and hoping.
    render(<Modal open className="bg-[#262734]"><p>body</p></Modal>);

    expect(panel().className).toContain('bg-[#262734]');
    expect(panel().className).not.toMatch(/bg-\(--surface-raised\)/);
  });

  it('does not let a click inside reach the backdrop', () => {
    const onCancel = jest.fn();
    render(<Modal open onCancel={onCancel}><p>body</p></Modal>);

    fireEvent.click(screen.getByText('body'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  describe('Escape', () => {
    it('closes the dialog', () => {
      jest.useFakeTimers();
      const onCancel = jest.fn();
      render(<Modal open onCancel={onCancel}><p>body</p></Modal>);

      fireEvent.keyDown(document, { key: 'Escape' });
      jest.advanceTimersByTime(300);

      expect(onCancel).toHaveBeenCalled();
      jest.useRealTimers();
    });

    it('does not reach a listener on window', () => {
      // Post Detail listens there. Document handlers run first, so stopping
      // propagation here is what keeps Escape from closing the post underneath.
      const windowListener = jest.fn();
      window.addEventListener('keydown', windowListener);
      render(<Modal open onCancel={jest.fn()}><p>body</p></Modal>);

      fireEvent.keyDown(document, { key: 'Escape' });

      expect(windowListener).not.toHaveBeenCalled();
      window.removeEventListener('keydown', windowListener);
    });

    it('leaves other keys alone', () => {
      const windowListener = jest.fn();
      window.addEventListener('keydown', windowListener);
      render(<Modal open onCancel={jest.fn()}><p>body</p></Modal>);

      fireEvent.keyDown(document, { key: 'a' });

      expect(windowListener).toHaveBeenCalled();
      window.removeEventListener('keydown', windowListener);
    });
  });

  it('keeps Tab inside the dialog', () => {
    render(
      <Modal open onCancel={jest.fn()} closable={false} footer={false}>
        <button type="button">first</button>
        <button type="button">last</button>
      </Modal>
    );

    const last = screen.getByText('last');
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    // Wrapped back to the start rather than escaping into the page behind.
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('hands focus back to whatever opened it', () => {
    render(<button type="button" data-testid="opener">open</button>);
    const opener = screen.getByTestId('opener');
    opener.focus();

    const view = render(<Modal open onCancel={jest.fn()}><p>body</p></Modal>);
    view.unmount();

    expect(document.activeElement).toBe(opener);
  });
});
