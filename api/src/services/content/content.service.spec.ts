import { ObjectId } from 'mongodb';

import { ContentService } from './content.service';

describe('ContentService liked posts', () => {
  it('returns populated posts in newest-like-first reaction order', async () => {
    const userId = new ObjectId();
    const olderPostId = new ObjectId();
    const newerPostId = new ObjectId();
    const postService = {
      findByIds: jest.fn().mockResolvedValue([
        { _id: olderPostId, text: 'Older' },
        { _id: newerPostId, text: 'Newer' }
      ])
    };
    const reactionService = {
      search: jest.fn().mockResolvedValue({
        data: [
          { objectId: newerPostId },
          { objectId: olderPostId }
        ],
        total: 2,
        hasMore: false,
        nextCursor: null
      })
    };
    const service = new ContentService(
      postService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      reactionService as any,
      {} as any
    );
    jest.spyOn(service, 'populatePostData').mockImplementation(async (posts) => posts as any);
    const query: any = { limit: 12 };

    await expect(service.getLikedPosts(query, { _id: userId } as any)).resolves.toMatchObject({
      total: 2,
      data: [
        { _id: newerPostId, text: 'Newer' },
        { _id: olderPostId, text: 'Older' }
      ]
    });

    expect(query).toMatchObject({
      createdBy: userId,
      action: 'like',
      objectType: 'post'
    });
  });
});
