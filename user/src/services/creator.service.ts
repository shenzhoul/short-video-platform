import { APIRequest } from './api-request';

/**
 * Creator Service - User Frontend
 *
 * Service for creator-related operations from the user/fan perspective and creator self-management.
 * Handles creator discovery, profile viewing, subscription management, and creator dashboard functionality.
 *
 * Key Features:
 * - Creator search and discovery
 * - Creator profile management (for creators managing their own profiles)
 * - Subscription status checking
 * - File upload management (avatars, covers, welcome videos)
 * - Banking and financial settings
 * - Creator ranking and featured lists
 * - Profile analytics and view tracking
 *
 * @example Creator discovery
 * ```typescript
 * // Search creators by category
 * const creators = await creatorService.search({
 *   category: 'fitness',
 *   limit: 20,
 *   sortBy: 'popularity'
 * });
 *
 * // Get top ranked creators
 * const topCreators = await creatorService.getFeaturedCreators();
 * ```
 *
 * @example Creator self-management
 * ```typescript
 * // Update creator profile
 * await creatorService.updateMe({
 *   displayName: 'New Display Name',
 *   bio: 'Updated bio text',
 *   subscriptionPrice: 9.99
 * });
 *
 * // Get current creator info
 * const myProfile = await creatorService.me();
 * ```
 */
export class CreatorService extends APIRequest {
  /**
  * Get public creator profile by ID or username
  * @param id Creator ID or username
  * @param headers Optional request headers
  * @returns Promise resolving to public creator profile
  */
  findOne = (id: string, headers?: { [key: string]: string }) => this.get(`/users/${encodeURIComponent(id)}`, headers);

  updateCover = (coverId: string) => this.put('/users/cover', { coverId });

  /**
 * Update creator's own profile information
 * @param payload Profile update data
 * @returns Promise resolving to updated profile data
 */
  updateMe = (payload: any) => this.put('/users/manager', payload);
}

export const creatorService = new CreatorService();

// Create individual function exports for better tree shaking
const creatorServiceInstance = new CreatorService();

export const findCreatorByUsername = (id: string, headers?: { [key: string]: string }) => creatorServiceInstance.findOne(id, headers);
export const updateCover = (coverId: string) => creatorServiceInstance.updateCover(coverId);
export const updateCurrentCreator = (payload: any) => creatorServiceInstance.updateMe(payload);
