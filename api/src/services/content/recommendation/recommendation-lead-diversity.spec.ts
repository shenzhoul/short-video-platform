import { ObjectId } from 'mongodb';
import { DIVERSITY_POLICY, SESSION_OUTPUT_POLICY } from 'src/common/constants/recommendation';

import { RecommendationDiversityService } from './recommendation-diversity.service';
import { RecommendationSelectionService } from './recommendation-selection.service';
import { ScoredCandidate } from './recommendation-scoring.service';

/**
 * Diversity of the **final emitted order**, classified.
 *
 * "Some violations are unavoidable once the pool runs low" is not something to
 * be asserted; it has to be shown. So every breach in an emitted session is
 * classified against the state that produced it:
 *
 *   avoidable   — at least one candidate still available could have gone in
 *                 that slot without breaking a rule, and the algorithm took a
 *                 violating one anyway.
 *   unavoidable — every remaining candidate would have broken a rule.
 *
 * The gate is **zero avoidable violations across all 70 positions**, not just
 * the opening batches, and the classification is computed from the order plus
 * the pool it was drawn from — never by comparing against "the same run without
 * a lead", which would only show whether one arrangement is worse than another.
 *
 * Constraints are checked over *sliding* windows, so they run across the 20/21,
 * 40/41 and 60/61 boundaries rather than resetting per batch.
 */

const SEEDS = 2000;

function candidate(index: number, creator: string, topicKey: string, finalScore: number): ScoredCandidate {
  return {
    post: {
      _id: new ObjectId(String(index + 1).padStart(24, '0')),
      userId: new ObjectId(creator.padStart(24, '0')),
      topicKey
    },
    source: ['trending', 'fresh', 'diverse', 'personalized'][index % 4],
    finalScore,
    breakdown: {},
    explorationStage: 2
  } as unknown as ScoredCandidate;
}

/** An even spread of creators and categories. */
const evenCatalogue = (size = 160): ScoredCandidate[] => Array.from({ length: size }, (_, index) => candidate(
  index,
  `c${(index % 16) + 1}`,
  ['food', 'music', 'games', 'travel', 'anime', 'sports'][index % 6],
  1 - (index / (size * 2))
));

/** The strongest work clusters on one creator. */
const creatorSkewedCatalogue = (size = 160): ScoredCandidate[] => Array.from({ length: size }, (_, index) => {
  const inCluster = index < 30;
  return candidate(
    index,
    inCluster ? 'c1' : `c${(index % 12) + 2}`,
    inCluster ? 'food' : ['music', 'games', 'travel', 'anime'][index % 4],
    inCluster ? 1 - (index / 400) : 0.5 - (index / (size * 4))
  );
});

/** The strongest work clusters in one category, spread over many creators. */
const categorySkewedCatalogue = (size = 160): ScoredCandidate[] => Array.from({ length: size }, (_, index) => {
  const inCluster = index < 60;
  return candidate(
    index,
    `c${(index % 16) + 1}`,
    inCluster ? 'food' : ['music', 'games', 'travel'][index % 3],
    inCluster ? 1 - (index / 400) : 0.4 - (index / (size * 4))
  );
});

/**
 * A catalogue genuinely dominated by three creators in one category — there is
 * no compliant arrangement, so this is where `unavoidable` must appear and
 * `avoidable` still must not.
 */
const dominatedCatalogue = (size = 160): ScoredCandidate[] => Array.from({ length: size }, (_, index) => candidate(
  index, `c${(index % 3) + 1}`, 'food', 1 - (index / (size * 2))
));

function services() {
  const redis: any = {
    lrange: jest.fn().mockResolvedValue([]),
    pipeline: jest.fn(() => {
      const chain: any = {
        lpush: jest.fn(() => chain), ltrim: jest.fn(() => chain), expire: jest.fn(() => chain), exec: jest.fn()
      };
      return chain;
    })
  };
  return {
    selection: new RecommendationSelectionService(redis),
    diversity: new RecommendationDiversityService()
  };
}

interface Violation {
  position: number;
  rule: string;
  chosen: string;
  windowCreators: Record<string, number>;
  windowCategories: Record<string, number>;
  remainingCount: number;
  /** A candidate still available that would not have broken any rule. */
  compliantAlternative: string | null;
  /** A candidate left in the 160-pool, never selected, that would have fitted. */
  compliantPoolCandidate: string | null;
  kind: 'avoidable' | 'unavoidable';
}

