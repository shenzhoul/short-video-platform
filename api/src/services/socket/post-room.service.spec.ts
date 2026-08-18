import { ObjectId } from 'mongodb';
import { POST_ROOM } from 'src/common/constants/community';

import { PostRoomService } from './post-room.service';

/**
 * Room admission and cross-instance emission.
 *
 * The emission tests matter more than they look: `adapter.rooms` is a local
 * in-process Map, so any membership shortcut here would silently drop events for
 * viewers connected to a different API instance.
 */
function createSubject(options: { post?: any; canView?: boolean } = {}) {
  const PostModel = {
    findOne: jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue('post' in options ? options.post : { _id: new ObjectId(), status: 'active' })
      })
    })
  };
  const contentPermissionService = {
    canView: jest.fn().mockResolvedValue(options.canView ?? true)
  };
  const socketUserService = {
    joinRoom: jest.fn().mockResolvedValue(undefined),
    emitToRoom: jest.fn().mockResolvedValue(undefined)
  };

  const service = new PostRoomService(
    PostModel as any,
    contentPermissionService as any,
    socketUserService as any
  );

  const socket = { join: jest.fn(), leave: jest.fn().mockResolvedValue(undefined) };

  return {
    service, socket, socketUserService, contentPermissionService, PostModel
  };
}

const postId = new ObjectId().toString();

describe('post room admission', () => {
  it('admits a socket to the post room', async () => {
    const { service, socket, socketUserService } = createSubject();

    await expect(service.join(socket as any, postId)).resolves.toBe(true);
    expect(socketUserService.joinRoom).toHaveBeenCalledWith(socket, `post:${postId}`);
  });

  it('uses the shared room naming convention', async () => {
    const { service, socket, socketUserService } = createSubject();
    await service.join(socket as any, postId);

    expect(socketUserService.joinRoom.mock.calls[0][1]).toBe(POST_ROOM.name(postId));
  });

  it('refuses a post that does not exist', async () => {
    const { service, socket, socketUserService } = createSubject({ post: null });

    await expect(service.join(socket as any, postId)).resolves.toBe(false);
    expect(socketUserService.joinRoom).not.toHaveBeenCalled();
  });

  it('refuses a deleted post', async () => {
    const { service, socket, socketUserService } = createSubject({
      post: { _id: new ObjectId(), status: 'deleted' }
    });

    await expect(service.join(socket as any, postId)).resolves.toBe(false);
    expect(socketUserService.joinRoom).not.toHaveBeenCalled();
  });

  it('refuses a malformed id without touching the database', async () => {
    const { service, socket, PostModel, socketUserService } = createSubject();

    await expect(service.join(socket as any, 'not-an-object-id')).resolves.toBe(false);
    expect(PostModel.findOne).not.toHaveBeenCalled();
    expect(socketUserService.joinRoom).not.toHaveBeenCalled();
  });

  it('refuses when the shared view permission says no', async () => {
    const { service, socket, socketUserService } = createSubject({ canView: false });

    // A client can emit post/join with any id, so opening the modal in the
    // browser proves nothing — the server decides.
    await expect(service.join(socket as any, postId)).resolves.toBe(false);
    expect(socketUserService.joinRoom).not.toHaveBeenCalled();
  });

  it('asks the existing permission service rather than its own rule', async () => {
    const { service, socket, contentPermissionService } = createSubject();
    await service.join(socket as any, postId);

    expect(contentPermissionService.canView).toHaveBeenCalledWith(postId);
  });
});

describe('post room departure', () => {
  it('leaves the room for that post', async () => {
    const { service, socket } = createSubject();

    await service.leave(socket as any, postId);

    expect(socket.leave).toHaveBeenCalledWith(`post:${postId}`);
  });

  it('never blocks leaving on permission or existence', async () => {
    const { service, socket, contentPermissionService, PostModel } = createSubject({
      post: null, canView: false
    });

    await service.leave(socket as any, postId);

    // Refusing to let a socket leave would be the actual bug.
    expect(socket.leave).toHaveBeenCalled();
    expect(contentPermissionService.canView).not.toHaveBeenCalled();
    expect(PostModel.findOne).not.toHaveBeenCalled();
  });

  it('ignores an empty id', async () => {
    const { service, socket } = createSubject();
    await service.leave(socket as any, '');
    expect(socket.leave).not.toHaveBeenCalled();
  });
});

describe('post room emission', () => {
  it('emits to the post room by name', async () => {
    const { service, socketUserService } = createSubject();

    await service.emit(postId, 'post:comment_created', { postId });

    expect(socketUserService.emitToRoom)
      .toHaveBeenCalledWith(`post:${postId}`, 'post:comment_created', { postId });
  });

  it('emits unconditionally, never gating on local room membership', async () => {
    const { service, socketUserService } = createSubject();

    // `adapter.rooms` is an in-process Map. An instance holding no viewers of
    // this post must still publish, or viewers on other instances lose the
    // event entirely.
    await service.emit(postId, 'post:stats_updated', { postId, totalLike: 5 });

    expect(socketUserService.emitToRoom).toHaveBeenCalledTimes(1);
  });

  it('scopes each post to its own room', async () => {
    const { service, socketUserService } = createSubject();
    const otherPost = new ObjectId().toString();

    await service.emit(postId, 'post:comment_created', {});
    await service.emit(otherPost, 'post:comment_created', {});

    expect(socketUserService.emitToRoom.mock.calls[0][0]).toBe(`post:${postId}`);
    expect(socketUserService.emitToRoom.mock.calls[1][0]).toBe(`post:${otherPost}`);
  });

  it('swallows a delivery failure so the interaction still succeeds', async () => {
    const { service, socketUserService } = createSubject();
    socketUserService.emitToRoom.mockRejectedValue(new Error('redis down'));

    // Live delivery is an enhancement over authoritative HTTP state.
    await expect(service.emit(postId, 'post:stats_updated', {})).resolves.toBeUndefined();
  });
});
