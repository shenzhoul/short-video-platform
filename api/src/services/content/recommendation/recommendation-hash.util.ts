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
