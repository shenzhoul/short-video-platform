/**
 * Deterministic randomness.
 *
 * Every choice the demo tooling makes — which avatar pattern an account gets,
 * who follows whom, which posts are popular, what time a post was published —
 * comes from a seeded generator keyed by a stable string. Two runs of
 * `demo:seed` therefore produce the same dataset, which is what makes the second
 * run a no-op instead of a second, differently-shaped copy.
 *
 * `Math.random()` must not appear anywhere in this feature.
 */

const crypto = require('crypto');

/** A stable 32-bit seed from any string. */
function seedFrom(text) {
  const digest = crypto.createHash('sha256').update(String(text)).digest();
  return digest.readUInt32BE(0);
}

/**
 * mulberry32 — small, fast, and good enough for picking captions and follow
 * edges. Not for anything security-bearing, and nothing here is.
 */
function createRandom(seedText) {
  let state = seedFrom(seedText);
  const next = () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    /** Integer in [min, max], inclusive. */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** True with probability p. */
    chance: (p) => next() < p,
    /** One element. */
    pick: (items) => items[Math.floor(next() * items.length)],
    /** A shuffled copy — Fisher-Yates, so every permutation is reachable. */
    shuffle: (items) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    },
    /**
     * n distinct elements, or all of them when n exceeds the pool.
     * Shuffling first is what keeps the choice unbiased.
     */
    sample: (items, n) => {
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(next() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy.slice(0, Math.max(0, Math.min(n, copy.length)));
    }
  };
}

module.exports = { createRandom, seedFrom };
