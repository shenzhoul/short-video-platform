import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { Conversation, ConversationDocument } from 'src/schemas/community/message';
import { FollowService } from 'src/services/community/follow';

/** Why a send was refused. */
export type MessageRestrictionReason = 'awaiting_reply';

/**
 * Where a conversation stands.
 *
 * - `mutual`   — the pair follow each other; the request flow does not apply.
 * - `accepted` — the request was answered, so both may message freely.
 * - `waiting`  — one participant has spent their single request message.
 * - `idle`     — non-mutual, unanswered, nobody waiting: one request may be sent.
 */
export type MessageRequestState = 'mutual' | 'accepted' | 'waiting' | 'idle';

/** Read-only description of what a participant may currently do. */
export interface MessagePermissionState {
  isMutualFollow: boolean;
  canSend: boolean;
  requestState: MessageRequestState;
  /**
   * Who is waiting for a reply, from this user's point of view. `me` means this
   * user sent the request and is waiting; `them` means this user has a request
   * to answer.
   */
  awaitingReplyFrom: 'me' | 'them' | null;
  restrictionReason: MessageRestrictionReason | null;
}

/** What the claim changed, so a failed send can put it back. */
export type MessageClaimTransition = 'none' | 'mutual-clear' | 'request-sent' | 'request-accepted';

/** Outcome of an attempt to claim the right to send. */
export interface MessageSendClaim {
  allowed: boolean;
  isMutualFollow: boolean;
  requestState: MessageRequestState;
  restrictionReason: MessageRestrictionReason | null;
  transition: MessageClaimTransition;
  /** `pendingSenderId` before the claim, for compensation. */
  previousPendingSenderId: ObjectId | null;
}

/**
 * Decides whether one user may send to another, and enforces it.
 *
 * The rule is a message *request*, not a per-message allowance:
 *
 *  - Mutual followers message freely.
 *  - Otherwise the initiator may send **one** message and then waits.
 *  - The recipient **replying** accepts the request, and from then on both
 *    message freely. Reading it does not — looking at a request is not
 *    agreeing to it.
 *
 * Two properties drive the implementation.
 *
 * First, the waiting state belongs to a *sender*, not to the conversation:
 * modelling it as "the conversation is locked" would leave the recipient unable
 * to answer, which is precisely backwards. Hence `pendingSenderId`.
 *
 * Second, acceptance is evaluated against the follow relation as it stands
 * *now*. `requestAccepted` is not an "unlocked forever" flag: when a pair stops
 * being mutual the conversation is reset to `idle`, so freedom that came from a
 * follow does not outlive it.
 *
 * Deliberately never derived from a message count. `messages.length > 1` and
 * `totalMessages === 1` both break on deleted messages, on paginated history,
 * on media retries, and on history from a period when the pair was mutual.
 */
@Injectable()
export class MessagePermissionService {
  constructor(
    @InjectModel(Conversation.name)
    private readonly conversationModel: Model<ConversationDocument>,
    private readonly followService: FollowService
  ) {}

  /**
   * Describe permission without changing anything.
   *
   * Advisory only — the server decides again inside {@link claimSendSlot},
   * because between this read and the send the pair may unfollow, or another
   * tab may spend the request.
   */
  public describe(
    conversation: Pick<Conversation, 'pendingSenderId' | 'requestAccepted'> | null,
    userId: string | ObjectId,
    isMutualFollow: boolean
  ): MessagePermissionState {
    if (isMutualFollow) {
      return {
        isMutualFollow: true,
        canSend: true,
        requestState: 'mutual',
        awaitingReplyFrom: null,
        restrictionReason: null
      };
    }

    if (conversation?.requestAccepted) {
      return {
        isMutualFollow: false,
        canSend: true,
        requestState: 'accepted',
        awaitingReplyFrom: null,
        restrictionReason: null
      };
    }

    const pending = conversation?.pendingSenderId;
    if (!pending) {
      return {
        isMutualFollow: false,
        canSend: true,
        requestState: 'idle',
        awaitingReplyFrom: null,
        restrictionReason: null
      };
    }

    const mine = pending.toString() === userId.toString();
    return {
      isMutualFollow: false,
      canSend: !mine,
      requestState: 'waiting',
      awaitingReplyFrom: mine ? 'me' : 'them',
      restrictionReason: mine ? 'awaiting_reply' : null
    };
  }

  /** Live permission for one conversation, follow state included. */
  public async describeForPair(
    conversation: Pick<Conversation, 'pendingSenderId' | 'requestAccepted'> | null,
    userId: string | ObjectId,
    otherUserId: string | ObjectId
  ): Promise<MessagePermissionState> {
    const isMutualFollow = await this.followService.areMutuallyFollowing(userId, otherUserId);
    return this.describe(conversation, userId, isMutualFollow);
  }

