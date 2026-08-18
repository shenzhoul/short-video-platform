import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ObjectId } from 'mongodb';
import { Model } from 'mongoose';
import { extractAndNormalizeHashtags } from 'src/common/utils/hashtag.util';
import { Post, PostDocument } from 'src/schemas';
import { CommentService } from 'src/services/community/comment/comment.service';
import { NotificationService } from 'src/services/community/notification/notification.service';
import { ReactionService } from 'src/services/community/reaction/reaction.service';
import { TagStatisticsService } from 'src/services/content/tag';
import { UserAccountManagementService } from 'src/services/identity';
import { FileServerService } from 'src/services/shared/file-server';

import { PostMediaService } from './post-media.service';
import { PostStatisticsService } from './post-statistics.service';

/**
 * Stable data copied into the deletion event before the post is removed.
 * The worker uses this snapshot on every retry instead of querying a post that
 * may already have been hard-deleted by an earlier attempt.
 */
interface DeletedPostSnapshot {
  _id: string | ObjectId;
  userId: string | ObjectId;
  text?: string;
  fileIds?: Array<string | ObjectId>;
  thumbnailId?: string | ObjectId;
  cover4x3Id?: string | ObjectId;
  cover3x4Id?: string | ObjectId;
  teaserId?: string | ObjectId;
}

/**
 * Coordinates all destructive work after a post has been tombstoned.
 *
 * Overall workflow:
 * 1. Hard-delete the post while retaining the queue snapshot.
 * 2. Remove MongoDB dependants in independent, retry-safe batches.
 * 3. Rebuild cached creator and hashtag totals from surviving posts.
 * 4. Delete external files last so database consistency is restored first.
 *
 * Every phase converges on the same final state when BullMQ delivers the same
 * event again or retries after a partial failure.
 */
@Injectable()
export class PostDeletionCleanupService {
  constructor(
    @InjectModel(Post.name) private readonly PostModel: Model<PostDocument>,
    private readonly commentService: CommentService,
    private readonly reactionService: ReactionService,
    private readonly notificationService: NotificationService,
    private readonly postMediaService: PostMediaService,
    private readonly postStatisticsService: PostStatisticsService,
    private readonly tagStatisticsService: TagStatisticsService,
    private readonly userService: UserAccountManagementService,
    private readonly fileServerService: FileServerService
  ) {}

  /**
   * Remove a post and all user-facing data owned by that post.
   *
   * @param post Versioned snapshot published by PostCrudService.
   */
  public async cleanup(post: DeletedPostSnapshot): Promise<void> {
    const postId = new ObjectId(post._id);
    const tags = extractAndNormalizeHashtags(post.text || '');

    // Phase 1: remove the tombstone. The event snapshot remains the source for
    // later retries, so this deleteOne is intentionally safe when it matches 0.
    await this.PostModel.deleteOne({ _id: postId });

    // Phase 2: clean independent MongoDB dependants concurrently. Each service
    // uses deleteMany/deleteOne semantics and therefore tolerates duplicate runs.
    //
    // Notifications belong here rather than in a listener of their own: every
    // interaction notification for this post — its likes, its comments and
    // replies, and the mentions naming it — navigates to a post that no longer
    // exists, so they are removed with the rest of the post's dependants instead
    // of being left as clickable dead rows in someone's panel.
    await Promise.all([
      this.commentService.deleteCommentsByContent('post', postId),
      this.reactionService.deleteReactionsByContent('post', postId),
      this.postMediaService.deletePostMediaByPostId(postId),
      this.notificationService.deleteByPostId(postId)
    ]);

    // Phase 3: replace cached counters with authoritative values. Exact values
    // avoid double subtraction when a job is retried after this phase.
    const creatorTotalLikes = await this.postStatisticsService.getCreatorTotalLikes(post.userId);
    await Promise.all([
      this.userService.setLikeStat(post.userId, creatorTotalLikes),
      this.tagStatisticsService.reconcileTagStatistics(tags)
    ]);

    // Phase 4: external storage is last because it cannot participate in the
    // MongoDB changes above and BullMQ must be able to retry transient failures.
    await this.deleteFiles(post);
  }

  /**
   * Delete unique media IDs referenced by the removed post.
   *
   * Missing files are treated as success because they mean an earlier attempt
   * already reached the desired state. Other errors are rethrown for BullMQ.
   */
  private async deleteFiles(post: DeletedPostSnapshot): Promise<void> {
    // A thumbnail or teaser can also appear in fileIds, so deduplicate before
    // calling the file server and avoid unnecessary remote operations.
    const fileIds = [...new Set([
      ...(post.fileIds || []),
      post.thumbnailId,
      post.cover4x3Id,
      post.cover3x4Id,
      post.teaserId
    ].filter(Boolean).map(fileId => fileId.toString()))];

    if (!fileIds.length) {
      return;
    }

    // The file server reports per-file failures instead of rejecting the whole
    // request. Only actionable failures should make the queue job retry.
    const result = await this.fileServerService.deleteManyByIds(fileIds);
    const actionableErrors = result.errors.filter(error => error.error !== 'File not found');

    if (actionableErrors.length) {
      throw new Error(`Post file cleanup failed: ${JSON.stringify(actionableErrors)}`);
    }
  }
}
