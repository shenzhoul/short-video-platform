import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model, SortOrder } from 'mongoose';
import { PAGINATION_DEFAULTS, USER_STATUS } from 'src/common/constants';
import { MESSAGE_PREVIEW_LENGTH } from 'src/common/constants/community';
import { applyCursorPagination } from 'src/common/utils/pagination.util';
import { ConversationDto } from 'src/dtos/community/message';
import { UserDto } from 'src/dtos/identity/user';
import { EntityNotFoundException } from 'src/kernel';
import { PageableData } from 'src/kernel/common';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { ConversationSearchPayload } from 'src/payloads/community/message';
import {
  Conversation,
  ConversationDocument,
  ConversationParticipant,
  ConversationParticipantDocument,
  User,
  UserDocument
} from 'src/schemas';
import { FollowService } from 'src/services/community/follow';
import { BaseUserService } from 'src/services/identity/user/base-user.service';
import { __t } from 'src/utils/translation';

import { ConversationParticipantService } from './conversation-participant.service';
import { MessagePermissionService, MessagePermissionState } from './message-permission.service';

/**
 * Owns direct conversations: identity of a pair, the list a user sees, and the
 * denormalised preview each row renders.
 *
 * Read state and unread counts live in ConversationParticipantService, and send
 * permission lives in MessagePermissionService. This service only composes them.
 */
