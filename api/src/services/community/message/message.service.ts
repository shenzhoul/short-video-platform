import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model, SortOrder } from 'mongoose';
import { PAGINATION_DEFAULTS } from 'src/common/constants';
import {
  MESSAGE_CHANNELS,
  MESSAGE_EVENTS,
  MESSAGE_TYPES
} from 'src/common/constants/community';
import { applyCursorPagination } from 'src/common/utils/pagination.util';
import { MessageDto } from 'src/dtos/community/message';
import { AuthUserDto } from 'src/dtos/identity/auth-user.dto';
import { UserDto } from 'src/dtos/identity/user';
import { QueueMessageService } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { MessageCreatePayload, MessageSearchPayload } from 'src/payloads/community/message';
import { Message, MessageDocument } from 'src/schemas/community/message';
import { ContentFileService } from 'src/services/content/content.file.service';
import { FileServerService } from 'src/services/shared/file-server';
import { __t } from 'src/utils/translation';

import { ConversationParticipantService } from './conversation-participant.service';
import { ConversationService } from './conversation.service';
import { MessagePermissionService, MessageRequestState } from './message-permission.service';

/** Message body plus the conversation state the sender should see afterwards. */
export interface SendMessageResult {
  message: MessageDto;
  /** Where the sender stands now: whether they may send again. */
  canSend: boolean;
  requestState: MessageRequestState;
  awaitingReplyFrom: 'me' | 'them' | null;
}

/**
 * Creating and reading messages in a direct conversation.
 *
 * Permission is delegated to MessagePermissionService and is enforced here on
 * every single send, not once when the conversation is opened. That distinction
 * matters: a pair's follow relation can change at any time, and permission that
 * was granted at conversation-creation time would outlive the relationship it
 * was based on.
 */
