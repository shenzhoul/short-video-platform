import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import {
  MESSAGE_CHANNELS,
  MESSAGE_EVENTS,
  MESSAGE_SYSTEM_EVENTS,
  MESSAGE_TYPES,
  REACTION_TARGET_TYPES,
  REACTION_TYPES
} from 'src/common/constants/community';
import { MessageDto } from 'src/dtos/community/message';
import { QueueMessageService } from 'src/kernel';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { Message, MessageDocument } from 'src/schemas/community/message';
import { Reaction, ReactionDocument } from 'src/schemas';

import { ConversationParticipantService } from './conversation-participant.service';
import { ConversationService } from './conversation.service';
import { MessagePermissionService } from './message-permission.service';
import { resolveSystemNoticeText } from './system-notice-text';

/**
 * Notices the system places in a conversation.
 *
 * Today there is exactly one: the two participants now follow each other, so the
 * thread is open. It exists because that transition is the moment the messaging
 * rules change for a pair, and a thread that silently becomes unrestricted
 * explains nothing.
 *
 * ## It is not a message anybody sent
 *
 * Deliberately does **not** go through `MessageService.send`, and therefore not
 * through `claimSendSlot`. Everything that path does would be wrong here:
 *
 *  - it would spend one participant's single message request;
 *  - it would look like a reply and mark the request accepted;
 *  - it would write `lastSenderId`, which the consent rules read to decide
 *    whether a send is a reply — a notice landing there could accept a request
 *    nobody answered.
 *
 * So the row is written directly, with `senderId: null`, and the conversation's
 * `lastSenderId` is left exactly as the last real message left it. Only
 * user-authored messages ever decide consent.
 *
 * Unread is untouched too. Neither participant has been messaged, so neither
 * should see a badge for it; the conversation still surfaces because its
 * activity time moves.
 *
 * ## Nothing is announced that is not true
 *
 * The wording promises they can start chatting, so the pair must actually be
 * able to — both ways. A block or a restriction in either direction means no
 * notice at all: no message row, no preview change, no activity bump, no socket
 * event, and no `systemEventKey` burned. When the flag is later lifted the
 * announcement can still be made, because nothing was recorded by the refusal.
 *
 * ## Once per conversation, for its whole lifetime
 *
 * A conversation gets at most one mutual-follow notice, ever. Unfollowing and
 * following again does not earn a second one, and neither does a
 * restrict/unrestrict or block/unblock cycle. The sentence is about a
 * relationship reaching a state, not about each time it is re-entered, and a
 * thread repeating it reads as a bug to the people in it.
 *
 * Two things enforce that together: a `systemEventKey` scoped to the
 * conversation, and an explicit check for an existing notice on the thread. The
 * key is what makes concurrent writers safe; the query is what covers rows
 * written under the older per-follow key, which the new key would not collide
 * with.
 */
@Injectable()
export class MessageSystemNoticeService {
  private readonly logger = new Logger(MessageSystemNoticeService.name);

  constructor(
    @InjectModel(Message.name)
    private readonly messageModel: Model<MessageDocument>,
    @InjectModel(Reaction.name)
    private readonly reactionModel: Model<ReactionDocument>,
    private readonly conversationService: ConversationService,
    private readonly participantService: ConversationParticipantService,
    private readonly permissionService: MessagePermissionService,
    private readonly queueMessageService: QueueMessageService
  ) {}

