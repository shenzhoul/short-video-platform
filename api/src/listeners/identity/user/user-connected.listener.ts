import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SOCKET_CHANNELS, SOCKET_EVENTS } from 'src/common/constants/community';
import { QueueEvent, QueueMessageService } from 'src/kernel';
import { User, UserDocument } from 'src/schemas/identity/user';

const HANDLE_USER_ONLINE_OFFLINE = 'HANDLE_USER_ONLINE_OFFLINE';

@Injectable()
export class UserConnectedListener {
  private readonly logger = new Logger(UserConnectedListener.name);

  constructor(
    private readonly queueMessageService: QueueMessageService,
    @InjectModel(User.name) private readonly UserModel: Model<UserDocument>
  ) {
    this.queueMessageService.subscribe(
      SOCKET_CHANNELS.USER_CONNECTED,
      HANDLE_USER_ONLINE_OFFLINE,
      this.handleOnlineOffline.bind(this),
      {
        lockDuration: 120000,
        lockRenewTime: 30000,
        maxStalledCount: 2
      }
    );
  }

  private async handleOnlineOffline({ data: event }: QueueEvent<Record<string, any>>): Promise<void> {
    try {
      const userId = event?.data?.userId;
      if (!userId) {
        return;
      }

      let updateData = {};
      switch (event.eventName) {
        case SOCKET_EVENTS.CONNECTED:
          updateData = {
            isOnline: true,
            onlineAt: new Date(),
            offlineAt: null
          };
          break;
        case SOCKET_EVENTS.DISCONNECTED:
          updateData = {
            isOnline: false,
            onlineAt: null,
            offlineAt: new Date()
          };
          break;
        default: return;
      }
      // Do not update online status for deleted accounts
      await this.UserModel.updateOne(
        { _id: userId, status: { $ne: 'deleted' } },
        updateData,
        {
          upsert: false
        }
      );
    } catch (e) {
      this.logger.error(e.stack || e, { context: 'user_connected_listener' });
    }
  }
}
