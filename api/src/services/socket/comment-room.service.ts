import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { Socket } from 'socket.io';
import { COMMENT_OBJECT_TYPES, COMMENT_ROOM } from 'src/common/constants/community';
import { Comment, CommentDocument } from 'src/schemas/community/comment';

import { PostRoomService } from './post-room.service';
import { SocketUserService } from './socket-user.service';

/**
 * Membership of the per-thread reply rooms.
 *
 * Exists so a reply body travels only to the people with that thread expanded.
 * The post room already tells everyone a thread grew; this is the narrower room
 * that carries the content itself.
 *
 * Like the post rooms, membership is left to Socket.IO — the adapter stores it,
 * cleans it up on disconnect, and fans a room emit across instances.
 */
@Injectable()
export class CommentRoomService {
  private readonly logger = new Logger(CommentRoomService.name);

  constructor(
    @InjectModel(Comment.name) private readonly CommentModel: Model<CommentDocument>,
    private readonly postRoomService: PostRoomService,
    private readonly socketUserService: SocketUserService
  ) { }

  /**
   * Let a socket start receiving one thread's replies.
   *
   * A thread is only as private as the post holding it, so admission is decided
   * by the post's own view permission rather than by anything thread-specific.
   * Reusing {@link PostRoomService.resolveViewablePost} keeps that a single
   * definition — a thread must never become a way around a post nobody is
   * allowed to see.
   *
   * @returns whether the socket was admitted
   */
  public async join(socket: Socket, commentId: string): Promise<boolean> {
    const postId = await this.resolvePostId(commentId);
    if (!postId) return false;

    const canView = await this.postRoomService.canView(postId);
    if (!canView) return false;

    await this.socketUserService.joinRoom(socket, COMMENT_ROOM.name(commentId));
    return true;
  }

  /** Leaving is always allowed; refusing would be the actual bug. */
  public async leave(socket: Socket, commentId: string): Promise<void> {
    if (!commentId) return;
    await socket.leave(COMMENT_ROOM.name(commentId));
  }

  /**
   * Emit to everyone with one thread expanded.
   *
   * Not guarded by a local membership check, for the same reason the post rooms
   * are not: `adapter.rooms` is per-process, so an instance holding no readers
   * of this thread would wrongly conclude the room is empty.
   */
  public async emit(commentId: string | ObjectId, event: string, payload: any): Promise<void> {
    try {
      await this.socketUserService.emitToRoom(
        COMMENT_ROOM.name(commentId.toString()),
        event,
        payload
      );
    } catch (e) {
      // Live delivery is an enhancement over the authoritative HTTP state, so a
      // failed emit must never fail the interaction that produced it.
      this.logger.error(`Failed to emit ${event} to comment ${commentId}: ${e.message}`, e.stack);
    }
  }

  /**
   * The post a thread belongs to.
   *
   * A top-level comment names its post directly; a reply names its parent, so
   * one extra hop resolves it. Replies of replies are not a level this product
   * has, so the walk is bounded at one step by construction rather than by a
   * loop guard.
   */
  private async resolvePostId(commentId: string): Promise<string | null> {
    if (!commentId || !ObjectId.isValid(commentId)) return null;

    const comment = await this.CommentModel
      .findOne({ _id: new ObjectId(commentId) })
      .select({ objectId: 1, objectType: 1 })
      .lean();
    if (!comment?.objectId) return null;

    if (comment.objectType !== COMMENT_OBJECT_TYPES.COMMENT) {
      return comment.objectId.toString();
    }

    const parent = await this.CommentModel
      .findOne({ _id: comment.objectId })
      .select({ objectId: 1, objectType: 1 })
      .lean();
    if (!parent?.objectId || parent.objectType === COMMENT_OBJECT_TYPES.COMMENT) return null;
    return parent.objectId.toString();
  }
}