  /**
   * Atomically take the right to send, or refuse.
   *
   * Three conditional single-document updates, tried in order. Each is atomic on
   * its own, which is what makes concurrent sends safe without a transaction:
   *
   *  1. **Accept** — `requestAccepted:false` and someone *else* is waiting. This
   *     is the recipient answering, so the request opens for both.
   *  2. **Already accepted** — nothing to change; allow.
   *  3. **Send the request** — `requestAccepted:false` and nobody waiting. The
   *     sender becomes the waiter. Exactly one of a burst can match this,
   *     because the first match writes `pendingSenderId`.
   *
   * If all three miss, the sender is the one already waiting: refused.
   *
   * The single retry covers one narrow race: both participants send a first
   * message at the same instant, one wins step 3, and the loser should be
   * treated as answering rather than refused.
   */
  public async claimSendSlot(
    conversationId: string | ObjectId,
    senderId: string | ObjectId,
    recipientId: string | ObjectId
  ): Promise<MessageSendClaim> {
    const isMutualFollow = await this.followService.areMutuallyFollowing(senderId, recipientId);
    const id = toObjectId(conversationId);
    const sender = toObjectId(senderId);

    if (isMutualFollow) {
      // Mutual permission overrides the request flow. The stale waiting state is
      // cleared so a later unfollow restarts from "nobody is waiting".
      const previous = await this.conversationModel.findOneAndUpdate(
        { _id: id },
        { $set: { pendingSenderId: null } },
        { returnDocument: 'before' }
      ).lean();

      return {
        allowed: true,
        isMutualFollow: true,
        requestState: 'mutual',
        restrictionReason: null,
        transition: previous?.pendingSenderId ? 'mutual-clear' : 'none',
        previousPendingSenderId: previous?.pendingSenderId ?? null
      };
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      // 1. The other participant is waiting: this send answers, and accepts.
      const accepted = await this.conversationModel.findOneAndUpdate(
        {
          _id: id,
          requestAccepted: { $ne: true },
          pendingSenderId: { $nin: [null, sender] }
        },
        { $set: { requestAccepted: true, pendingSenderId: null } },
        { returnDocument: 'before' }
      ).lean();

      if (accepted) {
        return {
          allowed: true,
          isMutualFollow: false,
          requestState: 'accepted',
          restrictionReason: null,
          transition: 'request-accepted',
          previousPendingSenderId: accepted.pendingSenderId ?? null
        };
      }

      // 2. Already accepted: both sides are free, nothing to change.
      const open = await this.conversationModel
        .findOne({ _id: id, requestAccepted: true })
        .select({ _id: 1 })
        .lean();

      if (open) {
        return {
          allowed: true,
          isMutualFollow: false,
          requestState: 'accepted',
          restrictionReason: null,
          transition: 'none',
          previousPendingSenderId: null
        };
      }

      // 3. Nobody waiting: send the one request message.
      const claimed = await this.conversationModel.findOneAndUpdate(
        { _id: id, requestAccepted: { $ne: true }, pendingSenderId: null },
        { $set: { pendingSenderId: sender } },
        { returnDocument: 'before' }
      ).lean();

      if (claimed) {
        return {
          allowed: true,
          isMutualFollow: false,
          requestState: 'waiting',
          restrictionReason: null,
          transition: 'request-sent',
          previousPendingSenderId: null
        };
      }

      // Nothing matched. Either this sender is the one waiting — in which case
      // the retry will miss identically and we refuse — or the pair raced and
      // the state has moved on, which the retry picks up as an acceptance.
      const stillWaiting = await this.conversationModel
        .findOne({ _id: id, pendingSenderId: sender, requestAccepted: { $ne: true } })
        .select({ _id: 1 })
        .lean();
      if (stillWaiting) break;
    }

    return {
      allowed: false,
      isMutualFollow: false,
      requestState: 'waiting',
      restrictionReason: 'awaiting_reply',
      transition: 'none',
      previousPendingSenderId: null
    };
  }

  /**
   * Undo a claim whose message was never written.
   *
   * The claim has to be taken before the insert — inserting first would let two
   * concurrent sends both write a message before either claim resolved, which is
   * the race the claim exists to prevent. The cost is this compensation: without
   * it a failed insert would leave the sender waiting for a reply to a message
   * that does not exist, or leave a request marked accepted that nobody actually
   * answered.
   *
   * Every branch is guarded on the state the claim itself produced, so a slow
   * rollback cannot overwrite a *newer* legitimate transition. If the guard does
   * not match, the state has moved on and there is nothing to undo.
   *
   * Best-effort by design: the caller logs a failure and never lets it mask the
   * original error.
   */
  public async releaseSendSlot(
    conversationId: string | ObjectId,
    senderId: string | ObjectId,
    claim: Pick<MessageSendClaim, 'transition' | 'previousPendingSenderId'>
  ): Promise<boolean> {
    const id = toObjectId(conversationId);
    const sender = toObjectId(senderId);
    const previous = claim.previousPendingSenderId ? toObjectId(claim.previousPendingSenderId) : null;

    if (claim.transition === 'none') return false;

    if (claim.transition === 'request-accepted') {
      const result = await this.conversationModel.updateOne(
        { _id: id, requestAccepted: true, pendingSenderId: null },
        { $set: { requestAccepted: false, pendingSenderId: previous } }
      );
      return result.modifiedCount > 0;
    }

    if (claim.transition === 'request-sent') {
      const result = await this.conversationModel.updateOne(
        { _id: id, pendingSenderId: sender, requestAccepted: { $ne: true } },
        { $set: { pendingSenderId: null } }
      );
      return result.modifiedCount > 0;
    }

    // mutual-clear: put back whoever was waiting before the mutual send.
    const result = await this.conversationModel.updateOne(
      { _id: id, pendingSenderId: null },
      { $set: { pendingSenderId: previous } }
    );
    return result.modifiedCount > 0;
  }

  /**
   * Return a pair's conversation to an unanswered request.
   *
   * Called when the pair stops being mutual. Freedom that came from a follow
   * must not outlive it, so acceptance is cleared and nobody is left waiting —
   * the next sender gets one request message again. History is untouched.
   */
  public async resetRequestState(conversationId: string | ObjectId): Promise<boolean> {
    const result = await this.conversationModel.updateOne(
      { _id: toObjectId(conversationId) },
      { $set: { requestAccepted: false, pendingSenderId: null } }
    );
    return result.modifiedCount > 0;
  }
}
