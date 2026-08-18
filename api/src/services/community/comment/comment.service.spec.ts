import { ObjectId } from 'mongodb';

import { CommentService } from './comment.service';

describe('CommentService deleteCommentsByContent', () => {
  function createSubject(directIds: ObjectId[], replyIds: ObjectId[] = []) {
    const commentModel = {
      find: jest.fn()
        .mockReturnValueOnce({ distinct: jest.fn().mockResolvedValue(directIds) })
        .mockReturnValueOnce({ distinct: jest.fn().mockResolvedValue(replyIds) }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: directIds.length + replyIds.length })
    };
    const reactionService = {
      deleteReactionsByTargets: jest.fn().mockResolvedValue(directIds.length + replyIds.length)
    };
    const service = new CommentService(
      commentModel as any,
      { publish: jest.fn() } as any,
      {} as any,
      reactionService as any
    );

    return { service, commentModel, reactionService };
  }

  it('returns without querying replies when content has no comments', async () => {
    const { service, commentModel, reactionService } = createSubject([]);

    await expect(service.deleteCommentsByContent('post', new ObjectId())).resolves.toBe(0);

    expect(commentModel.find).toHaveBeenCalledTimes(1);
    expect(reactionService.deleteReactionsByTargets).not.toHaveBeenCalled();
    expect(commentModel.deleteMany).not.toHaveBeenCalled();
  });

  it('removes reactions before deleting the complete comment thread batch', async () => {
    const directId = new ObjectId();
    const replyId = new ObjectId();
    const { service, commentModel, reactionService } = createSubject([directId], [replyId]);

    await expect(service.deleteCommentsByContent('post', new ObjectId())).resolves.toBe(2);

    expect(reactionService.deleteReactionsByTargets).toHaveBeenCalledWith(
      'comment',
      [directId, replyId]
    );
    expect(commentModel.deleteMany).toHaveBeenCalledWith({
      _id: { $in: [directId, replyId] }
    });
    expect(
      reactionService.deleteReactionsByTargets.mock.invocationCallOrder[0]
    ).toBeLessThan(commentModel.deleteMany.mock.invocationCallOrder[0]);
  });
});
