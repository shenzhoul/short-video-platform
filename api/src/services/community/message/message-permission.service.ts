import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { Conversation, ConversationDocument } from 'src/schemas/community/message';
import { FollowService } from 'src/services/community/follow';
import { RelationshipState, UserRelationshipService } from 'src/services/community/relationship';

/** Why a send was refused. */
export type MessageRestrictionReason = 'awaiting_reply' | 'blocked' | 'restricted';

/**
 * Where a conversation stands, from one participant's point of view.
 *
 * - `blocked`    — one side blocked the other; nothing may be sent either way.
 * - `restricted` — the other side restricted this user; they may not send.
 * - `accepted`   — the request was answered, so both may message freely.
 * - `mutual`     — the pair follow each other; the request flow does not apply.
 * - `waiting`    — one participant has spent their single request message.
 * - `idle`       — unanswered, nobody waiting: one request may be sent.
 *
 * Listed in evaluation order, which is also the order they override each other.
 */
export type MessageRequestState =
  | 'blocked'
  | 'restricted'
  | 'accepted'
  | 'mutual'
  | 'waiting'
  | 'idle';

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
  /** The viewer's own flags, so the thread can offer Unblock / Unrestrict. */
  blockedByMe: boolean;
  restrictedByMe: boolean;
}

