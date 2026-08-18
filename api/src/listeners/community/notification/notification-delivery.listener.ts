import { Injectable, Logger } from '@nestjs/common';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_SOCKET_EVENTS
} from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { EVENT } from 'src/kernel/constants';
import { SocketUserService } from 'src/services/socket/socket-user.service';

const NOTIFICATION_DELIVERY_TOPIC = 'NOTIFICATION_DELIVERY_TOPIC';

/**
 * Pushes a freshly created notification to its recipient over the socket.
 *
 * Delivery is a separate subscriber from creation on purpose. If emitting fails
 * and the job retries, only the emit repeats — re-running creation would reset
 * an already-read notification back to unread.
 *
 * Emission is addressed to the recipient's own sockets, never broadcast, because
 * the payload is private to that user.
 */
@Injectable()
export class NotificationDeliveryListener {
  private logger = new Logger(NotificationDeliveryListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    private readonly socketUserService: SocketUserService
  ) {
    this.queueMessageService.subscribe(
      NOTIFICATION_CHANNELS.NOTIFICATION,
      NOTIFICATION_DELIVERY_TOPIC,
      this.handleNotification.bind(this)
    );
  }

  public async handleNotification({ data: event }: QueueEvent<Record<string, any>>) {
    try {
      const isCreate = event.eventName === EVENT.CREATED;
      const isUpdate = event.eventName === EVENT.UPDATED;
      if (!isCreate && !isUpdate) return;

      const notification = event.data;
      if (!notification?.recipientId) return;

      // An update carries a distinct event name so the client can patch the row
      // in place. Routing it through CREATED would make the recipient's client
      // treat re-rendered content as arriving activity and disturb the badge.
      await this.socketUserService.emitToUsers(
        notification.recipientId,
        isCreate ? NOTIFICATION_SOCKET_EVENTS.CREATED : NOTIFICATION_SOCKET_EVENTS.UPDATED,
        notification
      );
    } catch (e) {
      this.logger.error(`Failed to deliver notification: ${e.message}`, e.stack);
    }
  }
}