/**
 * Replays an emitted order and classifies every breach.
 *
 * The candidates still available at position `i` are exactly `order[i..]` —
 * whatever the algorithm had not yet placed — so "was there a compliant
 * alternative for this slot" is answerable from the output alone. The pool is
 * consulted separately, to catch the other failure mode: a selection step that
 * discarded a candidate the re-ranker then needed.
 */
function classify(order: ScoredCandidate[], pool: ScoredCandidate[]): Violation[] {
  const windowSize = DIVERSITY_POLICY.batchSize;
  const found: Violation[] = [];
  const emittedIds = new Set(order.map((row) => row.post._id.toString()));

  const creatorOf = (row: ScoredCandidate) => row.post.userId.toString();

  for (let index = 0; index < order.length; index += 1) {
    const window = order.slice(Math.max(0, index - (windowSize - 1)), index);
    const creators: Record<string, number> = {};
    const categories: Record<string, number> = {};
    window.forEach((row) => {
      creators[creatorOf(row)] = (creators[creatorOf(row)] || 0) + 1;
      if (row.post.topicKey) categories[row.post.topicKey] = (categories[row.post.topicKey] || 0) + 1;
    });

    const previous = index > 0 ? creatorOf(order[index - 1]) : null;
    const breaks = (row: ScoredCandidate): string | null => {
      const creator = creatorOf(row);
      if (DIVERSITY_POLICY.noConsecutiveSameCreator && creator === previous) return 'consecutive-creator';
      if ((creators[creator] || 0) >= DIVERSITY_POLICY.maxSameCreatorPerBatch) return 'creator-cap';
      if (row.post.topicKey && (categories[row.post.topicKey] || 0) >= DIVERSITY_POLICY.maxSameCategoryPerBatch) {
        return 'category-cap';
      }
      return null;
    };

    const rule = breaks(order[index]);
    if (!rule) continue;

    const remaining = order.slice(index);
    const alternative = remaining.find((row) => row !== order[index] && !breaks(row)) || null;
    const poolCandidate = pool.find(
      (row) => !emittedIds.has(row.post._id.toString()) && !breaks(row)
    ) || null;

    found.push({
      position: index,
      rule,
      chosen: order[index].post._id.toString(),
      windowCreators: creators,
      windowCategories: categories,
      remainingCount: remaining.length - 1,
      compliantAlternative: alternative ? alternative.post._id.toString() : null,
      compliantPoolCandidate: poolCandidate ? poolCandidate.post._id.toString() : null,
      kind: alternative ? 'avoidable' : 'unavoidable'
    });
  }

  return found;
}

function buildSession(
  { selection, diversity }: ReturnType<typeof services>,
  pool: ScoredCandidate[],
  sessionSeed: string,
  recentHeroIds: string[] = [],
  limit = SESSION_OUTPUT_POLICY.homeSessionItemLimit
) {
  const { candidateOrder, hero } = selection.select({ scored: pool, sessionSeed, recentHeroIds });
  const order = diversity.rerank(candidateOrder, { lead: hero, limit, preserveOrder: true });
  return { order, hero };
}

/** Renders one violation as the evidence the gate asks for. */
function describe_(violation: Violation): string {
  return `pos ${violation.position} ${violation.rule} chose ${violation.chosen}`
    + ` | window creators ${JSON.stringify(violation.windowCreators)}`
    + ` | window categories ${JSON.stringify(violation.windowCategories)}`
    + ` | ${violation.remainingCount} candidates left`
    + ` | compliant alternative: ${violation.compliantAlternative || 'none'}`
    + ` | compliant pool candidate: ${violation.compliantPoolCandidate || 'none'}`;
}

const SHAPES = [
  { name: 'even', pool: evenCatalogue() },
  { name: 'creator-skewed', pool: creatorSkewedCatalogue() },
  { name: 'category-skewed', pool: categorySkewedCatalogue() }
];

const COOLDOWNS = [
  { name: 'no cooldown', ids: () => [] as string[] },
  {
    name: 'top window on cooldown',
    ids: (pool: ScoredCandidate[]) => [...pool]
      .sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, SESSION_OUTPUT_POLICY.heroWindowSize - 2)
      .map((row) => row.post._id.toString())
  }
];

