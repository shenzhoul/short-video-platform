import { fireEvent, render, screen } from '@testing-library/react';

import Dropdown from './dropdown-menu';

/**
 * Escape closes a dropdown even when nothing inside it has focus.
 *
 * The handler used to be a React `onKeyDown` on the wrapper, which only fires
 * while focus is inside that subtree. A `triggerMode="hover"` menu is opened by
 * a pointer and never takes focus, so the account menu ignored Escape
 * completely — measured in a real browser at 440x956, an outside click closed
 * it and Escape did not. That is the one dismissal a keyboard user has.
 */
describe('dropdown dismissal', () => {
  const panel = <div data-testid="panel">Panel contents</div>;

  it('closes on Escape when opened by hover, with focus on the body', () => {
    render(
      <Dropdown trigger={<span>Open</span>} triggerMode="hover">
        {panel}
      </Dropdown>
    );

    fireEvent.mouseEnter(screen.getByText('Open').parentElement!.parentElement!);
    expect(screen.getByTestId('panel')).toBeInTheDocument();

    // Focus is on <body> — exactly the state a pointer-opened menu leaves.
    expect(document.activeElement).toBe(document.body);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('closes on Escape when opened by click', () => {
    render(
      <Dropdown trigger={<span>Open</span>}>
        {panel}
      </Dropdown>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByTestId('panel')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('ignores other keys', () => {
    render(
      <Dropdown trigger={<span>Open</span>}>
        {panel}
      </Dropdown>
    );

    fireEvent.click(screen.getByText('Open'));
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'a' });
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });

  it('still closes on an outside click', () => {
    render(
      <Dropdown trigger={<span>Open</span>}>
        {panel}
      </Dropdown>
    );

    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByTestId('panel')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  it('leaves a closed dropdown closed', () => {
    render(
      <Dropdown trigger={<span>Open</span>}>
        {panel}
      </Dropdown>
    );

    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByTestId('panel')).not.toBeInTheDocument();
  });

  /**
   * A controlled dropdown reports the dismissal rather than closing itself, so
   * the owner stays the single source of truth for whether it is open.
   */
  it('reports Escape through onOpenChange when controlled', () => {
    const onOpenChange = jest.fn();
    render(
      <Dropdown trigger={<span>Open</span>} open onOpenChange={onOpenChange}>
        {panel}
      </Dropdown>
    );

    expect(screen.getByTestId('panel')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    // Still open: the owner decides.
    expect(screen.getByTestId('panel')).toBeInTheDocument();
  });
});
