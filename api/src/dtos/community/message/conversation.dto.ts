import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';
import { UserDto } from 'src/dtos/identity/user';
import type { MessagePermissionState } from 'src/services/community/message/message-permission.service';

/**
 * One row of the conversation list, and the header of an open thread.
 *
 * Carries everything a list row renders, so the workspace never issues a
 * follow-up request per conversation. This is also the payload pushed over the
 * socket when a conversation changes, which is why the participant is a trimmed
 * identity rather than a full user.
 *
 * The permission fields are computed per request from the live follow relation
 * and never stored. `canSend` in particular is advisory: it tells the composer
 * whether to offer the input, but the server decides again at send time.
 */
export class ConversationDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj.recipientIds)
  recipientIds: ObjectId[];

  @Expose()
  lastMessage: string;

  @Expose()
  lastMessageType: string | null;

  @Expose()
  @Transform(({ obj }) => obj.lastSenderId)
  lastSenderId: ObjectId | null;

  @Expose()
  lastMessageCreatedAt: Date | null;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  /**
   * The other person in the conversation.
   *
   * Named `participant` rather than `recipient` because from each reader's point
   * of view this is simply the person they are talking to, not the recipient of
   * any particular message.
   */
  @Expose()
  participant?: Partial<UserDto>;

  /** This reader's unread count for this conversation. */
  @Expose()
  unreadCount: number;

  @Expose()
  isMutualFollow: boolean;

  @Expose()
  canSend: boolean;

  @Expose()
  awaitingReplyFrom: 'me' | 'them' | null;

  /**
   * Where the request stands: `mutual`, `accepted`, `waiting` or `idle`.
   *
   * Exposed so both clients can tell "free because we follow each other" from
   * "free because the request was answered" — they look the same to a composer
   * but behave differently the moment a follow changes.
   */
  @Expose()
  requestState: string;

  @Expose()
  restrictionReason: string | null;

  public static fromModel(model: any): ConversationDto | null {
    if (!model) return null;

    return plainToInstance(
      ConversationDto,
      typeof model.toObject === 'function' ? model.toObject() : model,
      { excludeExtraneousValues: true }
    );
  }

  public setParticipant(user: UserDto | null) {
    if (!user) return;
    this.participant = user.toActorResponse();
  }

  public setUnreadCount(total: number) {
    this.unreadCount = Math.max(0, total || 0);
  }

  public setPermission(state: MessagePermissionState) {
    this.isMutualFollow = state.isMutualFollow;
    this.canSend = state.canSend;
    this.requestState = state.requestState;
    this.awaitingReplyFrom = state.awaitingReplyFrom;
    this.restrictionReason = state.restrictionReason;
  }

  /** The other participant's id, from `viewerId`'s point of view. */
  public getOtherParticipantId(viewerId: string | ObjectId): ObjectId | null {
    return this.recipientIds.find(id => id.toString() !== viewerId.toString()) || null;
  }
}
