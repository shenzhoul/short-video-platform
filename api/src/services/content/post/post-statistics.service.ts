import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { ObjectId } from "mongodb";
import { Model } from "mongoose";
import { EntityNotFoundException } from "src/kernel";
import { toObjectId } from "src/kernel/helpers/string.helper";
import { Post, PostDocument } from "src/schemas";

/**
 * PostStatisticsService
 *
 * Handles statistics and counting operations for posts including:
 * - Comment statistics management
 * - Post counting by creator
 * - Like/reaction statistics
 * - View statistics
 * - Performance metrics
 *
 * This service focuses on numerical data and analytics
 * without complex business logic or data population.
 */
@Injectable()
export class PostStatisticsService {
  constructor(
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>
  ) { }
  /**
  * Update like statistics for a post
  *
  * Increments or decrements the total like count for a specific post.
  * Used when likes are added or removed from a post.
  *
  * @param postId - ID of the post to update
  * @param num - Number to increment/decrement (default: 1, use negative for decrement)
  * @returns Promise resolving when update is complete
  * @example
  * ```typescript
  * // Add a like
  * await postStatisticsService.handleLikeStat(postId, 1);
  *
  * // Remove a like
  * await postStatisticsService.handleLikeStat(postId, -1);
  * ```
  */
  public async handleLikeStat(postId: string, num = 1): Promise<void> {
    await this.PostModel.updateOne(
      { _id: postId },
      [
        {
          $set: {
            totalLike: {
              $max: [0, { $add: [{ $ifNull: ['$totalLike', 0] }, num] }]
            }
          }
        }
      ],
      { upsert: false }
    );
  }

  /**
   * Update share statistics for a post
   *
   * Share reactions are created once per user and are never removed, so this is
   * only ever called with a positive increment and the stored value is a count
   * of distinct sharers. `$max` against 0 mirrors the like counter and keeps a
   * document written before this field existed from going negative.
   *
   * @param postId - ID of the post to update
   * @param num - Number to increment by (default: 1)
   */
  public async handleShareStat(postId: string | ObjectId, num = 1): Promise<void> {
    await this.PostModel.updateOne(
      { _id: postId },
      [
        {
          $set: {
            totalShare: {
              $max: [0, { $add: [{ $ifNull: ['$totalShare', 0] }, num] }]
            }
          }
        }
      ],
      { upsert: false }
    );
  }

  /**
   * Increment a post view counter and return the authoritative total.
   */
  public async handleViewStat(
    postId: string,
    num = 1,
    viewerId?: string | ObjectId
  ): Promise<number> {
    if (!ObjectId.isValid(postId)) throw new EntityNotFoundException();

    const currentTotal = { $ifNull: ['$totalView', 0] };
    const incrementedTotal = {
      $max: [0, { $add: [currentTotal, num] }]
    };
    const viewerObjectId = viewerId && ObjectId.isValid(viewerId.toString())
      ? toObjectId(viewerId)
      : null;

    const post = await this.PostModel.findOneAndUpdate(
      { _id: postId, status: 'active' },
      [
        {
          $set: {
            totalView: viewerObjectId
              ? {
                $cond: [
                  { $eq: ['$userId', viewerObjectId] },
                  currentTotal,
                  incrementedTotal
                ]
              }
              : incrementedTotal
          }
        }
      ],
      { new: true, projection: { totalView: 1 } }
    );

    if (!post) throw new EntityNotFoundException();
    return Math.max(0, Number(post.totalView) || 0);
  }

  /**
   * Return the authoritative like total for all posts still owned by a creator.
   */
  public async getCreatorTotalLikes(creatorId: string | ObjectId): Promise<number> {
    const [result] = await this.PostModel.aggregate<{ total: number }>([
      { $match: { userId: toObjectId(creatorId) } },
      {
        $group: {
          _id: null,
          total: { $sum: { $ifNull: ['$totalLike', 0] } }
        }
      }
    ]);

    return Math.max(0, result?.total || 0);
  }
}
