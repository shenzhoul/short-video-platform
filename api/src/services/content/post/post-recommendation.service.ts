import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { STATUS } from 'src/kernel/constants';
import { PostRecommendationRequest } from 'src/payloads';
import { Post, PostDocument } from 'src/schemas';

const RECOMMENDATION_WEIGHTS = {
  like: 3,
  comment: 5,
  recencyDivisor: 86_400_000
} as const;

@Injectable()
export class PostRecommendationService {
  constructor(
    @InjectModel(Post.name) private readonly postModel: Model<PostDocument>
  ) { }

  async recommend(request: PostRecommendationRequest, userId?: string | ObjectId) {
    if (Boolean(request.cursor) !== (request.score !== undefined)) {
      throw new BadRequestException('Recommendation cursor and score must be provided together');
    }

    const limit = Number(request.limit) || 10;
    const baseMatch: Record<string, any> = {
      status: STATUS.ACTIVE,
      isCreatorDeleted: { $ne: true },
      $or: [{ type: 'video' }, { mediaTypes: 'video' }]
    };

    if (userId) baseMatch.userId = { $ne: new ObjectId(userId.toString()) };

    const pipeline: any[] = [
      { $match: baseMatch },
      {
        $addFields: {
          _recommendationScore: {
            $add: [
              { $multiply: [{ $ifNull: ['$totalLike', 0] }, RECOMMENDATION_WEIGHTS.like] },
              { $multiply: [{ $ifNull: ['$totalComment', 0] }, RECOMMENDATION_WEIGHTS.comment] },
              { $divide: [{ $toLong: '$createdAt' }, RECOMMENDATION_WEIGHTS.recencyDivisor] }
            ]
          }
        }
      }
    ];

    if (request.cursor && Number.isFinite(request.score)) {
      pipeline.push({
        $match: {
          $or: [
            { _recommendationScore: { $lt: request.score } },
            {
              _recommendationScore: request.score,
              _id: { $lt: new ObjectId(request.cursor) }
            }
          ]
        }
      });
    }

    pipeline.push(
      { $sort: { _recommendationScore: -1, _id: -1 } },
      { $limit: limit + 1 }
    );

    const results = await this.postModel.aggregate(pipeline);
    const hasMore = results.length > limit;
    const items = hasMore ? results.slice(0, limit) : results;
    const lastItem = items[items.length - 1];

    return {
      data: items,
      hasMore,
      nextCursor: hasMore && lastItem ? {
        id: lastItem._id.toString(),
        score: lastItem._recommendationScore
      } : null,
      paginationInfo: {
        cursorPaginationAvailable: true,
        strategy: 'engagement-recency-v1'
      }
    };
  }
}