@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name);

  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    private readonly conversationService: ConversationService,
    private readonly participantService: ConversationParticipantService,
    private readonly permissionService: MessagePermissionService,
    private readonly contentFileService: ContentFileService,
    private readonly fileServerService: FileServerService,
    private readonly queueMessageService: QueueMessageService
  ) {}

  /**
   * Send one message.
   *
   * Order of operations is deliberate:
   *
   *  1. Confirm membership (which also resolves the recipient).
   *  2. Validate attachments *before* claiming, so a rejected file never spends
   *     the sender's one restricted message.
   *  3. Claim the send slot atomically. This is the permission gate, and it has
   *     to happen before the insert — inserting first would let two concurrent
   *     sends both write a message before either claim resolved, which is the
   *     exact race the claim exists to prevent.
   *  4. Insert, then update the previews and counters.
   *
   * If step 4 fails, the claim from step 3 is released, otherwise the sender
   * would be left waiting for a reply to a message that was never written.
   */
  public async send(
    conversationId: string | ObjectId,
    payload: MessageCreatePayload,
    sender: UserDto | AuthUserDto
  ): Promise<SendMessageResult> {
    const conversation = await this.conversationService.findForMember(conversationId, sender._id);
    const recipientId = conversation.recipientIds.find(
      id => id.toString() !== sender._id.toString()
    );
    if (!recipientId) throw new ForbiddenException(__t('errors.access_denied'));

    const fileIds = (payload.fileIds || []).filter(Boolean);
    // Ownership is checked here rather than trusted from the request: a file id
    // is guessable, and without this a sender could attach somebody else's
    // upload to their own message.
    const files = fileIds.length
      ? await this.contentFileService.validateAndRetrieveOwnedFiles(fileIds, sender)
      : [];

    const claim = await this.permissionService.claimSendSlot(
      conversation._id,
      sender._id,
      recipientId
    );
    if (!claim.allowed) {
      throw new ForbiddenException(__t('errors.message_awaiting_reply'));
    }

    try {
      const createdAt = new Date();
      const created = await this.messageModel.create({
        conversationId: conversation._id,
        senderId: toObjectId(sender._id),
        type: this.resolveType(payload, files),
        text: payload.text || '',
        fileIds: fileIds.map(id => toObjectId(id)),
        createdAt,
        updatedAt: createdAt
      });

      const dto = MessageDto.fromModel(created);
      dto.setFiles(files);

      await Promise.all([
        this.conversationService.applyLastMessage(conversation._id, {
          text: this.buildPreview(dto),
          type: dto.type,
          senderId: toObjectId(sender._id),
          createdAt
        }),
        this.participantService.recordMessage(
          conversation._id,
          sender._id,
          recipientId,
          createdAt
        ),
        // Attach the file to the message so the file server knows it is
        // referenced and will not garbage-collect it as an abandoned upload.
        fileIds.length
          ? this.fileServerService.addRefToMultipleFiles(fileIds, {
            itemId: created._id,
            itemType: 'message'
          }).catch(error => {
            this.logger.error(`Failed to reference message files: ${error.message}`, error.stack);
          })
          : Promise.resolve()
      ]);

      // Delivery is a separate subscriber, so a failed emit retries the emit
      // alone. Re-running creation would duplicate the message and re-raise an
      // unread count the recipient may already have cleared.
      await this.queueMessageService.publish(MESSAGE_CHANNELS.MESSAGE, {
        eventName: MESSAGE_EVENTS.CREATED,
        data: {
          message: dto,
          conversationId: conversation._id.toString(),
          senderId: sender._id.toString(),
          recipientId: recipientId.toString()
        }
      });

      // Reported from the claim, so a reply that just accepted the request tells
      // the replier they are free now rather than newly restricted.
      const waiting = claim.requestState === 'waiting';
      return {
        message: dto,
        canSend: !waiting,
        requestState: claim.requestState,
        awaitingReplyFrom: waiting ? 'me' : null
      };
    } catch (error) {
      // Best effort, and guarded inside the service so it cannot revert a newer
      // transition. It must never mask the error that brought us here.
      await this.permissionService
        .releaseSendSlot(conversation._id, sender._id, claim)
        .catch(releaseError => {
          this.logger.error(
            `Failed to release send slot after a failed message insert: ${releaseError.message}`,
            releaseError.stack
          );
        });
      throw error;
    }
  }

  /**
   * Mark one conversation read for the caller, and tell their other sessions.
   *
   * Orchestrated here rather than in the participant service so the persistence
   * layer stays free of transport concerns, and so every message socket event
   * is published from one place.
   *
   * Reading deliberately does nothing to messaging permission. A restricted
   * sender is released by a *reply*, not by the recipient opening the thread —
   * otherwise merely looking at a request would grant the sender another one.
   */
  public async markConversationRead(
    conversationId: string | ObjectId,
    user: UserDto | AuthUserDto
  ): Promise<{ cleared: number }> {
    await this.conversationService.findForMember(conversationId, user._id);
    const result = await this.participantService.markConversationRead(conversationId, user._id);

    await this.publishRead(user._id, [conversationId.toString()]);
    return result;
  }

  /** Mark every conversation read for the caller. */
  public async markAllRead(user: UserDto | AuthUserDto): Promise<{ updated: number }> {
    const result = await this.participantService.markAllRead(user._id);
    await this.publishRead(user._id, null);
    return result;
  }

  /**
   * Announce a read to the reader's own sessions.
   *
   * Carries the authoritative totals rather than a delta, so a client that
   * missed an earlier frame still converges on the right badge instead of
   * accumulating drift. `conversationIds: null` means "all of them".
   */
  private async publishRead(
    userId: string | ObjectId,
    conversationIds: string[] | null
  ): Promise<void> {
    const totals = await this.participantService.getUnreadTotals(userId);
    await this.queueMessageService.publish(MESSAGE_CHANNELS.MESSAGE, {
      eventName: MESSAGE_EVENTS.READ,
      data: {
        userId: userId.toString(),
        conversationIds,
        totals
      }
    });
  }

  /**
   * A conversation's history, newest first.
   *
   * Cursor-paginated on `(createdAt, _id)`. The `_id` tiebreaker is load-bearing
   * in a chat: two messages can share a millisecond, and without a deterministic
   * second key a page boundary landing between them would drop or repeat one.
   */
  public async search(
    conversationId: string | ObjectId,
    payload: MessageSearchPayload,
    user: UserDto | AuthUserDto
  ): Promise<PageableData<MessageDto>> {
    // Membership check first: a non-member must not be able to read history by
    // guessing a conversation id.
    await this.conversationService.findForMember(conversationId, user._id);

    const limit = Number(payload.limit) || PAGINATION_DEFAULTS.DEFAULT_LIMIT;
    const offset = Number(payload.offset) || 0;
    const useCursor = Boolean(payload.cursor && payload.lastCreatedAt);

    let query: Record<string, any> = { conversationId: toObjectId(conversationId) };
    if (useCursor) {
      query = applyCursorPagination(query, payload.cursor, payload.lastCreatedAt);
    }

    const sortDirection: SortOrder = payload.sort === 'asc' ? 1 : -1;
    const rows = await this.messageModel.find(query)
      .sort({ createdAt: sortDirection, _id: sortDirection })
      .skip(useCursor ? 0 : offset)
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const data = await this.attachFiles(page);
    const last = page[page.length - 1];

    return {
      data,
      total: useCursor ? undefined : await this.messageModel.countDocuments({
        conversationId: toObjectId(conversationId)
      }),
      hasMore,
      nextCursor: hasMore && last
        ? { id: last._id.toString(), createdAt: new Date(last.createdAt).getTime() }
        : null,
      paginationInfo: {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      }
    } as PageableData<MessageDto>;
  }

  /**
   * Resolve every attachment on a page in one call.
   *
   * Batched rather than per message: a page of media messages would otherwise
   * be one file-server round trip each.
   */
  private async attachFiles(rows: any[]): Promise<MessageDto[]> {
    const dtos = rows.map(row => MessageDto.fromModel(row)).filter(Boolean) as MessageDto[];
    const allFileIds = dtos.flatMap(dto => dto.fileIds || []);
    if (!allFileIds.length) {
      dtos.forEach(dto => dto.setFiles([]));
      return dtos;
    }

    const files = await this.fileServerService.findByIds(allFileIds);
    const fileMap = new Map(files.map(file => [file._id.toString(), file]));

    dtos.forEach(dto => {
      dto.setFiles(
        (dto.fileIds || [])
          .map(id => fileMap.get(id.toString()))
          .filter(Boolean) as any[]
      );
    });

    return dtos;
  }

  /**
   * Type of the stored message.
   *
   * Derived from the attachment rather than trusted from the request: the client
   * sends what it thinks it picked, but the file server knows what was actually
   * uploaded, and a bubble rendered as the wrong kind is a broken bubble.
   */
  private resolveType(payload: MessageCreatePayload, files: any[]): string {
    if (!files.length) return MESSAGE_TYPES.TEXT;
    const [file] = files;
    if (typeof file.isVideo === 'function' && file.isVideo()) return MESSAGE_TYPES.VIDEO;
    if (typeof file.isImage === 'function' && file.isImage()) return MESSAGE_TYPES.IMAGE;
    return payload.type === MESSAGE_TYPES.VIDEO ? MESSAGE_TYPES.VIDEO : MESSAGE_TYPES.IMAGE;
  }

  /**
   * Preview text for the conversation row.
   *
   * A media message with no caption still needs to say something, otherwise the
   * row renders blank and looks broken. The label is resolved client-side from
   * `lastMessageType`, so what is stored here is only the caption when there is
   * one.
   */
  private buildPreview(message: MessageDto): string {
    return message.text || '';
  }
}