  /**
   * Announce that two people now follow each other.
   *
   * Returns the notice when this call is the one that created it, and `null`
   * when there was nothing to do — the pair are not actually mutual, a block is
   * in the way, or the notice for this occurrence already exists.
   */
  public async announceMutualFollow(
    userA: string | ObjectId,
    userB: string | ObjectId
  ): Promise<MessageDto | null> {
    if (userA.toString() === userB.toString()) return null;

    // Read the follow rows rather than trusting the caller's word for it. Only
    // their existence matters — their ids deliberately no longer identify the
    // notice. See `buildMutualFollowKey`.
    const follows = await this.reactionModel.find({
      objectType: REACTION_TARGET_TYPES.CREATOR,
      action: REACTION_TYPES.FOLLOW,
      $or: [
        { createdBy: toObjectId(userA), objectId: toObjectId(userB) },
        { createdBy: toObjectId(userB), objectId: toObjectId(userA) }
      ]
    }).select({ _id: 1 }).lean();

    if (follows.length < 2) return null;

    // The notice says they can now start chatting, so that has to be true — in
    // both directions. A block stops both of them; a restriction stops one, and
    // a claim that is half false is still false. Asking the permission service
    // rather than re-deriving the rule here is what keeps this in step with what
    // the send path will actually do.
    const conversation = await this.conversationService.findOrCreateDirectConversation(userA, userB);
    const key = MessageSystemNoticeService.buildMutualFollowKey(conversation._id);

    // Checked immediately before the insert, and after the conversation exists,
    // to leave as little room as possible between the decision and the row —
    // a restriction landing in that gap is the race this ordering minimises.
    const canChatFreely = await this.permissionService.canUsersChatFreely(userA, userB);
    if (!canChatFreely) return null;

    // Has this conversation ever been told? A query rather than relying on the
    // unique key alone, because rows written before the key became stable carry
    // a per-follow-epoch key that the new one would not collide with — without
    // this, an old conversation would be announced a second time.
    //
    // Not a substitute for the index: two requests can both read "no notice" and
    // both proceed. The index is what makes only one of them win; this check is
    // what makes the common path a silent no-op rather than a caught error, and
    // what covers the legacy keys the index cannot see.
    const existing = await this.messageModel.findOne({
      conversationId: conversation._id,
      type: MESSAGE_TYPES.SYSTEM,
      systemEvent: MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW
    }).select({ _id: 1 }).lean();
    // A complete no-op: no preview, no activity bump, no unread, no socket
    // event. The conversation must not resurface just because somebody
    // re-followed or a restriction was lifted.
    if (existing) return null;

    const createdAt = new Date();
    let created: MessageDocument;
    try {
      created = await this.messageModel.create({
        conversationId: conversation._id,
        senderId: null,
        type: MESSAGE_TYPES.SYSTEM,
        systemEvent: MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW,
        systemEventKey: key,
        text: '',
        fileIds: [],
        postId: null,
        createdAt,
        updatedAt: createdAt
      });
    } catch (error: any) {
      // The unique key did its job: some other request, tab or retry already
      // announced this same transition. Nothing to add and nothing to report.
      //
      // Narrowed to *this* index on purpose. Treating any duplicate key as
      // success would let an unrelated collision report a notice that was never
      // written, and the caller would have no way to tell.
      if (error?.code === 11000 && error?.keyPattern?.systemEventKey) return null;
      throw error;
    }

    const dto = MessageDto.fromModel(created) as MessageDto;
    // The row stores no wording, so the socket payload has to carry it or the
    // notice arrives blank and renders as nothing until the thread is refetched.
    // Resolved in the default language here — this runs in a background job with
    // no reader to ask; a later read resolves it in that reader's language.
    dto.setSystemText(resolveSystemNoticeText(dto.systemEvent));

    await Promise.all([
      // Preview and ordering only. `lastSenderId` is deliberately absent from
      // this update — see the class comment.
      this.conversationService.applySystemNotice(conversation._id, createdAt),
      // Activity time for both, unread for neither.
      this.participantService.touchActivity(
        conversation._id,
        [userA, userB],
        createdAt
      )
    ]);

    await this.queueMessageService.publish(MESSAGE_CHANNELS.MESSAGE, {
      eventName: MESSAGE_EVENTS.SYSTEM_CREATED,
      data: {
        message: dto,
        conversationId: conversation._id.toString(),
        participantIds: [userA.toString(), userB.toString()]
      }
    });

    return dto;
  }

  /**
   * The key identifying this conversation's mutual-follow notice.
   *
   * Scoped to the conversation, which is what makes it stable. It was previously
   * built from the two follow rows, and that turned out to be the wrong identity:
   * unfollowing deletes a row, so following again produced different ids, a
   * different key, and a second notice. A pair who fell out and made up — or who
   * were restricted, re-followed, and then unrestricted — ended up being told
   * "you can now start chatting" twice in the same thread.
   *
   * A conversation is already the unordered identity of a pair: A/B and B/A
   * resolve to the same row, so no sorting is needed here and follow records can
   * come and go without changing what this returns.
   *
   * One notice per conversation, for the lifetime of the conversation.
   */
  private static buildMutualFollowKey(conversationId: ObjectId | string): string {
    return `${MESSAGE_SYSTEM_EVENTS.MUTUAL_FOLLOW}:${conversationId.toString()}`;
  }
}
