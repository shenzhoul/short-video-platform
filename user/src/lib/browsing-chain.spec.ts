import {
  __clearBrowsingChainsForTest,
  adoptBrowsingChainId,
  getBrowsingChainId,
  resetBrowsingChain
} from '@lib/browsing-chain';

/**
 * Chain identity — the three concepts that must stay separate.
 *
 * `deploy-2026-09-06g` derived the chain from the first session id, which made
 * it an identity the client could not name, reset or reason about. The
 * production consequence was a reload that inherited a nearly spent browse and
 * served **11 posts** before reporting the catalogue exhausted.
 */

beforeEach(() => {
  __clearBrowsingChainsForTest();
});

describe('getBrowsingChainId', () => {
  it('is stable within one page load, per surface', () => {
    const first = getBrowsingChainId('home');
    expect(getBrowsingChainId('home')).toBe(first);
    expect(getBrowsingChainId('home')).toBe(first);
  });

  it('gives Home and For You different chains', () => {
    expect(getBrowsingChainId('home')).not.toBe(getBrowsingChainId('for-you'));
  });

  it('gives each Home category its own chain', () => {
    // A category is its own browsing context: continuing inside the "All" chain
    // would exclude everything "All" had shown, which can empty a small
    // category outright.
    const all = getBrowsingChainId('home');
    const food = getBrowsingChainId('home', 'food');
    const travel = getBrowsingChainId('home', 'travel');

    expect(new Set([all, food, travel]).size).toBe(3);
    expect(getBrowsingChainId('home', 'food')).toBe(food);
  });

  it('mints an id the API will accept', () => {
    // Bounded and shape-checked server-side, because it becomes a Redis key
    // segment: 8..64 characters of [A-Za-z0-9_-].
    const id = getBrowsingChainId('home');
    expect(id.length).toBeGreaterThanOrEqual(8);
    expect(id.length).toBeLessThanOrEqual(64);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('a fresh module scope is a fresh chain — which is what a page reload is', () => {
    const before = getBrowsingChainId('home');
    // `__clearBrowsingChainsForTest` stands in for the module being evaluated
    // again. Nothing is persisted, so a reload cannot inherit a spent browse.
    __clearBrowsingChainsForTest();
    expect(getBrowsingChainId('home')).not.toBe(before);
  });

  it('keeps nothing in storage, so a reload cannot resurrect a chain', () => {
    getBrowsingChainId('home');
    getBrowsingChainId('for-you');

    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('adoptBrowsingChainId', () => {
  it('takes the id a server render already used', () => {
    const fromServer = '5f3b2c1a-9d8e-4f7a-b6c5-1234567890ab';
    expect(adoptBrowsingChainId('home', fromServer)).toBe(fromServer);
    // And every later request in this page load uses the same one, so the
    // server-rendered session's posts are inside the chain's seen-set.
    expect(getBrowsingChainId('home')).toBe(fromServer);
  });

  it('never re-points a browse already in progress', () => {
    const mine = getBrowsingChainId('home');
    // A late or re-rendered SSR payload must not move the chain out from under
    // a scroll that has already started.
    expect(adoptBrowsingChainId('home', 'a-different-server-id')).toBe(mine);
  });

  it('mints one when the server sent none', () => {
    const id = adoptBrowsingChainId('for-you', null);
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(getBrowsingChainId('for-you')).toBe(id);
  });

  it('adopts per category, not per surface', () => {
    adoptBrowsingChainId('home', 'server-chain-for-all');
    expect(getBrowsingChainId('home', 'food')).not.toBe('server-chain-for-all');
  });
});

describe('resetBrowsingChain', () => {
  it('abandons the current chain and starts a new one', () => {
    const before = getBrowsingChainId('home');
    const after = resetBrowsingChain('home');

    expect(after).not.toBe(before);
    expect(getBrowsingChainId('home')).toBe(after);
  });

  it('leaves the other surface alone', () => {
    const forYou = getBrowsingChainId('for-you');
    resetBrowsingChain('home');
    expect(getBrowsingChainId('for-you')).toBe(forYou);
  });
});
