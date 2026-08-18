import { ObjectId } from 'mongodb';

import { TagStatisticsService } from './tag-statistics.service';

describe('TagStatisticsService', () => {
  it('normalizes duplicate tags and replaces the summary with aggregate values', async () => {
    const firstUsageDate = new Date('2026-01-01T00:00:00.000Z');
    const lastUsageDate = new Date('2026-02-01T00:00:00.000Z');
    const postModel = {
      aggregate: jest.fn().mockResolvedValue([{
        totalUsage: 2,
        totalLikes: 9,
        uniqueUsers: [new ObjectId(), new ObjectId()],
        firstUsageDate,
        lastUsageDate
      }])
    };
    const tagSummaryModel = {
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      deleteOne: jest.fn()
    };
    const service = new TagStatisticsService(tagSummaryModel as any, postModel as any);

    await service.reconcileTagStatistics([' Travel ', 'travel', '']);

    expect(postModel.aggregate).toHaveBeenCalledTimes(1);
    expect(postModel.aggregate).toHaveBeenCalledWith([
      { $match: { tags: 'travel' } },
      expect.any(Object)
    ]);
    expect(tagSummaryModel.updateOne).toHaveBeenCalledWith(
      { tag: 'travel' },
      expect.objectContaining({
        $set: expect.objectContaining({
          postStats: {
            totalUsage: 2,
            uniqueUsers: 2,
            totalViews: 0,
            totalLikes: 9
          },
          grandTotalUsage: 2,
          grandTotalUniqueUsers: 2,
          grandTotalLikes: 9,
          firstUsageDate,
          lastUsageDate
        })
      }),
      { upsert: true }
    );
    expect(tagSummaryModel.deleteOne).not.toHaveBeenCalled();
  });

  it('deletes a summary when no surviving post uses the tag', async () => {
    const postModel = {
      aggregate: jest.fn().mockResolvedValue([])
    };
    const tagSummaryModel = {
      updateOne: jest.fn(),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 })
    };
    const service = new TagStatisticsService(tagSummaryModel as any, postModel as any);

    await service.reconcileTagStatistics(['unused']);

    expect(tagSummaryModel.deleteOne).toHaveBeenCalledWith({ tag: 'unused' });
    expect(tagSummaryModel.updateOne).not.toHaveBeenCalled();
  });
});
