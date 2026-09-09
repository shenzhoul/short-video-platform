import { createHash } from 'crypto';

/**
 * Deterministic pseudo-random value in [0, 1) from a seed string.
 *
 * Used everywhere this engine needs "random but repeatable within one
 * session" — session jitter and diversity tie-breaking — because
 * `Math.random()` cannot be replayed for the same session/cursor and would
 * make load-more pagination and reload semantics indistinguishable (rules:
 * "Không dùng Math.random() trực tiếp cho từng page/request").
 */
export function seededUnitInterval(seed: string): number {
  const digest = createHash('sha256').update(seed).digest();
  // First 6 bytes give ample precision for a stable-sort tie-breaker or a
  // small jitter magnitude without needing the full 32-byte digest.
  const int = digest.readUIntBE(0, 6);
  return int / 2 ** 48;
}

/** Maps a seeded unit interval to `[-magnitude, +magnitude]`. */
export function seededJitter(seed: string, magnitude: number): number {
  return (seededUnitInterval(seed) * 2 - 1) * magnitude;
}

/**
 * Pick an index from a ranked list, favouring the head but reaching the tail.
 *
 * `weight(i) = 1 / (i + 1) ** decay`, drawn against a seeded unit interval, so
 * the choice is repeatable for a seed and spread across the window rather than
 * pinned to its first few entries. A uniform draw over a narrow window was
 * measured re-serving one small group across unrelated sessions; a uniform draw
 * over a *wide* window would throw the ranking away. This keeps both: rank 0 is
 * about ten times likelier than rank 39 at `decay = 1`.
 *
 * `unit` must be in `[0, 1)`; the final index is clamped so a rounding error at
 * the very top of the range cannot fall off the end.
 */
export function pickWeightedByRank(length: number, unit: number, decay = 1): number {
  if (length <= 1) return 0;
  const weights: number[] = [];
  let total = 0;
  for (let index = 0; index < length; index += 1) {
    const weight = 1 / (index + 1) ** decay;
    weights.push(weight);
    total += weight;
  }
  let cursor = unit * total;
  for (let index = 0; index < length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return index;
  }
  return length - 1;
}