/** What the claim changed, so a failed send can put it back. */
export type MessageClaimTransition =
  | 'none'
  | 'mutual-clear'
  | 'mutual-accept'
  | 'request-sent'
  | 'request-accepted';

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
 * Two independent ideas, deliberately kept apart:
 *
 * **Consent** is whether this pair has agreed to talk. A mutual follow grants it
 * implicitly; otherwise the initiator sends **one** request and waits, and the
 * recipient *replying* accepts it. Acceptance is durable — it survives an
 * unfollow, because agreeing to talk is not the same act as following someone,
 * and silently withdrawing consent when a follow changes made the rule
 * impossible to explain.
 *
 * **Flags** are the two blunt controls a user has over their own inbox: block
 * (hard, both directions) and restrict (one-way, quiet). These sit *above*
 * consent and above mutual follow — a user who restricts someone must not have
 * that undone by the two of them happening to follow each other, and answering a
 * restricted person must not silently readmit them. Only an explicit unblock or
 * unrestrict gives the permission back.
 *
 * That yields one fixed evaluation order, used by both {@link describe} and
 * {@link claimSendSlot}:
 *
 * ```text
 * blocked? -> restricted? -> accepted? -> mutual? -> nobody waiting? -> refuse
 * ```
 *
 * The waiting state belongs to a *sender*, not to the conversation: modelling it
 * as "the conversation is locked" would leave the recipient unable to answer,
 * which is precisely backwards. Hence `pendingSenderId`.
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
    private readonly followService: FollowService,
    private readonly relationshipService: UserRelationshipService
  ) {}

  /**
   * Describe permission without changing anything.
   *
   * Advisory only — the server decides again inside {@link claimSendSlot},
   * because between this read and the send the other person may block, restrict,
   * or another tab may spend the request.
   */
  public describe(
    conversation: Pick<Conversation, 'pendingSenderId' | 'requestAccepted'> | null,
    userId: string | ObjectId,
    isMutualFollow: boolean,
    relationship: RelationshipState
  ): MessagePermissionState {
    const base = {
      isMutualFollow,
      blockedByMe: relationship.blockedByMe,
      restrictedByMe: relationship.restrictedByMe
    };

    // A block stops the conversation in both directions, whoever set it.
    if (relationship.blockedByMe || relationship.blockedMe) {
      return {
        ...base,
        canSend: false,
        requestState: 'blocked',
        awaitingReplyFrom: null,
        restrictionReason: 'blocked'
      };
    }

    // Being restricted stops this user sending. Restricting somebody else does
    // not stop the restricter from writing to them.
    if (relationship.restrictedMe) {
      return {
        ...base,
        canSend: false,
        requestState: 'restricted',
        awaitingReplyFrom: null,
        restrictionReason: 'restricted'
      };
    }

    // Consent, once given, outranks the follow relation — an accepted thread
    // stays open whether or not the two still follow each other.
    if (conversation?.requestAccepted) {
      return {
        ...base,
        canSend: true,
        requestState: 'accepted',
        awaitingReplyFrom: null,
        restrictionReason: null
      };
    }

    if (isMutualFollow) {
      return {
        ...base,
        canSend: true,
        requestState: 'mutual',
        awaitingReplyFrom: null,
        restrictionReason: null
      };
    }

    const pending = conversation?.pendingSenderId;
    if (!pending) {
      return {
        ...base,
        canSend: true,
        requestState: 'idle',
        awaitingReplyFrom: null,
        restrictionReason: null
      };
    }

    const mine = pending.toString() === userId.toString();
    return {
      ...base,
      canSend: !mine,
      requestState: 'waiting',
      awaitingReplyFrom: mine ? 'me' : 'them',
      restrictionReason: mine ? 'awaiting_reply' : null
    };
  }

  /** Live permission for one conversation: follow state and flags included. */
  public async describeForPair(
    conversation: Pick<Conversation, 'pendingSenderId' | 'requestAccepted'> | null,
    userId: string | ObjectId,
    otherUserId: string | ObjectId
  ): Promise<MessagePermissionState> {
    const [isMutualFollow, relationship] = await Promise.all([
      this.followService.areMutuallyFollowing(userId, otherUserId),
      this.relationshipService.getState(userId, otherUserId)
    ]);

    return this.describe(conversation, userId, isMutualFollow, relationship);
  }

  /**
   * Can these two message each other freely, right now, in both directions?
   *
   * Read-only and side-effect free: no claim, no pending request, no message, no
   * conversation touched. It exists so callers that need to *describe* the pair —
   * an announcement that the thread is open — can ask the same question the send
   * path asks, instead of assembling their own idea of what block and restrict
   * mean and getting it subtly different.
   *
   * "Freely" is stricter than `canSend`. A stranger with an unspent request has
   * `canSend: true` and is still one message from being refused, so only the two
   * genuinely open states count: an accepted request, or a live mutual follow.
   *
   * Both directions are required. A restriction is one-way, so a pair where only
   * one of them is silenced would pass a single-sided check while half of any
   * claim made about them is false.
   */
  public async canUsersChatFreely(
    userAId: string | ObjectId,
    userBId: string | ObjectId
  ): Promise<boolean> {
    if (!userAId || !userBId || userAId.toString() === userBId.toString()) return false;

    const [isMutualFollow, relationship, conversation] = await Promise.all([
      this.followService.areMutuallyFollowing(userAId, userBId),
      this.relationshipService.getState(userAId, userBId),
      this.conversationModel
        .findOne({ recipientIds: { $all: [toObjectId(userAId), toObjectId(userBId)] } })
        .select({ pendingSenderId: 1, requestAccepted: 1 })
        .lean()
    ]);

    // The flags are read once and mirrored rather than queried twice: they are
    // the same two rows seen from the other side.
    const mirrored: RelationshipState = {
      blockedByMe: relationship.blockedMe,
      blockedMe: relationship.blockedByMe,
      restrictedByMe: relationship.restrictedMe,
      restrictedMe: relationship.restrictedByMe
    };

    const forA = this.describe(conversation, userAId, isMutualFollow, relationship);
    const forB = this.describe(conversation, userBId, isMutualFollow, mirrored);

    return [forA, forB].every(state => (
      state.canSend && (state.requestState === 'mutual' || state.requestState === 'accepted')
    ));
  }

  /**
   * Atomically take the right to send, or refuse.
   *
   * The flag checks come first and are plain reads: a block or a restrict is not
   * a slot to be claimed, it is a wall, and there is no state to mutate.
   *
   * What follows is three conditional single-document updates, tried in order.
   * Each is atomic on its own, which is what makes concurrent sends safe without
   * a transaction:
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
    const [isMutualFollow, relationship] = await Promise.all([
      this.followService.areMutuallyFollowing(senderId, recipientId),
      this.relationshipService.getState(senderId, recipientId)
    ]);

    if (relationship.blockedByMe || relationship.blockedMe) {
      return this.refuse('blocked', 'blocked', isMutualFollow);
    }

    if (relationship.restrictedMe) {
      return this.refuse('restricted', 'restricted', isMutualFollow);
    }

    const id = toObjectId(conversationId);
    const sender = toObjectId(senderId);

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
          isMutualFollow,
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
          isMutualFollow,
          requestState: 'accepted',
          restrictionReason: null,
          transition: 'none',
          previousPendingSenderId: null
        };
      }

      // 3. Mutual followers bypass the request flow. Checked after acceptance so
      // an already-accepted thread keeps reporting `accepted`, which is the
      // state that survives a later unfollow.
      if (isMutualFollow) {
        // 3a. This send answers somebody else's message, so the pair have now
        // spoken both ways — that *is* consent, and it has to be recorded even
        // though the mutual follow is what allowed it. Leaving it unrecorded
        // meant a conversation that had been running for months dropped back to
        // a fresh request the moment either of them unfollowed, and it left the
        // live rule disagreeing with the migration backfill, which reads exactly
        // this evidence: at least one message from each side.
        //
        // Keyed on `lastSenderId` rather than a message query: it is already on
        // the conversation, and "the previous message was not mine" is true for
        // the first time precisely when the second participant speaks.
        const accepted = await this.conversationModel.findOneAndUpdate(
          {
            _id: id,
            requestAccepted: { $ne: true },
            lastSenderId: { $nin: [null, sender] }
          },
          { $set: { requestAccepted: true, pendingSenderId: null } },
          { returnDocument: 'before' }
        ).lean();

        if (accepted) {
          return {
            allowed: true,
            isMutualFollow: true,
            requestState: 'accepted',
            restrictionReason: null,
            transition: 'mutual-accept',
            previousPendingSenderId: accepted.pendingSenderId ?? null
          };
        }

        // 3b. Nothing to record yet — first message, or the same person talking
        // again. The stale waiting state is cleared so a later unfollow restarts
        // from "nobody is waiting" rather than stranding whoever asked first.
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

      // 4. Nobody waiting: send the one request message.
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

    return this.refuse('waiting', 'awaiting_reply', isMutualFollow);
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

    // Both acceptance transitions undo the same way; they differ only in which
    // branch produced them.
    if (claim.transition === 'request-accepted' || claim.transition === 'mutual-accept') {
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

  /** A refusal carries the state that caused it, so the client can explain it. */
  private refuse(
    requestState: MessageRequestState,
    reason: MessageRestrictionReason,
    isMutualFollow: boolean
  ): MessageSendClaim {
    return {
      allowed: false,
      isMutualFollow,
      requestState,
      restrictionReason: reason,
      transition: 'none',
      previousPendingSenderId: null
    };
  }
}
