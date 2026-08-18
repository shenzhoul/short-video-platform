import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway
} from '@nestjs/websockets';
import { ExtendedSocket } from 'src/@types/extended-socket';
import {
  POST_ROOM,
  SOCKET_CHANNELS,
  SOCKET_EVENTS
} from 'src/common/constants/community';
import { QueueMessageService } from 'src/kernel';
import { AuthService } from 'src/services/identity/auth/auth.service';
import { PostRoomService } from 'src/services/socket/post-room.service';
import { SocketUserService } from 'src/services/socket/socket-user.service';

/**
 * WebSocket Gateway for handling user connections and authentication.
 * This gateway manages socket connections and emits generic connect/disconnect events
 * that other modules can subscribe to for their specific business logic.
 */
@WebSocketGateway()
export class WsUserConnectedGateway
  implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly authService: AuthService,
    private readonly socketUserService: SocketUserService,
    private readonly postRoomService: PostRoomService,
    private readonly queueMessageService: QueueMessageService
  ) { }

  /**
   * Subscribe this socket to a post's live detail events.
   *
   * Thin by design: the gateway only unwraps the payload and reports the
   * outcome, while whether the socket may join is decided by the service.
   *
   * The acknowledgement matters for reconnects — the client needs to know its
   * membership actually exists rather than assuming it survived.
   */
  @SubscribeMessage(POST_ROOM.JOIN)
  async handlePostJoin(client: ExtendedSocket, payload: { postId?: string }) {
    if (!payload?.postId) return { joined: false };
    const joined = await this.postRoomService.join(client, payload.postId);
    return { joined, postId: payload.postId };
  }

  @SubscribeMessage(POST_ROOM.LEAVE)
  async handlePostLeave(client: ExtendedSocket, payload: { postId?: string }) {
    if (!payload?.postId) return { left: false };
    await this.postRoomService.leave(client, payload.postId);
    return { left: true, postId: payload.postId };
  }

  /**
   * Handles new socket connections. Joins the client to global room.
   * Authentication is handled separately via the 'auth/login' event from the client.
   */
  @SubscribeMessage('connect')
  async handleConnection(client: ExtendedSocket): Promise<void> {
    // Join global room for receiving socket events
    await this.socketUserService.joinGlobalRoom(client);

    // Note: Authentication is now handled explicitly via 'auth/login' event
    // to avoid duplicate login calls. The client will emit 'auth/login' after connection.
  }

  /**
   * Handles socket disconnections and cleans up user sessions.
   * Automatically logs out the user based on the token from the handshake.
   */
  @SubscribeMessage('disconnect')
  async handleDisconnect(client: ExtendedSocket) {
    // Proceed if we have the original handshake token OR the stored authUser
    // (the stored userId is the fallback when token was already revoked by HTTP logout)
    if (!client.handshake.query.token && !client.authUser?.userId) {
      return;
    }
    await this.logout(client, client.handshake.query.token);
  }

  @SubscribeMessage('auth/login')
  async handleLogin(client: ExtendedSocket, payload: { token: string }) {
    if (!payload?.token) {
      return;
    }
    await this.login(client, payload.token);
  }

  @SubscribeMessage('auth/logout')
  async handleLogout(client: ExtendedSocket, payload: { token: string }) {
    if (!payload?.token) {
      return;
    }
    await this.logout(client, payload.token);
  }

  async login(client: ExtendedSocket, token: any) {
    const user = await this.authService.getUserFromToken(token);
    if (!user) {
      return;
    }

    // Persist identity on the socket so disconnect handling works even when
    // the token has already been revoked (e.g. via an HTTP logout call).
    client.authUser = { userId: user._id };

    await this.socketUserService.addConnection(user._id, client.id);
    const loggedInUser = { userId: user._id };

    await this.queueMessageService.publish(SOCKET_CHANNELS.USER_CONNECTED, {
      eventName: SOCKET_EVENTS.CONNECTED,
      data: loggedInUser
    });
  }

  async logout(client: ExtendedSocket, token: any) {
    const user = await this.authService.getUserFromToken(token);

    // If the token is already invalid (e.g. HTTP logout happened before the
    // WebSocket disconnect fired), fall back to the userId stored on the socket
    // during login so we can still broadcast the offline/disconnect events.
    const userId = user?._id || client.authUser?.userId;

    if (!userId) {
      return;
    }

    const connectionLen = await this.socketUserService.removeConnection(userId, client.id);
    // still have online (eg from another browser, skip to send online/offline event)
    if (connectionLen) {
      return;
    }

    const loggedInUser = { userId };
    // Emit generic disconnect events that other modules can subscribe to
    await this.queueMessageService.publish(SOCKET_CHANNELS.USER_CONNECTED, {
      eventName: SOCKET_EVENTS.DISCONNECTED,
      data: loggedInUser
    });
  }
}
