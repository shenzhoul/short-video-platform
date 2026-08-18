import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { Socket } from 'socket.io';
import { POST_ROOM } from 'src/common/constants/community';
import { EVENT } from 'src/kernel/constants';
import { Post, PostDocument } from 'src/schemas';
import { ContentPermissionService } from 'src/services/community/content-permission.service';

import { SocketUserService } from './socket-user.service';

/**
 * Membership of the live rooms behind Post Detail.
 *
 * Room membership itself is left to Socket.IO rather than tracked in a Redis set
 * of our own: the adapter already stores it, already cleans it up on disconnect,
 * and already fans a room emit out across instances. A parallel membership map
 * would only be a second thing to keep correct.
 */
@Injectable()
export class PostRoomService {
  private readonly logger = new Logger(PostRoomService.name);

  constructor(
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    private readonly contentPermissionService: ContentPermissionService,
    private readonly socketUserService: SocketUserService
  ) { }

  /**
   * Let a socket start receiving one post's live events.
   *
   * The server decides, never the client. A socket can emit `post/join` with any
   * id at all, so opening the modal in the browser proves nothing — the post has
   * to exist, still be visible, and pass the shared view permission before the
   * socket is put in the room.
   *
   * @returns whether the socket was admitted
   */
  public async join(socket: Socket, postId: string): Promise<boolean> {
    if (!ObjectId.isValid(postId)) return false;

    // A deleted or missing post has no live state worth subscribing to, and
    // admitting one would leak the fact that the id exists at all.
    const post = await this.PostModel
      .findOne({ _id: new ObjectId(postId) })
      .select({ _id: 1, status: 1 })
      .lean();
    if (!post || post.status === EVENT.DELETED) return false;

    // The same permission seam the HTTP comment routes already use, so post
    // visibility has one definition rather than a socket-only copy of it.
    const canView = await this.contentPermissionService.canView(postId);
    if (!canView) return false;

    await this.socketUserService.joinRoom(socket, POST_ROOM.name(postId));
    return true;
  }

  /**
   * Stop a socket receiving a post's events.
   *
   * Needs no permission check and no existence check: leaving is always allowed,
   * and refusing to leave a room would be the actual bug.
   */
  public async leave(socket: Socket, postId: string): Promise<void> {
    if (!postId) return;
    await socket.leave(POST_ROOM.name(postId));
  }

  /**
   * Emit to everyone watching a post, wherever they are connected.
   *
   * Goes through `server.to(room)`, which the Redis adapter turns into a pub/sub
   * publish so every instance delivers to its own local members.
   *
   * Deliberately NOT guarded by a local room-membership check: `adapter.rooms`
   * is an in-process Map, so an instance that holds no viewers of this post
   * would conclude the room is empty and drop an event that viewers on other
   * instances were waiting for.
   */
  public async emit(postId: string | ObjectId, event: string, payload: any): Promise<void> {
    try {
      await this.socketUserService.emitToRoom(POST_ROOM.name(postId.toString()), event, payload);
    } catch (e) {
      // Live delivery is an enhancement over the authoritative HTTP state, so a
      // failed emit must never fail the interaction that produced it.
      this.logger.error(`Failed to emit ${event} to post ${postId}: ${e.message}`, e.stack);
    }
  }
}
