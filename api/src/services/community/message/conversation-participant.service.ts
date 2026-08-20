import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { ConversationParticipant, ConversationParticipantDocument } from 'src/schemas/community/message';

/** Authoritative unread totals for one user. */
export interface MessageUnreadTotals {
  /** Sum of unread messages across every conversation. */
  totalUnreadMessages: number;
  /** How many conversations have at least one unread message. */
  totalUnreadConversations: number;
}

/**
 * Per-user read state for conversations.
 *
 * The server is the only authority on unread here. The client never derives a
 * count from message payloads it happens to receive, because a replayed socket
 * frame would then be able to re-raise a count the reader has already cleared —
 * the row and the badge would disagree and the user would have no way to fix it.
 */
@Injectable()
export class ConversationParticipantService {
  constructor(
    @InjectModel(ConversationParticipant.name)
    private readonly participantModel: Model<ConversationParticipantDocument>
  ) {}

  /**
   * Make sure both people have a row for a conversation.
   *
   * Called when a conversation is opened, not only when it is first used: the
   * list is built from these rows, so without one a freshly created
   * conversation would be invisible until somebody sent something.
   *
   * `lastMessageAt` is seeded with the creation time rather than left null.
   * It is the field the list orders and pages by, and a null would either sort
   * the new conversation to the very bottom or force the query off its index.
   * Opening a conversation is genuine activity, so using that moment is honest
   * — no message or preview text is invented, and the row still renders as
   * empty until something is actually said.
   */
  public async ensureParticipants(
    conversationId: string | ObjectId,
    userIds: Array<string | ObjectId>,
    at: Date
  ): Promise<void> {
    await Promise.all(userIds.map(userId => this.participantModel.updateOne(
      { conversationId: toObjectId(conversationId), userId: toObjectId(userId) },
      {
        $setOnInsert: {
          conversationId: toObjectId(conversationId),
          userId: toObjectId(userId),
          unreadCount: 0,
          lastMessageAt: at
        }
      },
      { upsert: true }
    )));
  }

  /**
   * Record a new message against both participants.
   *
   * One upsert each, guarded by the unique `(conversationId, userId)` index:
   * without that constraint two concurrent messages could each insert a row for
   * the same recipient and split their unread count across two documents.
   *
   * The sender's row is touched too, and deliberately not incremented — sending
   * is reading. It also keeps their `lastMessageAt` current so the conversation
   * rises to the top of their own list.
   */
  public async recordMessage(
    conversationId: string | ObjectId,
    senderId: string | ObjectId,
    recipientId: string | ObjectId,
    createdAt: Date
  ): Promise<void> {
    await Promise.all([
      this.participantModel.updateOne(
        { conversationId: toObjectId(conversationId), userId: toObjectId(senderId) },
        {
          $set: { lastMessageAt: createdAt, lastReadAt: createdAt, unreadCount: 0 },
          $setOnInsert: {
            conversationId: toObjectId(conversationId),
            userId: toObjectId(senderId)
          }
        },
        { upsert: true }
      ),
      this.participantModel.updateOne(
        { conversationId: toObjectId(conversationId), userId: toObjectId(recipientId) },
        {
          $inc: { unreadCount: 1 },
          $set: { lastMessageAt: createdAt },
          $setOnInsert: {
            conversationId: toObjectId(conversationId),
            userId: toObjectId(recipientId)
          }
        },
        { upsert: true }
      )
    ]);
  }

  /**
   * Mark one conversation read for one user.
   *
   * Scoped to the caller's own row, so reading never touches how the other
   * participant sees the conversation. Idempotent: calling it on an
   * already-read conversation reports zero cleared and changes nothing.
   */
  public async markConversationRead(
    conversationId: string | ObjectId,
    userId: string | ObjectId
  ): Promise<{ cleared: number }> {
    const row = await this.participantModel.findOneAndUpdate(
      { conversationId: toObjectId(conversationId), userId: toObjectId(userId) },
      { $set: { unreadCount: 0, lastReadAt: new Date() } },
      { returnDocument: 'before' }
    ).lean();

    return { cleared: row?.unreadCount || 0 };
  }

  /**
   * Mark every conversation read for one user.
   *
   * Filtered to rows that are actually unread so the write touches only what it
   * needs to, and so the returned count reports real work rather than the size
   * of the user's inbox.
   */
  public async markAllRead(userId: string | ObjectId): Promise<{ updated: number }> {
    const result = await this.participantModel.updateMany(
      { userId: toObjectId(userId), unreadCount: { $gt: 0 } },
      { $set: { unreadCount: 0, lastReadAt: new Date() } }
    );

    return { updated: result.modifiedCount || 0 };
  }

  /**
   * Unread totals for the header indicator.
   *
   * Both numbers are returned because they answer different questions and the
   * backend should not lose one just because today's UI only renders a dot:
   * `totalUnreadMessages` is how many messages are waiting, and
   * `totalUnreadConversations` is how many people are waiting. The dot is
   * `totalUnreadMessages > 0`.
   *
   * A single grouped aggregate over the `{userId, unreadCount}` index, so it
   * never touches the conversation or message collections.
   */
  public async getUnreadTotals(userId: string | ObjectId): Promise<MessageUnreadTotals> {
    const [result] = await this.participantModel.aggregate<{
      totalUnreadMessages: number;
      totalUnreadConversations: number;
    }>([
      { $match: { userId: toObjectId(userId), unreadCount: { $gt: 0 } } },
      {
        $group: {
          _id: null,
          totalUnreadMessages: { $sum: '$unreadCount' },
          totalUnreadConversations: { $sum: 1 }
        }
      }
    ]);

    return {
      totalUnreadMessages: result?.totalUnreadMessages || 0,
      totalUnreadConversations: result?.totalUnreadConversations || 0
    };
  }

  /** This user's unread count for one conversation. */
  public async getConversationUnread(
    conversationId: string | ObjectId,
    userId: string | ObjectId
  ): Promise<number> {
    const row = await this.participantModel.findOne({
      conversationId: toObjectId(conversationId),
      userId: toObjectId(userId)
    }).select({ unreadCount: 1 }).lean();

    return row?.unreadCount || 0;
  }
}