describe(`diversity of the emitted order — ${SEEDS} seeds per shape`, () => {
  SHAPES.forEach(({ name, pool }) => {
    COOLDOWNS.forEach((cooldown) => {
      it(`has zero avoidable violations across all 70 positions — ${name}, ${cooldown.name}`, () => {
        const svc = services();
        const cooled = cooldown.ids(pool);
        const avoidable: string[] = [];
        let unavoidable = 0;
        const leads = new Set<string>();

        for (let seed = 0; seed < SEEDS; seed += 1) {
          const { order, hero } = buildSession(svc, pool, `${name}-${seed}`, cooled);
          leads.add(hero!.post._id.toString());
          expect(order).toHaveLength(SESSION_OUTPUT_POLICY.homeSessionItemLimit);
          expect(order[0].post._id.toString()).toBe(hero!.post._id.toString());
          expect(new Set(order.map((row) => row.post._id.toString())).size).toBe(order.length);

          classify(order, pool).forEach((violation) => {
            if (violation.kind === 'avoidable') avoidable.push(`seed ${seed}: ${describe_(violation)}`);
            else unavoidable += 1;
          });
          if (avoidable.length > 2) break;
        }

        // eslint-disable-next-line no-console
        console.log(`  ${name}/${cooldown.name}: 0 avoidable, ${unavoidable} unavoidable over ${SEEDS} seeds, ${leads.size} distinct leads`);
        expect(avoidable).toEqual([]);
        expect(leads.size).toBeGreaterThan(1);
      });
    });
  });

  it('reports zero unavoidable violations too, whenever the catalogue offers alternatives', () => {
    const svc = services();
    const counts: Record<string, number> = {};
    SHAPES.forEach(({ name, pool }) => {
      let unavoidable = 0;
      for (let seed = 0; seed < SEEDS; seed += 1) {
        const { order } = buildSession(svc, pool, `u-${name}-${seed}`);
        unavoidable += classify(order, pool).length;
      }
      counts[name] = unavoidable;
    });
    // eslint-disable-next-line no-console
    console.log(`  violations by shape (all kinds): ${JSON.stringify(counts)}`);
    expect(counts).toEqual({ even: 0, 'creator-skewed': 0, 'category-skewed': 0 });
  });

  it('concedes only where no arrangement exists, and says so with numbers', () => {
    const svc = services();
    const pool = dominatedCatalogue();
    let avoidable = 0;
    let unavoidable = 0;

    for (let seed = 0; seed < 200; seed += 1) {
      const { order } = buildSession(svc, pool, `dom-${seed}`);
      classify(order, pool).forEach((violation) => {
        if (violation.kind === 'avoidable') avoidable += 1; else unavoidable += 1;
      });
    }

    // eslint-disable-next-line no-console
    console.log(`  three creators, one category: ${avoidable} avoidable, ${unavoidable} unavoidable over 200 seeds`);
    expect(avoidable).toBe(0);
    // A 20-post window cannot hold 20 posts from three creators at two each,
    // so a breach here is arithmetic, not a choice.
    expect(unavoidable).toBeGreaterThan(0);
  });

  it('keeps constraints running across the batch boundaries rather than resetting', () => {
    const svc = services();
    const pool = evenCatalogue();
    const straddling: string[] = [];

    for (let seed = 0; seed < 500; seed += 1) {
      const { order } = buildSession(svc, pool, `boundary-${seed}`);
      // Windows that straddle 20/21, 40/41 and 60/61 — the positions a
      // per-batch implementation would treat as a fresh start.
      [11, 31, 51].forEach((start) => {
        const window = order.slice(start, start + DIVERSITY_POLICY.batchSize);
        const perCreator = new Map<string, number>();
        window.forEach((row) => {
          const key = row.post.userId.toString();
          perCreator.set(key, (perCreator.get(key) || 0) + 1);
        });
        perCreator.forEach((count, creator) => {
          if (count > DIVERSITY_POLICY.maxSameCreatorPerBatch) {
            straddling.push(`seed ${seed} window@${start} creator ${creator}=${count}`);
          }
        });
      });
      if (straddling.length > 2) break;
    }

    expect(straddling).toEqual([]);
  });
});

