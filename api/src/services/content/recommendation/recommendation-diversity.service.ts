import { Injectable } from '@nestjs/common';
import { DIVERSITY_POLICY, RecommendationSource } from 'src/common/constants/recommendation';
import { ScoredCandidate } from './recommendation-scoring.service';

/** How many of the next-best candidates the re-ranker is willing to look past to satisfy a constraint. */
const LOOKAHEAD_WINDOW = 15;
/** Soft cap on consecutive picks from the same source bucket, so trending/fresh never fully segregate. */
const MAX_CONSECUTIVE_SAME_SOURCE = 4;

/**
 * Greedy, deterministic re-ranker.
 *
 * Sorted-by-score order is the starting point; this only ever *reorders*
 * within a bounded lookahead to satisfy creator/category/source spread, and
 * falls back to "just take the next-best" the moment no candidate in the
 * window satisfies every constraint — so a small or homogeneous pool can never
 * get the ranker stuck or drop a candidate outright
 *
 * Deterministic for a fixed input list: no `Math.random`, and every tie in
 * `finalScore` was already broken upstream by the seeded session jitter, so
 * the same session/input reranks identically every time it is recomputed
 */
export interface RerankOptions {
  /**
   * A candidate that must occupy position 0.
   *
   * Passed *into* the re-ranker rather than spliced in afterwards. Inserting it
   * afterwards is what makes the constraint checks meaningless: the lead is
   * chosen from the top-scoring window, which is exactly where a heavily
   * represented creator or category concentrates, so the finished list could
   * open with two posts from the same creator, or start a 20-post window
   * already one over its creator cap, and the diversity pass would have
   * certified an order that was then changed underneath it.
   *
   * Given here, the lead is emitted first and its creator, category and source
   * are counted before anything else is chosen — so every rule that applies to
   * position 1 onward is evaluated against a window that already contains it.
   */
  lead?: ScoredCandidate | null;
  /**
   * Stop after this many items.
   *
   * Given together with a candidate order longer than the limit, this turns
   * re-ranking into the session *selection* step: the walk takes the best
   * candidate that fits and defers the ones that do not, so a constraint is
   * only ever conceded when nothing in the whole remaining pool satisfies it.
   *
   * Selecting first and re-ranking afterwards could not do that. A sample drawn
   * on score alone is blind to authorship, so a catalogue where one creator owns
   * the strongest work produced a session already over its creator budget — and
   * no re-ordering fixes a composition problem. Measured on such a pool: the
   * emitted order breached the two-per-batch cap inside the first two batches
   * while 130 posts from twelve other creators sat unselected.
   */
  limit?: number;
  /**
   * Emit in the order given rather than by score.
   *
   * The caller's order is the seeded weighted draw that makes each session a
   * different selection; re-sorting by score here would throw that away and
   * hand back the same ranking every time.
   */
  preserveOrder?: boolean;
}

@Injectable()
export class RecommendationDiversityService {
  public rerank(scored: ScoredCandidate[], options: RerankOptions = {}): ScoredCandidate[] {
    const leadId = options.lead ? options.lead.post._id.toString() : null;
    const withoutLead = [...scored].filter((candidate) => candidate.post._id.toString() !== leadId);
    const remaining = options.preserveOrder
      ? withoutLead
      : withoutLead.sort((a, b) => b.finalScore - a.finalScore
        || a.post._id.toString().localeCompare(b.post._id.toString()));
    const limit = options.limit ?? Number.POSITIVE_INFINITY;

    const output: ScoredCandidate[] = [];
    const creatorCountInWindow = new Map<string, number>();
    const categoryCountInWindow = new Map<string, number>();
    let consecutiveSameSource = 0;
    let lastSource: RecommendationSource | null = null;

    const windowSize = DIVERSITY_POLICY.batchSize;

    const decrementWindowCounts = () => {
      if (output.length < windowSize) return;
      const dropped = output[output.length - windowSize];
      const creatorKey = dropped.post.userId.toString();
      creatorCountInWindow.set(creatorKey, (creatorCountInWindow.get(creatorKey) || 1) - 1);
      if (dropped.post.topicKey) {
        const catKey = dropped.post.topicKey;
        categoryCountInWindow.set(catKey, (categoryCountInWindow.get(catKey) || 1) - 1);
      }
    };

    const satisfies = (candidate: ScoredCandidate): boolean => {
      const creatorKey = candidate.post.userId.toString();
      const lastCreator = output.length ? output[output.length - 1].post.userId.toString() : null;

      if (DIVERSITY_POLICY.noConsecutiveSameCreator && lastCreator === creatorKey) return false;
      if ((creatorCountInWindow.get(creatorKey) || 0) >= DIVERSITY_POLICY.maxSameCreatorPerBatch) return false;

      if (candidate.post.topicKey) {
        const catCount = categoryCountInWindow.get(candidate.post.topicKey) || 0;
        if (catCount >= DIVERSITY_POLICY.maxSameCategoryPerBatch) return false;
      }

      if (candidate.source === lastSource && consecutiveSameSource >= MAX_CONSECUTIVE_SAME_SOURCE) return false;

      return true;
    };

    const commit = (index: number) => {
      const [candidate] = remaining.splice(index, 1);
      decrementWindowCounts();

      const creatorKey = candidate.post.userId.toString();
      creatorCountInWindow.set(creatorKey, (creatorCountInWindow.get(creatorKey) || 0) + 1);
      if (candidate.post.topicKey) {
        const catKey = candidate.post.topicKey;
        categoryCountInWindow.set(catKey, (categoryCountInWindow.get(catKey) || 0) + 1);
      }

      consecutiveSameSource = candidate.source === lastSource ? consecutiveSameSource + 1 : 1;
      lastSource = candidate.source;

      output.push(candidate);
    };

    // Seed the window with the lead so every later pick is judged against a
    // list that already contains it.
    if (options.lead) {
      const creatorKey = options.lead.post.userId.toString();
      creatorCountInWindow.set(creatorKey, 1);
      if (options.lead.post.topicKey) categoryCountInWindow.set(options.lead.post.topicKey, 1);
      consecutiveSameSource = 1;
      lastSource = options.lead.source;
      output.push(options.lead);
    }

    while (remaining.length && output.length < limit) {
      // Prefer a pick from the near-best-scoring lookahead window first — it
      // is the common case and keeps the result close to pure score order.
      // Only when *nothing* in that window qualifies (a long run of one
      // disqualified creator/category can exceed the window's width) does
      // this fall back to scanning the *entire* remaining list: a violation
      // several hundred candidates back in score order is still a violation,
      // and giving up after 15 candidates was exactly what let a spammy
      // creator flood a whole batch. Only when nothing anywhere in the
      // remaining pool can satisfy the constraints (e.g. every remaining
      // candidate shares the one creator already at the tail) does this fall
      // back to the next-best score regardless — guaranteeing no candidate is
      // ever dropped.
      const windowWidth = Math.min(LOOKAHEAD_WINDOW, remaining.length);
      let pickIndex = remaining.slice(0, windowWidth).findIndex((candidate) => satisfies(candidate));
      if (pickIndex < 0) pickIndex = remaining.findIndex((candidate) => satisfies(candidate));
      commit(pickIndex >= 0 ? pickIndex : 0);
    }

    return output;
  }
}
