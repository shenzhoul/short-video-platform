/**
 * The section-switch glide in the account menu.
 *
 * jsdom has no layout and no Web Animations API, so the geometry is stubbed per
 * element and `animate` is a spy. What is pinned is the arithmetic and the
 * lifecycle: each element starts from where it was drawn, a still-running glide
 * is cancelled rather than stacked, and an element that did not move is left
 * alone.
 */
import { captureTops, glideFromTops, LAYOUT_GLIDE_ANIMATION_ID } from './layout-glide';

function stubElement(top: number) {
  const element = document.createElement('div');
  let currentTop = top;
  const running: Array<{ id: string; cancel: jest.Mock }> = [];
  element.getBoundingClientRect = () => ({ top: currentTop } as DOMRect);
  (element as any).getAnimations = () => running;
  (element as any).animate = jest.fn((keyframes, options) => {
    const animation = { id: '', cancel: jest.fn(), keyframes, options };
    running.push(animation);
    return animation;
  });
  return {
    element,
    running,
    moveTo(next: number) { currentTop = next; }
  };
}

describe('layout glide', () => {
  it('plays each moved element from its previous top to its new one', () => {
    const history = stubElement(376);
    const works = stubElement(472);
    const tops = captureTops([history.element, works.element]);

    // The liked preview (152px) closed above them.
    history.moveTo(224);
    works.moveTo(320);
    const started = glideFromTops(tops, [history.element, works.element], { duration: 260, easing: 'ease-out' });

    expect(started).toHaveLength(2);
    expect((history.element as any).animate).toHaveBeenCalledWith(
      [{ transform: 'translateY(152px)' }, { transform: 'translateY(0)' }],
      { duration: 260, easing: 'ease-out' }
    );
    expect(started[0].id).toBe(LAYOUT_GLIDE_ANIMATION_ID);
  });

  it('moves rows down with a negative start offset when a preview opens above them', () => {
    const row = stubElement(224);
    const tops = captureTops([row.element]);
    row.moveTo(376);

    glideFromTops(tops, [row.element], { duration: 260, easing: 'ease-out' });

    expect((row.element as any).animate.mock.calls[0][0][0]).toEqual({ transform: 'translateY(-152px)' });
  });

  it('leaves an element that did not move untouched', () => {
    const footer = stubElement(640);
    const tops = captureTops([footer.element]);

    expect(glideFromTops(tops, [footer.element], { duration: 260, easing: 'ease-out' })).toHaveLength(0);
    expect((footer.element as any).animate).not.toHaveBeenCalled();
  });

  it('cancels a glide still running before starting the next one, so they never stack', () => {
    const row = stubElement(376);
    const first = glideFromTops(captureTops([row.element]), [row.element], { duration: 260, easing: 'ease-out' });
    expect(first).toHaveLength(0);

    const tops = captureTops([row.element]);
    row.moveTo(224);
    const [running] = glideFromTops(tops, [row.element], { duration: 260, easing: 'ease-out' });
    const again = captureTops([row.element]);
    row.moveTo(376);
    glideFromTops(again, [row.element], { duration: 260, easing: 'ease-out' });

    expect((running as any).cancel).toHaveBeenCalledTimes(1);
  });

  it('does nothing where the Web Animations API is missing', () => {
    const element = document.createElement('div');
    element.getBoundingClientRect = () => ({ top: 10 } as DOMRect);
    const tops = captureTops([element]);
    element.getBoundingClientRect = () => ({ top: 90 } as DOMRect);

    expect(glideFromTops(tops, [element], { duration: 260, easing: 'ease-out' })).toEqual([]);
  });
});
