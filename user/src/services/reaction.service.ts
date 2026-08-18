import { APIRequest } from './api-request';

/**
 * Reaction Service
 *
 * Handles content-specific reactions (like, dislike, etc.).
 * For user collections, use CollectionsService instead.
 */
export class ReactionService extends APIRequest {
  /**
   * Toggle a reaction on specific content (smart add/remove)
   * POST /api/social/{contentType}/{contentId}/reactions/toggle
   */
  toggle(contentType: string, contentId: string, payload: any) {
    return this.post(`/social/${contentType}/${contentId}/reactions/toggle`, payload);
  }

  /**
   * Record that the current user shared this content
   * POST /api/social/{contentType}/{contentId}/share
   *
   * Sharing itself is a client-side link copy or native share; this only tells
   * the backend it happened so the owner can be notified. Idempotent server-side.
   */
  share(contentType: string, contentId: string) {
    return this.post(`/social/${contentType}/${contentId}/share`, {});
  }
}

// === TREE SHAKING EXPORTS ===
const reactionServiceInstance = new ReactionService();

export const reactionService = new ReactionService();

export const toggleReaction = (contentType: string, contentId: string, payload: any) =>
  reactionServiceInstance.toggle(contentType, contentId, payload);

export const recordShare = (contentType: string, contentId: string) =>
  reactionServiceInstance.share(contentType, contentId);
