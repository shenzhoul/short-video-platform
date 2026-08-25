import { ObjectId } from 'mongodb';
import { COMMENT_ROOM } from 'src/common/constants/community';

import { CommentRoomService } from './comment-room.service';

/**
 * Who is allowed into a thread room.
 *
 * A thread is only as private as the post holding it, so the interesting cases
 * are the ones where a client names an id the server must refuse — a socket can
 * emit `comment/join` with anything at all.
 */
function createSubject(options: { comments?: any[]; canView?: boolean } = {}) {
  const comments = options.comments || [];
  const CommentModel = {
    findOne: jest.fn((filter: any) => ({
      select: () => ({
        lean: async () => comments.find((c) => c._id.toString() === filter._id.toString()) || null
      })
    }))
  };
  const postRoomService = { canView: jest.fn().mockResolvedValue(options.canView !== false) };
  const socketUserService = { joinRoom: jest.fn().mockResolvedValue(undefined) };

  const service = new CommentRoomService(
    CommentModel as any,
    postRoomService as any,
    socketUserService as any
  );

  return {
    service, postRoomService, socketUserService, CommentModel
  };
}

const socket = () => ({ leave: jest.fn().mockResolvedValue(undefined) }) as any;

describe('CommentRoomService', () => {
  const postId = new ObjectId();
  const topLevelId = new ObjectId();
  const topLevel = { _id: topLevelId, objectId: postId, objectType: 'post' };

  it('admits a socket to a thread on a post it may see', async () => {
    const { service, socketUserService } = createSubject({ comments: [topLevel] });
    const client = socket();

    await expect(service.join(client, topLevelId.toString())).resolves.toBe(true);
    expect(socketUserService.joinRoom).toHaveBeenCalledWith(client, COMMENT_ROOM.name(topLevelId.toString()));
  });

  it('refuses a thread on a post the viewer may not see', async () => {
    // The check that stops a thread room becoming a way around post visibility.
    const { service, socketUserService } = createSubject({ comments: [topLevel], canView: false });

    await expect(service.join(socket(), topLevelId.toString())).resolves.toBe(false);
    expect(socketUserService.joinRoom).not.toHaveBeenCalled();
  });

  it('refuses a comment that does not exist', async () => {
    const { service, socketUserService } = createSubject({ comments: [] });

    await expect(service.join(socket(), new ObjectId().toString())).resolves.toBe(false);
    expect(socketUserService.joinRoom).not.toHaveBeenCalled();
  });

  it('refuses an id that is not an id, without touching the database', async () => {
    const { service, CommentModel, socketUserService } = createSubject();

    await expect(service.join(socket(), 'not-an-object-id')).resolves.toBe(false);
    expect(CommentModel.findOne).not.toHaveBeenCalled();
    expect(socketUserService.joinRoom).not.toHaveBeenCalled();
  });

  it('resolves a reply through its parent to the post', async () => {
    const replyId = new ObjectId();
    const { service, postRoomService } = createSubject({
      comments: [topLevel, { _id: replyId, objectId: topLevelId, objectType: 'comment' }]
    });

    await expect(service.join(socket(), replyId.toString())).resolves.toBe(true);
    expect(postRoomService.canView).toHaveBeenCalledWith(postId.toString());
  });

  it('refuses a reply whose parent has gone', async () => {
    const orphan = new ObjectId();
    const { service } = createSubject({
      comments: [{ _id: orphan, objectId: new ObjectId(), objectType: 'comment' }]
    });

    await expect(service.join(socket(), orphan.toString())).resolves.toBe(false);
  });

  it('lets a socket leave without any check at all', async () => {
    // Refusing to let somebody leave would be the actual bug.
    const { service, postRoomService } = createSubject({ canView: false });
    const client = socket();

    await service.leave(client, topLevelId.toString());

    expect(client.leave).toHaveBeenCalledWith(COMMENT_ROOM.name(topLevelId.toString()));
    expect(postRoomService.canView).not.toHaveBeenCalled();
  });
});
