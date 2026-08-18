import { Expose, plainToInstance, Transform } from 'class-transformer';
import { ObjectId } from 'mongodb';
import { UserDto } from 'src/dtos/identity/user';

/** Minimal post fields a notification row needs to render a thumbnail. */
export interface INotificationPostRef {
  _id: ObjectId | string;
  thumbnail: string | null;
}

/**
 * Notification response shape.
 *
 * Carries semantic data only — type plus references. The message text, icon and
 * navigation target are resolved by the client from `type`, so the same row can
 * be re-worded or re-routed without a data migration.
 *
 * This is also the exact payload pushed over the socket, which is why it stays
 * small: a trimmed actor rather than a full user, and a single thumbnail URL
 * rather than the post.
 */
export class NotificationDto {
  @Expose()
  @Transform(({ obj }) => obj._id)
  _id: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj.recipientId)
  recipientId: ObjectId;

  @Expose()
  @Transform(({ obj }) => obj.actorId)
  actorId: ObjectId;

  @Expose()
  type: string;

  @Expose()
  @Transform(({ obj }) => obj.postId)
  postId: ObjectId | null;

  @Expose()
  @Transform(({ obj }) => obj.commentId)
  commentId: ObjectId | null;

  @Expose()
  read: boolean;

  @Expose()
  readAt: Date | null;

  @Expose()
  lastActivityAt: Date;

  @Expose()
  createdAt: Date;

  @Expose()
  updatedAt: Date;

  /** Whether this row represents several interaction events. */
  @Expose()
  isAggregate: boolean;

  /** Events represented by an adaptive aggregate row. */
  @Expose()
  activityCount: number;

  /**
   * The domain event most recently folded into this row.
   *
   * Exposed so an aggregate can navigate to its newest event rather than to the
   * one that happened to create the group: `commentId` is insert-only and stays
   * frozen at the first event, while this advances.
   *
   * Its meaning depends on the type — a comment id for the adaptive comment
   * types, a reaction id for the like aggregates — so a client must key off
   * `type` before treating it as a comment reference.
   */
  @Expose()
  @Transform(({ obj }) => obj.lastEventId)
  lastEventId: ObjectId | null;

  /** Authoritative number of actors represented in the rendered notification. */
  @Expose()
  actorCount: number;

  /** Trimmed actor identity, set by the service after a batched user lookup. */
  @Expose()
  actor?: Partial<UserDto>;

  /** Resolved post thumbnail, set by the service after a batched post lookup. */
  @Expose()
  postThumbnail?: string | null;

  /**
   * Whether the viewer already follows the actor. Only set for FOLLOW rows, so
   * the panel can render a working Follow / Following control without issuing a
   * request per row.
   */
  @Expose()
  isActorFollowed?: boolean;

  /**
   * Whether the comment this row refers to has since been deleted.
   *
   * Only meaningful for comment-scoped types. Resolved from the comment's own
   * existence at read time rather than stored, so no wording lives in the
   * database and the state cannot go stale. The client turns it into a
   * "comment was deleted" notice while still linking to the containing post.
   */
  @Expose()
  commentDeleted?: boolean;

  /**
   * Current text of the comment this row is about, for the preview line.
   *
   * Resolved at read time from the live comment — never copied into the
   * notification document — so the model stays a set of semantic references and
   * an edited comment previews its current wording.
   */
  @Expose()
  commentPreview?: string | null;

  public static fromModel(model: any) {
    if (!model) return null;

    return plainToInstance(
      NotificationDto,
      typeof model.toObject === 'function' ? model.toObject() : model,
      { excludeExtraneousValues: true }
    );
  }

  setActor(user?: UserDto) {
    if (!user) return;
    this.actor = user.toActorResponse();
  }

  setPostThumbnail(thumbnail: string | null) {
    this.postThumbnail = thumbnail || null;
  }

  setActorCount(count: number) {
    this.actorCount = Math.max(1, count || 1);
  }

  setIsActorFollowed(isFollowed: boolean) {
    this.isActorFollowed = isFollowed;
  }

  setCommentDeleted(isDeleted: boolean) {
    this.commentDeleted = isDeleted;
  }

  setCommentPreview(preview: string | null) {
    this.commentPreview = preview;
  }
}