describe('the lead is part of the order it is checked against', () => {
  it('counts from position 0, so position 1 cannot repeat its creator', () => {
    const svc = services();
    const pool = creatorSkewedCatalogue();
    for (let seed = 0; seed < 500; seed += 1) {
      const { order, hero } = buildSession(svc, pool, `lead-${seed}`);
      expect(order[0].post._id.toString()).toBe(hero!.post._id.toString());
      expect(order[1].post.userId.toString()).not.toBe(order[0].post.userId.toString());
    }
  });

  it('counts the lead against the opening window\'s creator budget', () => {
    const diversity = new RecommendationDiversityService();
    const creator = 'c1';
    const pool = [
      candidate(0, creator, 'food', 0.99),
      candidate(1, creator, 'food', 0.98),
      candidate(2, creator, 'food', 0.97),
      ...Array.from({ length: 40 }, (_, index) => candidate(
        index + 3, `c${index + 2}`, ['music', 'games', 'travel', 'anime', 'sports'][index % 5], 0.5
      ))
    ];

    const order = diversity.rerank(pool, { lead: pool[0], limit: 40 });
    const first = order.slice(0, DIVERSITY_POLICY.batchSize)
      .filter((row) => row.post.userId.toString() === new ObjectId(creator.padStart(24, '0')).toString());

    expect(first.length).toBeLessThanOrEqual(DIVERSITY_POLICY.maxSameCreatorPerBatch);
  });

  it('emits the lead exactly once', () => {
    const svc = services();
    const pool = evenCatalogue();
    for (let seed = 0; seed < 500; seed += 1) {
      const { order, hero } = buildSession(svc, pool, `once-${seed}`);
      const heroId = hero!.post._id.toString();
      expect(order.filter((row) => row.post._id.toString() === heroId)).toHaveLength(1);
    }
  });

  it('never leads with a post the cooldown named while another is available', () => {
    const svc = services();
    const pool = evenCatalogue();
    const cooled = [...pool].sort((a, b) => b.finalScore - a.finalScore)
      .slice(0, 5).map((row) => row.post._id.toString());

    for (let seed = 0; seed < SEEDS; seed += 1) {
      const { hero } = buildSession(svc, pool, `cool-${seed}`, cooled);
      expect(cooled).not.toContain(hero!.post._id.toString());
    }
  });

  it('always leads with a candidate from the eligible pool', () => {
    const svc = services();
    const pool = creatorSkewedCatalogue();
    const ids = new Set(pool.map((row) => row.post._id.toString()));
    for (let seed = 0; seed < 500; seed += 1) {
      const { hero } = buildSession(svc, pool, `pool-${seed}`);
      expect(ids.has(hero!.post._id.toString())).toBe(true);
    }
  });
});

describe('selection still varies between sessions', () => {
  it('draws a different set for a new seed, and the same set for the same seed', () => {
    const svc = services();
    const pool = evenCatalogue();
    const a = buildSession(svc, pool, 'vary-a').order.map((row) => row.post._id.toString());
    const again = buildSession(svc, pool, 'vary-a').order.map((row) => row.post._id.toString());
    const b = buildSession(svc, pool, 'vary-b').order.map((row) => row.post._id.toString());

    expect(again).toEqual(a);
    const shared = a.filter((id) => new Set(b).has(id)).length;
    expect(shared).toBeLessThan(a.length);
    expect(a.length - shared).toBeGreaterThanOrEqual(5);
  });

  it('still prefers strong candidates over weak ones', () => {
    const svc = services();
    const pool = evenCatalogue();
    const ordered = [...pool].sort((a, b) => b.finalScore - a.finalScore).map((row) => row.post._id.toString());
    const best = new Set(ordered.slice(0, 16));
    const worst = new Set(ordered.slice(-16));

    let bestPicks = 0;
    let worstPicks = 0;
    for (let seed = 0; seed < 200; seed += 1) {
      buildSession(svc, pool, `w-${seed}`).order.forEach((row) => {
        const id = row.post._id.toString();
        if (best.has(id)) bestPicks += 1;
        if (worst.has(id)) worstPicks += 1;
      });
    }

    expect(bestPicks).toBeGreaterThan(worstPicks);
    expect(worstPicks).toBeGreaterThan(0);
  });
});
