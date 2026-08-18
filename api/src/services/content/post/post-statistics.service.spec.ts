import { EntityNotFoundException } from 'src/kernel';
import { ObjectId } from 'mongodb';

import { PostStatisticsService } from './post-statistics.service';

describe('PostStatisticsService', () => {
  describe('handleViewStat', () => {
    it('increments the persisted view count and returns the authoritative total', async () => {
      const postModel = {
        findOneAndUpdate: jest.fn().mockResolvedValue({ totalView: 8 })
      };
      const service = new PostStatisticsService(postModel as any);

      const postId = new ObjectId().toString();
      await expect(service.handleViewStat(postId)).resolves.toBe(8);
      expect(postModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: postId, status: 'active' },
        [{
          $set: {
            totalView: {
              $max: [0, { $add: [{ $ifNull: ['$totalView', 0] }, 1] }]
            }
          }
        }],
        { new: true, projection: { totalView: 1 } }
      );
    });

    it('rejects view updates for missing or inactive posts', async () => {
      const postModel = {
        findOneAndUpdate: jest.fn().mockResolvedValue(null)
      };
      const service = new PostStatisticsService(postModel as any);

      const postId = new ObjectId().toString();
      await expect(service.handleViewStat(postId)).rejects.toBeInstanceOf(EntityNotFoundException);
    });

    it('returns the current total without incrementing when the viewer owns the post', async () => {
      const postModel = {
        findOneAndUpdate: jest.fn().mockResolvedValue({ totalView: 8 })
      };
      const service = new PostStatisticsService(postModel as any);
      const postId = new ObjectId().toString();
      const ownerId = new ObjectId();

      await expect(service.handleViewStat(postId, 1, ownerId)).resolves.toBe(8);

      const updatePipeline = postModel.findOneAndUpdate.mock.calls[0][1];
      const condition = updatePipeline[0].$set.totalView.$cond;
      expect(condition[0].$eq[0]).toBe('$userId');
      expect(condition[0].$eq[1].toString()).toBe(ownerId.toString());
      expect(condition[1]).toEqual({ $ifNull: ['$totalView', 0] });
      expect(condition[2]).toEqual({
        $max: [0, { $add: [{ $ifNull: ['$totalView', 0] }, 1] }]
      });
    });

    it('rejects malformed post ids before querying MongoDB', async () => {
      const postModel = { findOneAndUpdate: jest.fn() };
      const service = new PostStatisticsService(postModel as any);

      await expect(service.handleViewStat('not-an-object-id')).rejects.toBeInstanceOf(EntityNotFoundException);
      expect(postModel.findOneAndUpdate).not.toHaveBeenCalled();
    });
  });
});
