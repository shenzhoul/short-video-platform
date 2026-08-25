import { Injectable, Logger } from '@nestjs/common';
import {
  MESSAGE_CHANNELS,
  MESSAGE_EVENTS,
  MESSAGE_SOCKET_EVENTS
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { ConversationParticipantService, ConversationService } from 'src/services/community/message';
import { SocketUserService } from 'src/services/socket/socket-user.service';

const MESSAGE_DELIVERY_TOPIC = 'MESSAGE_DELIVERY_TOPIC';

/**
 * Pushes message activity to the two people it belongs to.
 *
 * Delivery is a separate subscriber from creation on purpose, exactly as it is
 * for notifications: if emitting fails and the job retries, only the emit
 * repeats. Re-running creation would insert the message twice and re-raise an
 * unread count the recipient may already have cleared.
 *
 * Every emit is addressed to specific users and nothing is broadcast — a direct
 * message and its counters are private to the pair.
 *
 * Note there is no conversation room and no "is the recipient currently looking
 * at this thread" presence check. Unread is cleared by an explicit read from the
 * client, which is idempotent and survives a dropped socket; inferring it from
 * room membership would make read state depend on connection liveness.
 */
@Injectable()
export class MessageDeliveryListener {
  private readonly logger = new Logger(MessageDeliveryListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly socketUserService: SocketUserService,
    private readonly conversationService: ConversationService,
    private readonly participantService: ConversationParticipantService
  ) {
    this.queueMessageService.subscribe(
      MESSAGE_CHANNELS.MESSAGE,
      MESSAGE_DELIVERY_TOPIC,
      this.handleEvent.bind(this)
    );
  }

  public async handleEvent({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    try {
      if (event.eventName === MESSAGE_EVENTS.CREATED) {
        await this.handleCreated(event.data);
      } else if (event.eventName === MESSAGE_EVENTS.SYSTEM_CREATED) {
        await this.handleSystemCreated(event.data);
      } else if (event.eventName === MESSAGE_EVENTS.READ) {
        await this.handleRead(event.data);
      }
    } catch (error) {
      this.logger.error(`Failed to deliver message event: ${error.message}`, error.stack);
    }
  }

  /**
   * Deliver a new message to both participants.
   *
   * The sender gets it too. That is not redundant with the API response: the
   * sender may have the conversation open in another tab or on the full page as
   * well as the sidebar, and those surfaces have no other way to learn about it.
   * Clients de-duplicate on the message `_id`, so the surface that made the
   * request and receives the echo shows one bubble, not two.
   */
  private async handleCreated(data: Record<string, any>): Promise<void> {
    const { message, conversationId, senderId, recipientId } = data || {};
    if (!message || !conversationId || !senderId || !recipientId) return;

    await this.socketUserService.emitToUsers(
      [senderId, recipientId],
      MESSAGE_SOCKET_EVENTS.CREATED,
      message
    );

    // Each participant's conversation row differs — their own unread count and
    // their own side of the permission state — so the row is built per person
    // rather than emitted once and shared.
    await Promise.all([
      this.emitConversationUpdate(conversationId, recipientId, senderId),
      this.emitConversationUpdate(conversationId, senderId, recipientId)
    ]);

    // Only the recipient's totals moved; the sender's own message is already read.
    await this.emitUnreadTotals(recipientId);
  }

  /**
   * Deliver a system notice to both participants.
   *
   * Its own handler because a notice has no sender: the message path above reads
   * one to decide who gets the unread bump, and there is nobody here to name.
   * Both participants are simply told, symmetrically.
   *
   * No unread totals are emitted. Nothing incremented them — a notice is not a
   * message from a person — so there is nothing new to announce, and pushing a
   * total here would only invite a client to render a badge for it.
   */
  private async handleSystemCreated(data: Record<string, any>): Promise<void> {
    const { message, conversationId, participantIds } = data || {};
    if (!message || !conversationId || !participantIds?.length) return;

    await this.socketUserService.emitToUsers(
      participantIds,
      MESSAGE_SOCKET_EVENTS.CREATED,
      message
    );

    // Each participant's row differs — their own unread count and their own side
    // of the permission state — so it is built per person.
    await Promise.all(participantIds.map((viewerId: string) => this.emitConversationUpdate(
      conversationId,
      viewerId,
      participantIds.find((id: string) => id !== viewerId) || viewerId
    )));
  }

  /** Tell a reader's other sessions that a conversation is no longer unread. */
  private async handleRead(data: Record<string, any>): Promise<void> {
    const { userId, conversationIds, totals } = data || {};
    if (!userId) return;

    await this.socketUserService.emitToUsers(userId, MESSAGE_SOCKET_EVENTS.READ, {
      // null means every conversation, from a read-all.
      conversationIds: conversationIds ?? null
    });

    await this.socketUserService.emitToUsers(
      userId,
      MESSAGE_SOCKET_EVENTS.UNREAD_UPDATED,
      totals || await this.participantService.getUnreadTotals(userId)
    );
  }

  private async emitConversationUpdate(
    conversationId: string,
    viewerId: string,
    otherId: string
  ): Promise<void> {
    try {
      const conversation = await this.conversationService.getDetail(conversationId, viewerId);
      await this.socketUserService.emitToUsers(
        viewerId,
        MESSAGE_SOCKET_EVENTS.CONVERSATION_UPDATED,
        conversation
      );
    } catch (error) {
      // A row that cannot be built for one participant must not stop the other
      // from being told about the message.
      this.logger.error(
        `Failed to emit conversation update for ${viewerId} (other: ${otherId}): ${error.message}`,
        error.stack
      );
    }
  }

  private async emitUnreadTotals(userId: string): Promise<void> {
    const totals = await this.participantService.getUnreadTotals(userId);
    await this.socketUserService.emitToUsers(
      userId,
      MESSAGE_SOCKET_EVENTS.UNREAD_UPDATED,
      totals
    );
  }
}
