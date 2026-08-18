import { ObjectId } from 'mongodb';

import { PostDeletionCleanupService } from './post-deletion-cleanup.service';

/**
 * Guards the wiring rather than the query: the cascade only works if post
 * deletion actually reaches NotificationService, and that is exactly the link a
 * future refactor of the cleanup phases could drop without any test noticing.
 */
function createSubject() {
  const postModel = { deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }) };
  const commentService = { deleteCommentsByContent: jest.fn().mockResolvedValue(0) };
  const reactionService = { deleteReactionsByContent: jest.fn().mockResolvedValue(0) };
  const notificationService = { deleteByPostId: jest.fn().mockResolvedValue({ deleted: 4 }) };
  const postMediaService = { deletePostMediaByPostId: jest.fn().mockResolvedValue(0) };
  const postStatisticsService = { getCreatorTotalLikes: jest.fn().mockResolvedValue(0) };
  const tagStatisticsService = { reconcileTagStatistics: jest.fn().mockResolvedValue(undefined) };
  const userService = { setLikeStat: jest.fn().mockResolvedValue(undefined) };
  const fileServerService = { deleteManyByIds: jest.fn().mockResolvedValue({ errors: [] }) };

  const service = new PostDeletionCleanupService(
    postModel as any,
    commentService as any,
    reactionService as any,
    notificationService as any,
    postMediaService as any,
    postStatisticsService as any,
    tagStatisticsService as any,
    userService as any,
    fileServerService as any
  );

  return {
    service, notificationService, commentService, reactionService, fileServerService
  };
}

describe('PostDeletionCleanupService notification cascade', () => {
  it('removes the post\'s notifications as part of deletion', async () => {
    const postId = new ObjectId();
    const { service, notificationService } = createSubject();

    await service.cleanup({ _id: postId, userId: new ObjectId() });

    expect(notificationService.deleteByPostId).toHaveBeenCalledTimes(1);
    expect(notificationService.deleteByPostId.mock.calls[0][0].toString())
      .toBe(postId.toString());
  });

  it('cleans notifications alongside the other dependants, not instead of them', async () => {
    const { service, notificationService, commentService, reactionService } = createSubject();

    await service.cleanup({ _id: new ObjectId(), userId: new ObjectId() });

    expect(commentService.deleteCommentsByContent).toHaveBeenCalled();
    expect(reactionService.deleteReactionsByContent).toHaveBeenCalled();
    expect(notificationService.deleteByPostId).toHaveBeenCalled();
  });

  it('still cascades when the post has no files to remove', async () => {
    const { service, notificationService, fileServerService } = createSubject();

    await service.cleanup({ _id: new ObjectId(), userId: new ObjectId(), fileIds: [] });

    expect(notificationService.deleteByPostId).toHaveBeenCalled();
    expect(fileServerService.deleteManyByIds).not.toHaveBeenCalled();
  });

  it('runs the cascade again when a retry re-delivers the event', async () => {
    const postId = new ObjectId();
    const { service, notificationService } = createSubject();
    const snapshot = { _id: postId, userId: new ObjectId() };

    await service.cleanup(snapshot);
    await service.cleanup(snapshot);

    // deleteMany is idempotent, so a retry converging on the same state is the
    // intended behaviour rather than something to guard against.
    expect(notificationService.deleteByPostId).toHaveBeenCalledTimes(2);
  });
});
