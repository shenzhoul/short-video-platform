import '@testing-library/jest-dom';

/**
 * jsdom stops short of layout, so a handful of browser APIs the components use
 * simply do not exist. Each stub below stands in for one of them.
 *
 * These are environment gaps, not behaviour under test — nothing here replaces
 * application logic.
 */

// The mention picker restores the caret after React re-renders. jsdom has no
// frame loop, so run the callback immediately and keep insertion synchronous.
if (typeof window.requestAnimationFrame === 'undefined') {
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = (() => undefined) as typeof window.cancelAnimationFrame;
}

// Auto-resizing textareas read scrollHeight, which jsdom always reports as 0.
if (!Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')) {
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() { return 0; }
  });
}

// jsdom implements no layout, so scrolling an element into view does not exist.
// Components legitimately call it; the assertions are about what was rendered
// and anchored, not about the scroll itself.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoViewStub() { return undefined; };
}

window.matchMedia = window.matchMedia || ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => undefined,
  removeListener: () => undefined,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  dispatchEvent: () => false
} as unknown as MediaQueryList));

class ResizeObserverStub {
  observe() { return undefined; }

  unobserve() { return undefined; }

  disconnect() { return undefined; }
}

window.ResizeObserver = window.ResizeObserver || (ResizeObserverStub as any);

window.IntersectionObserver = window.IntersectionObserver || (class {
  observe() { return undefined; }

  unobserve() { return undefined; }

  disconnect() { return undefined; }

  takeRecords() { return []; }
} as any);
