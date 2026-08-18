import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import Redis from 'ioredis';
import { uniq } from 'lodash';
import { ObjectId } from 'mongodb';
import { Server, Socket } from 'socket.io';
import { SOCKET_ROOMS } from 'src/common/constants/community';

export const CONNECTED_USER_REDIS_KEY = 'connected_users';
export const CONNECTED_ROOM_REDIS_KEY = 'user:';

/**
 * Socket User Service
 *
 * Core service for managing WebSocket connections, user presence, and real-time communication.
 * Handles user online/offline status, room management, and message broadcasting with
 * Redis-based connection tracking.
 *
 * Key Features:
 * - Real-time user connection management
 * - Redis-based connection state tracking
 * - Room-based messaging and broadcasting
 * - Multi-socket support per user
 * - Global and private room management
 *
 * Connection Management:
 * - Tracks user connections in Redis sets
 * - Supports multiple sockets per user
 * - Real-time online/offline status updates
 *
 * Room System:
 * - Global rooms for platform-wide broadcasts
 * - Private rooms for specific conversations
 * - Room membership tracking in Redis
 * - Connection value storage for room context
 *
 * Note: Socket cleanup is handled by SocketCleanupJob in src/jobs/socket/
 */
@Injectable()
@WebSocketGateway()
export class SocketUserService {
  @WebSocketServer() server: Server;

  constructor(
    @InjectRedis() private readonly redisClient: Redis
  ) { }

  /**
   * Add a new socket connection for a user
   *
   * Registers a new socket connection in Redis, tracking both the user's online status
   * and their individual socket connections. Supports multiple sockets per user.
   *
   * @param userId - User ID to associate with the connection
   * @param socketId - Socket ID from the WebSocket connection
   * @example
   * ```typescript
   * await socketUserService.addConnection(userId, socket.id);
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async addConnection(userId: string | ObjectId, socketId: string) {
    // add to online list
    await this.redisClient.sadd(CONNECTED_USER_REDIS_KEY, userId.toString());
    // add to set: source_id & sockets, to check connection lengths in future in needd?
    await this.redisClient.sadd(userId.toString(), socketId);
    // join this member into member room for feature use?
    // this.server.join(userId.toString());
  }

  /**
   * Remove a socket connection for a user
   *
   * Removes a specific socket connection and cleans up user's online status
   * if no more connections remain. Maintains accurate connection counts.
   *
   * @param userId - User ID to remove connection from
   * @param socketId - Socket ID to remove
   * @returns Promise resolving to remaining connection count
   * @example
   * ```typescript
   * const remainingConnections = await socketUserService.removeConnection(userId, socket.id);
   * if (remainingConnections === 0) {
   *   console.log('User is now offline');
   * }
   * ```
   */
  async removeConnection(userId: string | ObjectId, socketId: string) {
    await this.redisClient.srem(userId.toString(), socketId);

    // if hash is empty, remove connected user
    const len = await this.redisClient.scard(userId.toString());
    if (!len) {
      await this.redisClient.srem(CONNECTED_USER_REDIS_KEY, userId.toString());
    }
    return len;
  }

  /**
   * Emit event to specific users
   *
   * Sends a WebSocket event to one or more specific users across all their
   * connected sockets. Handles both single users and arrays of users.
   *
   * @param userIds - Single user ID or array of user IDs to emit to
   * @param eventName - Name of the event to emit
   * @param data - Data payload to send with the event
   * @example
   * ```typescript
   * // Send to single user
   * await socketUserService.emitToUsers(userId, 'notification', { message: 'Hello!' });
   *
   * // Send to multiple users
   * await socketUserService.emitToUsers([userId1, userId2], 'broadcast', { data: 'Important update' });
   * ```
   */
  async emitToUsers(
    userIds: string | string[] | ObjectId | ObjectId[] | any,
    eventName: string,
    data: any
  ) {
    const stringIds = uniq(
      Array.isArray(userIds) ? userIds : [userIds]
    ).map((i) => i.toString());

    await Promise.all(
      stringIds.map(async (userId) => {
        const socketIds = await this.redisClient.smembers(userId);
        (socketIds || []).forEach((socketId) => this.server.to(socketId).emit(eventName, data));
      })
    );
  }

  /**
   * Join socket to global room
   *
   * Adds a socket connection to the global room for platform-wide broadcasts.
   * All connected users typically join this room for system announcements.
   *
   * @param socket - Socket instance to join to global room
   * @example
   * ```typescript
   * await socketUserService.joinGlobalRoom(socket);
   * ```
   */
  public async joinGlobalRoom(socket: Socket) {
    await socket.join(SOCKET_ROOMS.GLOBAL);
  }

  /**
   * Join socket to specific room
   *
   * Adds a socket connection to a named room for targeted messaging.
   * Used for private conversations, streams, or group chats.
   *
   * @param socket - Socket instance to join to room
   * @param roomName - Name of the room to join
   * @example
   * ```typescript
   * await socketUserService.joinRoom(socket, 'stream-123');
   * ```
   */
  public async joinRoom(socket: Socket, roomName: string) {
    await socket.join(roomName);
  }

  /**
   * Broadcast event to all users globally
   *
   * Broadcasts an event to all users in the global room.
   * Used for platform-wide announcements and system notifications.
   *
   * @param eventName - Name of the event to emit
   * @param data - Data payload to broadcast
   * @example
   * ```typescript
   * await socketUserService.broadcastGlobally('maintenance', {
   *   message: 'System maintenance in 5 minutes'
   * });
   * ```
   */
  public async broadcastGlobally(eventName: string, data: any) {
    this.server.to(SOCKET_ROOMS.GLOBAL).emit(eventName, data);
  }

  /**
   * Emit event to specific room
   *
   * Broadcasts an event to all users in a specific room.
   * Used for room-specific notifications and updates.
   *
   * @param roomName - Name of the room to emit to
   * @param eventName - Name of the event to emit
   * @param data - Data payload to send
   * @example
   * ```typescript
   * socketUserService.emitToRoom('stream-123', 'viewer_joined', {
   *   userId: newViewerId,
   *   viewerCount: 42
   * });
   * ```
   */
  public async emitToRoom(roomName: string, eventName: string, data: any) {
    this.server.to(roomName).emit(eventName, data);
  }

  /**
   * Check if user is currently online
   *
   * Determines if a user has any active socket connections.
   * Returns true if user has at least one connected socket.
   *
   * @param userId - User ID to check online status for
   * @returns Promise resolving to boolean indicating online status
   * @example
   * ```typescript
   * const isUserOnline = await socketUserService.isUserOnline(userId);
   * if (isUserOnline) {
   *   console.log('User is currently online');
   * }
   * ```
   */
  public async isUserOnline(userId: string | ObjectId | any) {
    const socketIds = await this.redisClient.smembers(userId.toString());
    return socketIds?.length > 0;
  }
}
