import { Injectable, Logger } from '@nestjs/common';
import { ObjectId } from 'mongodb';
import { STATUS } from 'src/kernel/constants';
import { SharedPostDto } from 'src/dtos/community/message';
import { PostDto } from 'src/dtos/content/post.dto';
import { UserDto } from 'src/dtos/identity/user';
import { PostService } from 'src/services/content/post/post.service';
import { BaseUserService } from 'src/services/identity/user/base-user.service';

import { UserRelationshipService } from '../relationship';

/**
 * Turns `postId` on a message into the card a particular reader may see.
 *
 * Resolved on every read rather than snapshotted at share time. That is the
 * whole design: a post can be deleted or its author suspended long after it was
 * shared, and a copy stored on the message would keep serving content that has
 * been withdrawn — in a place nobody would think to look when handling a
 * takedown.
 *
 * Availability is decided per *reader*, not per message, because the two people
 * in a conversation do not necessarily have the same access: the author may have
 * blocked one of them.
 *
 * Everything here is batched. A page of thread history can hold many shared
 * posts, and resolving them one at a time is the classic N+1 on a screen that
 * scrolls.
 */
@Injectable()
export class SharedPostService {
  private readonly logger = new Logger(SharedPostService.name);

  constructor(
    private readonly postService: PostService,
    private readonly baseUserService: BaseUserService,
    private readonly relationshipService: UserRelationshipService
  ) {}

  /**
   * Cards for many posts at once, keyed by post id.
   *
   * A post that cannot be resolved is still present in the map, as an
   * unavailable card — the caller renders a placeholder rather than dropping the
   * message, because the message itself is real history.
   */
  public async resolveMany(
    postIds: Array<string | ObjectId>,
    viewerId: string | ObjectId
  ): Promise<Map<string, SharedPostDto>> {
    const cards = new Map<string, SharedPostDto>();
    const ids = [...new Set((postIds || []).filter(Boolean).map(id => id.toString()))];
    if (!ids.length) return cards;

    let posts: PostDto[] = [];
    try {
      posts = await this.postService.findByIds(ids);
    } catch (error) {
      // A failed post lookup must not take the whole conversation down with it.
      // Every card falls back to "unavailable", which is a state the client
      // already renders.
      this.logger.error(`Failed to resolve shared posts: ${error.message}`, error.stack);
      ids.forEach(id => cards.set(id, SharedPostDto.unavailable(id, 'deleted')));
      return cards;
    }

    const postMap = new Map(posts.map(post => [post._id.toString(), post]));
    const authorIds = [...new Set(
      posts.map(post => post.userId?.toString()).filter(Boolean) as string[]
    )];

    const [authors, relationshipMap] = await Promise.all([
      authorIds.length ? this.baseUserService.findByIds(authorIds) : Promise.resolve([]),
      this.relationshipService.getStateMap(viewerId, authorIds)
    ]);
    const authorMap = new Map(
      (authors as UserDto[]).map(author => [author._id.toString(), author])
    );

    ids.forEach(id => {
      const post = postMap.get(id);

      // Gone, or its author's account was removed: nothing to show, and the
      // reason is the same for everybody.
      if (!post || post.status !== STATUS.ACTIVE || post.isCreatorDeleted) {
        cards.set(id, SharedPostDto.unavailable(id, 'deleted'));
        return;
      }

      const authorId = post.userId?.toString();

      // A block hides the author's content from this reader specifically, which
      // is why availability cannot be computed once and shared between the two
      // participants of a conversation.
      const relationship = authorId ? relationshipMap.get(authorId) : null;
      if (relationship?.blockedByMe || relationship?.blockedMe) {
        cards.set(id, SharedPostDto.unavailable(id, 'not_accessible'));
        return;
      }

      cards.set(id, SharedPostDto.fromPost(post, authorId ? authorMap.get(authorId) : null));
    });

    return cards;
  }

  /** One card. Convenience over {@link resolveMany} for the single-share path. */
  public async resolveOne(
    postId: string | ObjectId,
    viewerId: string | ObjectId
  ): Promise<SharedPostDto> {
    const cards = await this.resolveMany([postId], viewerId);
    return cards.get(postId.toString()) || SharedPostDto.unavailable(postId.toString(), 'deleted');
  }

  /**
   * Can this pair exchange this post at all?
   *
   * Checked before a share is written, and separately from rendering: the sender
   * must be able to see it *and* so must the recipient, otherwise the share
   * lands as a card the recipient can never open. Returning the sender's own
   * card too saves the caller a second lookup for the message it is about to
   * create.
   */
  public async assertShareable(
    postId: string | ObjectId,
    senderId: string | ObjectId,
    recipientId: string | ObjectId
  ): Promise<{ ok: true; card: SharedPostDto } | { ok: false; reason: 'deleted' | 'not_accessible' }> {
    const [senderCard, recipientCard] = await Promise.all([
      this.resolveOne(postId, senderId),
      this.resolveOne(postId, recipientId)
    ]);

    if (!senderCard.available) {
      return { ok: false, reason: senderCard.unavailableReason || 'not_accessible' };
    }
    if (!recipientCard.available) {
      // The post exists for the sender, so this is about the pair, never
      // "deleted" — reporting otherwise would be misleading.
      return { ok: false, reason: 'not_accessible' };
    }

    return { ok: true, card: senderCard };
  }
}
