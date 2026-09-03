import { ObjectId } from 'mongodb';
import { STATUS } from 'src/kernel/constants';

/**
 * Shared eligibility inputs, gathered once per feed/detail session request and
 * threaded through every candidate source so no source can independently
 * decide what counts as "eligible"
 */
export interface RecommendationEligibilityContext {
  /** The viewer, when authenticated. Excluded from their own recommendations. */
  viewerId?: string;
  /** Users blocked in either direction with the viewer — see UserRelationshipService.getBlockedEitherDirectionIds. */
  excludedCreatorIds: string[];
  /** Post ids already served in this session (or recently seen), suppressed unless a retry policy says otherwise. */
  excludedPostIds: string[];
}

/**
 * The base Mongo match every recommendation candidate query starts from.
 *
 * Deliberately identical in shape to `PostSearchService.userSearchPosts`'s own
 * base query (`status: ACTIVE, isCreatorDeleted: { $ne: true }`) — that is the
 * audited, already-enforced definition of "publicly visible" in this codebase.
 * No separate "media processed" gate exists to reuse or reinvent: a post is
 * only ever created with `status: active` after its attachments are set up by
 * the existing publish flow (see PostCrudService), so this is not a gap this
 * task introduces or needs to close.
 *
 * Pinned is intentionally absent — pinning is a creator-profile-only signal,
 * never a recommendation input (rules/instructions §2.1, §5).
 */
export function buildEligibilityMatch(context: RecommendationEligibilityContext): Record<string, any> {
  const match: Record<string, any> = {
    status: STATUS.ACTIVE,
    isCreatorDeleted: { $ne: true }
  };

  const andClauses: Record<string, any>[] = [];

  if (context.viewerId) {
    andClauses.push({ userId: { $ne: new ObjectId(context.viewerId) } });
  }

  if (context.excludedCreatorIds.length) {
    andClauses.push({ userId: { $nin: context.excludedCreatorIds.map((id) => new ObjectId(id)) } });
  }

  if (context.excludedPostIds.length) {
    andClauses.push({ _id: { $nin: context.excludedPostIds.map((id) => new ObjectId(id)) } });
  }

  if (andClauses.length) {
    match.$and = andClauses;
  }

  return match;
}
