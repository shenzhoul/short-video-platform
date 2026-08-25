import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import {
  RELATIONSHIP_CHANNELS,
  RELATIONSHIP_EVENTS,
  RELATIONSHIP_TYPES,
  RelationshipType
} from 'src/common/constants/community';
import { QueueMessageService } from 'src/kernel';
import { toObjectId } from 'src/kernel/helpers/string.helper';
import { UserRelationship, UserRelationshipDocument } from 'src/schemas/community/relationship';

/**
 * How a pair stands, from one viewer's point of view.
 *
 * Both directions are reported because they mean different things to the UI:
 * "you blocked them" offers an Unblock action, "they blocked you" must not even
 * admit that it happened.
 */
export interface RelationshipState {
  /** The viewer blocked the other person. */
  blockedByMe: boolean;
  /** The other person blocked the viewer. */
  blockedMe: boolean;
  /** The viewer restricted the other person. */
  restrictedByMe: boolean;
  /** The other person restricted the viewer. */
  restrictedMe: boolean;
}

const EMPTY_STATE: RelationshipState = {
  blockedByMe: false,
  blockedMe: false,
  restrictedByMe: false,
  restrictedMe: false
};

/**
 * Blocks and restricts between two users.
 *
 * These are the only two privacy flags the product has, and both are stored as
 * plain one-way rows. Nothing here interprets them — that is the permission
 * service's job — so this service stays a small, well-indexed relation store
 * that other domains can read without inheriting messaging's rules.
 *
 * Every write is idempotent: setting a flag that is already set is a no-op
 * rather than an error, because the caller is a button that can be double
 * clicked and the intent ("make it so") is satisfied either way.
 */
@Injectable()
export class UserRelationshipService {
  constructor(
    @InjectModel(UserRelationship.name)
    private readonly relationshipModel: Model<UserRelationshipDocument>,
    private readonly queueMessageService: QueueMessageService
  ) {}

  /**
   * Set a flag. Returns true when this call is what created it.
   *
   * Idempotent in both senses. The upsert makes a repeat call a no-op, and the
   * duplicate-key catch makes *concurrent* calls one too: two clicks landing on
   * two instances at the same instant both pass the upsert's existence check,
   * and one then loses the race against `uniq_userId_targetId_type`. That is the
   * index doing its job, not a failure — the caller asked for the flag to exist,
   * and it does.
   */
  public async set(
    userId: string | ObjectId,
    targetId: string | ObjectId,
    type: RelationshipType
  ): Promise<boolean> {
    // Self-flags are meaningless and would let a user lock themselves out of
    // their own conversations, so they are dropped rather than stored.
    if (userId.toString() === targetId.toString()) return false;

    try {
      const result = await this.relationshipModel.updateOne(
        { userId: toObjectId(userId), targetId: toObjectId(targetId), type },
        { $setOnInsert: { createdAt: new Date() }, $set: { updatedAt: new Date() } },
        { upsert: true }
      );

      return Boolean(result.upsertedCount);
    } catch (error: any) {
      // 11000 is the unique index refusing a second row. The row exists, which
      // is what was wanted; anything else is a real error.
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  /**
   * Clear a flag. Returns true when there was one to clear.
   *
   * `deleteMany`, not `deleteOne`. The unique index means there should only ever
   * be one row, but a database that ran this code before the index existed could
   * hold duplicates, and removing them one per click would leave somebody
   * blocked with a UI insisting they are not.
   */
  public async clear(
    userId: string | ObjectId,
    targetId: string | ObjectId,
    type: RelationshipType
  ): Promise<boolean> {
    const result = await this.relationshipModel.deleteMany({
      userId: toObjectId(userId),
      targetId: toObjectId(targetId),
      type
    });

    // Published only when something was actually cleared, so a repeated
    // Unblock cannot make other domains act twice. Lifting a flag can make an
    // announcement true that was correctly refused while it was up — the
    // message domain listens for exactly that.
    if (result.deletedCount > 0) {
      await this.queueMessageService.publish(RELATIONSHIP_CHANNELS.RELATIONSHIP, {
        eventName: RELATIONSHIP_EVENTS.CLEARED,
        data: {
          userId: userId.toString(),
          targetId: targetId.toString(),
          type
        }
      }).catch(() => {
        // The flag is cleared either way; a missed announcement is not worth
        // failing the request the user actually made.
      });
    }

    return result.deletedCount > 0;
  }

  /**
   * Both directions of both flags, in one query.
   *
   * One `$or` rather than four `findOne` calls: this runs on every send and on
   * every conversation row the client renders, so it is worth keeping to a
   * single round trip.
   */
  public async getState(
    viewerId: string | ObjectId,
    otherId: string | ObjectId
  ): Promise<RelationshipState> {
    if (!viewerId || !otherId || viewerId.toString() === otherId.toString()) {
      return { ...EMPTY_STATE };
    }

    const viewer = toObjectId(viewerId);
    const other = toObjectId(otherId);

    const rows = await this.relationshipModel
      .find({
        $or: [
          { userId: viewer, targetId: other },
          { userId: other, targetId: viewer }
        ]
      })
      .select({ userId: 1, targetId: 1, type: 1 })
      .lean();

    return rows.reduce<RelationshipState>((state, row) => {
      const mine = row.userId.toString() === viewer.toString();
      if (row.type === RELATIONSHIP_TYPES.BLOCK) {
        if (mine) state.blockedByMe = true;
        else state.blockedMe = true;
      } else if (row.type === RELATIONSHIP_TYPES.RESTRICT) {
        if (mine) state.restrictedByMe = true;
        else state.restrictedMe = true;
      }
      return state;
    }, { ...EMPTY_STATE });
  }

  /**
   * The states for many counterparts at once, keyed by the other user's id.
   *
   * For list surfaces — the share recipient list, the conversation list — where
   * asking per row would be an N+1 the moment somebody has a few conversations.
   */
  public async getStateMap(
    viewerId: string | ObjectId,
    otherIds: Array<string | ObjectId>
  ): Promise<Map<string, RelationshipState>> {
    const map = new Map<string, RelationshipState>();
    const ids = (otherIds || [])
      .filter(Boolean)
      .map(id => id.toString())
      .filter(id => id !== viewerId.toString());

    if (!ids.length) return map;

    const viewer = toObjectId(viewerId);
    const targets = ids.map(id => toObjectId(id));

    const rows = await this.relationshipModel
      .find({
        $or: [
          { userId: viewer, targetId: { $in: targets } },
          { userId: { $in: targets }, targetId: viewer }
        ]
      })
      .select({ userId: 1, targetId: 1, type: 1 })
      .lean();

    ids.forEach(id => map.set(id, { ...EMPTY_STATE }));

    rows.forEach(row => {
      const mine = row.userId.toString() === viewer.toString();
      const otherId = mine ? row.targetId.toString() : row.userId.toString();
      const state = map.get(otherId);
      if (!state) return;

      if (row.type === RELATIONSHIP_TYPES.BLOCK) {
        if (mine) state.blockedByMe = true;
        else state.blockedMe = true;
      } else if (row.type === RELATIONSHIP_TYPES.RESTRICT) {
        if (mine) state.restrictedByMe = true;
        else state.restrictedMe = true;
      }
    });

    return map;
  }
}
