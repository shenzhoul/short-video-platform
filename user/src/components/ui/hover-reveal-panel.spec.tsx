import HoverRevealPanel from '@components/ui/hover-reveal-panel';
import { fireEvent, render } from '@testing-library/react';

/*
 * jsdom has no layout, so the geometry the component reads is supplied here:
 * a profile scroll container at 160..1440 and a panel whose natural box is
 * `layout.panelLeft .. + panelWidth`. The mock honours the margin the component
 * applies, exactly as layout would move the box.
 */
const layout = { panelLeft: 1350, panelWidth: 100 };
const CLIP = { left: 160, width: 1280 };

const box = (left: number, width: number) => ({
  left, right: left + width, width, top: 0, bottom: 10, height: 10, x: left, y: 0, toJSON: () => ({})
}) as DOMRect;

function renderInProfile(props: Partial<Parameters<typeof HoverRevealPanel>[0]> = {}) {
  return render(
    <div data-testid="clip" style={{ overflowX: 'auto' }}>
      <HoverRevealPanel panel={<div>Report</div>} panelPositionClassName="right-[-10px] top-full" {...props}>
        <button type="button">More actions</button>
      </HoverRevealPanel>
    </div>
  );
}

const panelOf = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-hover-reveal-panel]');

/*
 * That a fitted panel is absent from server HTML is asserted against the real
 * server response in `browser-verify/49-profile-panel-overflow.js`: the Jest
 * setup is jsdom-only and `react-dom/server`'s browser build needs a
 * MessageChannel jsdom does not provide.
 */
describe('HoverRevealPanel fitWithinScrollport', () => {
  beforeEach(() => {
    layout.panelLeft = 1350;
    layout.panelWidth = 100;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
      const element = this as HTMLElement;
      if (element.hasAttribute('data-hover-reveal-panel')) {
        return box(layout.panelLeft + (parseFloat(element.style.marginLeft) || 0), layout.panelWidth);
      }
      if (element.dataset.testid === 'clip') return box(CLIP.left, CLIP.width);
      return box(0, 0);
    });
    jest.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function mockWidth(this: HTMLElement) {
      return this.dataset?.testid === 'clip' ? CLIP.width : 0;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('leaves a panel that does not opt in exactly where its classes put it', () => {
    const { container } = renderInProfile();
    const panel = panelOf(container);
    expect(panel).not.toBeNull();
    expect(panel?.style.marginLeft).toBe('');
    expect(panel?.style.marginRight).toBe('');
  });

  it('pulls a panel back by exactly the distance it crosses the edge', () => {
    // natural 1350..1450 against an edge at 1440
    const { container } = renderInProfile({ fitWithinScrollport: true });
    const panel = panelOf(container);
    expect(panel?.style.marginLeft).toBe('-10px');
    expect(panel?.style.marginRight).toBe('10px');
    expect(panel?.getBoundingClientRect().right).toBe(1440);
  });

  it('does not move a panel that already fits', () => {
    layout.panelLeft = 1200;
    const { container } = renderInProfile({ fitWithinScrollport: true });
    expect(panelOf(container)?.style.marginLeft).toBe('');
  });

  it('re-checks when the pointer arrives, and removes a correction that is no longer needed', () => {
    const { container, getByRole } = renderInProfile({ fitWithinScrollport: true });
    expect(panelOf(container)?.style.marginLeft).toBe('-10px');
    layout.panelLeft = 1000; // the trigger moved without anything resizing
    // React derives onPointerEnter from pointerover, so that is the event to dispatch.
    fireEvent.pointerOver(getByRole('button', { name: 'More actions' }));
    expect(panelOf(container)?.style.marginLeft).toBe('');
    expect(panelOf(container)?.style.marginRight).toBe('');
  });

  it('keeps the start edge visible when the panel is wider than the room it has', () => {
    layout.panelLeft = 100;
    layout.panelWidth = 1400;
    const { container } = renderInProfile({ fitWithinScrollport: true });
    expect(panelOf(container)?.getBoundingClientRect().left).toBe(CLIP.left);
  });

  it('renders nothing to place while disabled', () => {
    const { container } = renderInProfile({ fitWithinScrollport: true, disabled: true });
    expect(panelOf(container)).toBeNull();
  });
});