@Injectable()
export class ConversationService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    @InjectModel(ConversationParticipant.name)
    private readonly participantModel: Model<ConversationParticipantDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly baseUserService: BaseUserService,
    private readonly followService: FollowService,
    private readonly permissionService: MessagePermissionService,
    private readonly participantService: ConversationParticipantService
  ) {}

  /**
   * Canonical identity of a pair of users.
   *
   * Sorted before joining, which is the whole point: it makes the key
   * direction-independent so "A opens a chat with B" and "B opens a chat with A"
   * produce the same string and therefore the same conversation.
   */
  public static buildHashKey(userIdA: string | ObjectId, userIdB: string | ObjectId): string {
    return [userIdA.toString(), userIdB.toString()].sort().join('_');
  }

  /**
   * Find the conversation between two users, or create it.
   *
   * Written as an upsert on `hashKey` rather than find-then-create because the
   * two requests genuinely race: both people can tap "message" at the same
   * moment, both find nothing, and both insert. The unique index is what
   * actually decides the winner, so the loser's duplicate-key error is expected
   * and is resolved by re-reading rather than surfaced as a 500.
   */
  public async findOrCreateDirectConversation(
    userId: string | ObjectId,
    participantId: string | ObjectId
  ): Promise<ConversationDto> {
    if (userId.toString() === participantId.toString()) {
      throw new BadRequestException(__t('errors.cannot_message_yourself'));
    }
    if (!ObjectId.isValid(participantId.toString())) throw new EntityNotFoundException();

    const participant = await this.userModel.exists({
      _id: toObjectId(participantId),
      status: USER_STATUS.ACTIVE
    });
    if (!participant) throw new EntityNotFoundException();

    const hashKey = ConversationService.buildHashKey(userId, participantId);
    const recipientIds = [toObjectId(userId), toObjectId(participantId)];

    let conversation: any;
    try {
      conversation = await this.conversationModel.findOneAndUpdate(
        { hashKey },
        {
          $setOnInsert: {
            hashKey,
            recipientIds,
            pendingSenderId: null,
            lastMessage: '',
            lastMessageType: null,
            lastSenderId: null,
            lastMessageCreatedAt: null
          }
        },
        { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
      ).lean();
    } catch (error: any) {
      // The upsert lost the race on the unique index. The winner has already
      // created exactly the conversation this call wanted, so read it back.
      if (error?.code !== 11000) throw error;
      conversation = await this.conversationModel.findOne({ hashKey }).lean();
      if (!conversation) throw error;
    }

    // Both people get a participant row now, not when the first message is
    // sent. The conversation list is built from those rows, so without this the
    // conversation the user just opened would be missing from their own list.
    await this.participantService.ensureParticipants(
      conversation._id,
      conversation.recipientIds,
      conversation.createdAt || new Date()
    );

    return this.decorateOne(conversation, userId, participantId);
  }

  /**
   * The conversation between two users, if they have one.
   *
   * Looks up by the canonical pair key rather than by membership, because the
   * caller here is not one of the participants — it is the follow listener
   * reacting to a relationship change on their behalf.
   */
  public async findByPair(
    userIdA: string | ObjectId,
    userIdB: string | ObjectId
  ): Promise<ConversationDocument | null> {
    return this.conversationModel.findOne({
      hashKey: ConversationService.buildHashKey(userIdA, userIdB)
    });
  }

  /** A conversation the caller is a member of, or a not-found error. */
  public async findForMember(
    conversationId: string | ObjectId,
    userId: string | ObjectId
  ): Promise<ConversationDocument> {
    // A malformed id is simply a conversation that does not exist. Casting it
    // first would throw a BSON error and surface as a 500 instead of a 404.
    if (!ObjectId.isValid(conversationId.toString())) throw new EntityNotFoundException();

    const conversation = await this.conversationModel.findOne({
      _id: toObjectId(conversationId),
      // Membership is part of the lookup, not a check afterwards, so a
      // conversation belonging to two other people is indistinguishable from one
      // that does not exist. Guessing an id reveals nothing.
      recipientIds: toObjectId(userId)
    });

    if (!conversation) throw new EntityNotFoundException();
    return conversation;
  }

  /** A conversation detail payload for one of its members. */
  public async getDetail(
    conversationId: string | ObjectId,
    userId: string | ObjectId
  ): Promise<ConversationDto> {
    const conversation = await this.findForMember(conversationId, userId);
    const otherId = conversation.recipientIds.find(id => id.toString() !== userId.toString());
    return this.decorateOne(conversation.toObject(), userId, otherId);
  }

  /**
   * The caller's conversations, most recent activity first.
   *
   * Driven from `conversation_participants` rather than `conversations` because
   * that collection already carries this user's activity time and unread count
   * on an index led by `userId` — so ordering, paging and the unread badge all
   * come from one indexed read instead of a scan over conversations.
   *
   * Every enrichment below is batched. A page of twenty rows costs a fixed
   * handful of queries, not twenty times anything.
   */
  public async search(
    userId: string | ObjectId,
    payload: ConversationSearchPayload
  ): Promise<PageableData<ConversationDto>> {
    const limit = Number(payload.limit) || PAGINATION_DEFAULTS.DEFAULT_LIMIT;
    const offset = Number(payload.offset) || 0;
    const useCursor = Boolean(payload.cursor && payload.lastCreatedAt);

    // No activity filter: a conversation the user has opened belongs in their
    // list even before anything is said, otherwise starting one from a profile
    // and going back shows an empty list.
    let participantQuery: Record<string, any> = {
      userId: toObjectId(userId)
    };

    // A keyword search matches the other person, whose name lives on the user
    // document. Resolve the matching users first and constrain the conversation
    // lookup to their pairs — the participant rows hold nothing searchable.
    const keyword = (payload.q || '').trim();
    if (keyword) {
      const matchedConversationIds = await this.findConversationIdsMatchingKeyword(userId, keyword);
      if (!matchedConversationIds.length) return this.emptyPage();
      participantQuery.conversationId = { $in: matchedConversationIds };
    }

    if (useCursor) {
      participantQuery = applyCursorPagination(
        participantQuery,
        payload.cursor,
        payload.lastCreatedAt,
        'lastMessageAt'
      );
    }

    const sortDirection: SortOrder = payload.sort === 'asc' ? 1 : -1;
    const rows = await this.participantModel.find(participantQuery)
      .sort({ lastMessageAt: sortDirection, _id: sortDirection })
      .skip(useCursor ? 0 : offset)
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    if (!page.length) return this.emptyPage(useCursor ? undefined : 0);

    const conversations = await this.conversationModel
      .find({ _id: { $in: page.map(row => row.conversationId) } })
      .lean();
    const conversationMap = new Map(conversations.map(item => [item._id.toString(), item]));

    const otherIdByConversation = new Map<string, ObjectId>();
    conversations.forEach(conversation => {
      const otherId = conversation.recipientIds.find(id => id.toString() !== userId.toString());
      if (otherId) otherIdByConversation.set(conversation._id.toString(), otherId);
    });

    const otherIds = [...otherIdByConversation.values()];
    const [participants, mutualIds] = await Promise.all([
      this.baseUserService.findByIds(otherIds),
      this.followService.getMutualFollowerIdSet(userId, otherIds)
    ]);
    const participantMap = new Map(participants.map(item => [item._id.toString(), item]));

    const data = page.reduce((results, row) => {
      const conversation = conversationMap.get(row.conversationId.toString());
      if (!conversation) return results;

      const dto = ConversationDto.fromModel(conversation);
      if (!dto) return results;

      const otherId = otherIdByConversation.get(conversation._id.toString());
      const other = otherId ? participantMap.get(otherId.toString()) : null;
      dto.setParticipant(other || null);
      dto.setUnreadCount(row.unreadCount);
      dto.setPermission(this.permissionService.describe(
        conversation,
        userId,
        otherId ? mutualIds.has(otherId.toString()) : false
      ));

      results.push(dto);
      return results;
    }, [] as ConversationDto[]);

    const last = page[page.length - 1];

    return {
      data,
      total: useCursor ? undefined : await this.participantModel.countDocuments(participantQuery),
      hasMore,
      nextCursor: hasMore && last
        ? { id: last._id.toString(), createdAt: new Date(last.lastMessageAt).getTime() }
        : null,
      paginationInfo: {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      }
    } as PageableData<ConversationDto>;
  }

  /**
   * Move a conversation to the top of both participants' lists and refresh the
   * preview shown on the row.
   *
   * The preview is truncated at write time so the conversation list never has to
   * load message bodies it will not display.
   */
  public async applyLastMessage(
    conversationId: string | ObjectId,
    message: { text: string; type: string; senderId: ObjectId; createdAt: Date }
  ): Promise<void> {
    await this.conversationModel.updateOne(
      { _id: toObjectId(conversationId) },
      {
        $set: {
          lastMessage: (message.text || '').slice(0, MESSAGE_PREVIEW_LENGTH),
          lastMessageType: message.type,
          lastSenderId: message.senderId,
          lastMessageCreatedAt: message.createdAt
        }
      }
    );
  }

  /** Build the full payload for one conversation, including live permission. */
  public async decorateOne(
    conversation: any,
    userId: string | ObjectId,
    otherId: string | ObjectId | null | undefined
  ): Promise<ConversationDto> {
    const dto = ConversationDto.fromModel(conversation);
    if (!dto) throw new EntityNotFoundException();

    const [other, participantRow, permission] = await Promise.all([
      otherId ? this.baseUserService.findById(otherId).catch(() => null) : Promise.resolve(null),
      this.participantModel.findOne({
        conversationId: toObjectId(conversation._id),
        userId: toObjectId(userId)
      }).lean(),
      otherId
        ? this.permissionService.describeForPair(conversation, userId, otherId)
        // A conversation with no resolvable other participant cannot be sent to.
        : Promise.resolve<MessagePermissionState>({
          isMutualFollow: false,
          canSend: false,
          requestState: 'idle',
          awaitingReplyFrom: null,
          restrictionReason: null
        })
    ]);

    dto.setParticipant(other as UserDto | null);
    dto.setUnreadCount(participantRow?.unreadCount || 0);
    dto.setPermission(permission);
    return dto;
  }

  /** Conversations of `userId` whose other participant matches `keyword`. */
  private async findConversationIdsMatchingKeyword(
    userId: string | ObjectId,
    keyword: string
  ): Promise<ObjectId[]> {
    const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    const matchedUsers = await this.userModel
      .find({
        $or: [{ name: pattern }, { username: pattern }],
        status: USER_STATUS.ACTIVE
      })
      .select({ _id: 1 })
      .lean();
    if (!matchedUsers.length) return [];

    const hashKeys = matchedUsers.map(user => ConversationService.buildHashKey(userId, user._id));
    const conversations = await this.conversationModel
      .find({ hashKey: { $in: hashKeys } })
      .select({ _id: 1 })
      .lean();

    return conversations.map(item => item._id);
  }

  private emptyPage(total?: number): PageableData<ConversationDto> {
    return {
      data: [],
      total,
      hasMore: false,
      nextCursor: null,
      paginationInfo: {
        maxOffset: PAGINATION_DEFAULTS.MAX_OFFSET,
        cursorPaginationAvailable: true
      }
    } as PageableData<ConversationDto>;
  }
}
