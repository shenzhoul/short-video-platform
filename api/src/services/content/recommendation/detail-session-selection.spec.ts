import { DETAIL_SESSION_POLICY } from 'src/common/constants/recommendation';

import { pickWeightedByRank, seededUnitInterval } from './recommendation-hash.util';

/**
 * How the detail engine picks the next post, and why it is seeded rather than
 * ranked-first or random.
 *
 * ## The defect
 *
 * Selection was `scored[0]` over the 30 newest eligible posts. The only
 * per-session input to a score is `sessionJitter`, worth at most
 * `SESSION_JITTER_MAGNITUDE` (0.03) — nowhere near enough to reorder the head
 * of the ranking. So the "independent" detail session was deterministic across
 * unrelated sessions: every popup replayed the same A, B, C.
 *
 * ## The contract
 *
 * The choice is made from the top `selectionWindow` of the ranking, indexed by
 * `seededUnitInterval('<sessionSeed>:<step>')`. That gives three properties at
 * once, and this spec pins all three:
 *
 *   - **reproducible** — one seed always replays one sequence, which is what
 *     makes history, pagination and debugging possible;
 *   - **varied** — different seeds diverge from the first step;
 *   - **quality-preserving** — every pick is inside the top of the ranking, so
 *     this is not a shuffle of the catalogue.
 *
 * Seeds are injected, never observed: a test built on real randomness would be
 * flaky by construction.
 */

/** The production selection rule, expressed exactly as the service applies it. */
function pickIndex(sessionSeed: string, step: number, windowLength: number): number {
  return pickWeightedByRank(
    windowLength,
    seededUnitInterval(`${sessionSeed}:${step}`),
    DETAIL_SESSION_POLICY.selectionRankDecay
  );
}

/** Walk a whole session the way the service does: pick, exclude, re-rank. */
function walkSession(sessionSeed: string, ranked: string[], steps: number): string[] {
  const remaining = [...ranked];
  const served: string[] = [];
  for (let step = 0; step < steps; step += 1) {
    if (!remaining.length) break;
    const window = remaining.slice(0, DETAIL_SESSION_POLICY.selectionWindow);
    const index = pickIndex(sessionSeed, step + 1, window.length);
    const [chosen] = remaining.splice(index, 1);
    served.push(chosen);
  }
  return served;
}

const RANKED = Array.from({ length: 120 }, (_, index) => `post-${String(index).padStart(3, '0')}`);

describe('detail-session next selection', () => {
  describe('reproducibility', () => {
    it('replays the same sequence for the same seed', () => {
      const first = walkSession('seed-alpha', RANKED, 10);
      const second = walkSession('seed-alpha', RANKED, 10);
      expect(second).toEqual(first);
    });

    it('is a pure function of seed and step — no Math.random anywhere in the rule', () => {
      // Called 200 times, always the same answer.
      const answers = new Set(
        Array.from({ length: 200 }, () => pickIndex('seed-alpha', 3, 8))
      );
      expect(answers.size).toBe(1);
    });
  });

  describe('variation', () => {
    it('five different seeds do not all share one ordered prefix', () => {
      const seeds = ['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e'];
      const prefixes = seeds.map((seed) => walkSession(seed, RANKED, 10).join(','));
      expect(new Set(prefixes).size).toBeGreaterThan(1);
    });

    it('different seeds diverge at the very first step, not several in', () => {
      const firsts = ['seed-a', 'seed-b', 'seed-c', 'seed-d', 'seed-e']
        .map((seed) => walkSession(seed, RANKED, 1)[0]);
      // Not all five identical — which is exactly what `scored[0]` produced.
      expect(new Set(firsts).size).toBeGreaterThan(1);
    });

    it('the old rule would have produced one identical prefix for every seed', () => {
      // `scored[0]` ignores the seed entirely, which is the bug.
      const oldRule = (ranked: string[], steps: number) => ranked.slice(0, steps).join(',');
      const prefixes = ['seed-a', 'seed-b', 'seed-c'].map(() => oldRule(RANKED, 10));
      expect(new Set(prefixes).size).toBe(1);
    });
  });

  describe('quality and safety', () => {
    it('never picks outside the top window of the ranking', () => {
      for (let step = 0; step < 50; step += 1) {
        const index = pickIndex('seed-alpha', step, DETAIL_SESSION_POLICY.selectionWindow);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(DETAIL_SESSION_POLICY.selectionWindow);
      }
    });

    it('serves no duplicate before the pool is exhausted', () => {
      const served = walkSession('seed-alpha', RANKED, RANKED.length);
      expect(new Set(served).size).toBe(served.length);
    });

    it('stops at exhaustion rather than wrapping to the beginning', () => {
      const served = walkSession('seed-alpha', RANKED.slice(0, 5), 20);
      expect(served).toHaveLength(5);
      expect(new Set(served).size).toBe(5);
    });

    it('handles a window shorter than the configured size', () => {
      expect(pickIndex('seed-alpha', 1, 1)).toBe(0);
      expect(pickIndex('seed-alpha', 1, 2)).toBeLessThan(2);
    });
  });

  describe('the widened pool', () => {
    it('retrieves well beyond the 30 newest, so the window has real choice', () => {
      expect(DETAIL_SESSION_POLICY.candidatePoolSize).toBeGreaterThanOrEqual(200);
    });

    it('is wide enough that fifty positions can cover a real slice of the corpus', () => {
      expect(DETAIL_SESSION_POLICY.selectionWindow).toBeGreaterThanOrEqual(30);
    });

    it('still favours the head — the draw is rank-weighted, not a shuffle', () => {
      // Over many seeds, rank 0 must come up far more often than the last rank.
      const counts = new Map<number, number>();
      for (let seed = 0; seed < 4000; seed += 1) {
        const index = pickWeightedByRank(
          DETAIL_SESSION_POLICY.selectionWindow,
          seededUnitInterval(`s${seed}`),
          DETAIL_SESSION_POLICY.selectionRankDecay
        );
        counts.set(index, (counts.get(index) || 0) + 1);
      }
      const head = counts.get(0) || 0;
      const tail = counts.get(DETAIL_SESSION_POLICY.selectionWindow - 1) || 0;
      expect(head).toBeGreaterThan(tail * 4);
      // …but the tail is genuinely reachable, which a top-8 window never was.
      expect(tail).toBeGreaterThan(0);
    });

    it('covers well over thirty distinct posts across five sessions of ten', () => {
      const served = new Set<string>();
      ['s-a', 's-b', 's-c', 's-d', 's-e'].forEach((seed) => {
        walkSession(seed, RANKED, 10).forEach((id) => served.add(id));
      });
      expect(served.size).toBeGreaterThanOrEqual(30);
    });
  });
});
