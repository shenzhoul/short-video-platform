import { PostDto } from 'src/dtos/content/post.dto';
import { UserDto } from 'src/dtos/identity/user';

/**
 * The post preview rendered inside a shared-post bubble.
 *
 * A deliberately small, read-time projection rather than the full `PostDto`.
 * Two reasons, and both are about the privacy boundary:
 *
 *  - a conversation is not a feed, so a bubble has no business carrying view
 *    counts, poll state, teaser ids or the viewer's own like state;
 *  - the card must be able to say "unavailable" *without* revealing what it used
 *    to show, so the unavailable shape is a different object, not the full one
 *    with a flag on it.
 *
 * Built fresh every time a thread is read. Nothing here is stored on the
 * message, so a post that is deleted, hidden, or whose author is suspended stops
 * rendering everywhere at once, including in history somebody scrolls back to.
 */
export class SharedPostDto {
  /** Always present, even when unavailable — the client keys the card on it. */
  postId: string;

  /** False when the post is gone or this reader may not see it. */
  available: boolean;

  /** `video`, `photo`, `text`… mirrors the post's own type. Null when unavailable. */
  type?: string | null;

  /** Cover image for the card. Null when unavailable. */
  thumbnailUrl?: string | null;

  /** Trimmed caption. Absent when unavailable, never blanked to an empty string. */
  caption?: string | null;

  /** True when the post holds more than one image, so the card can mark it. */
  isMultiImage?: boolean;

  /** True for a playable post, so the card can show a play affordance. */
  isVideo?: boolean;

  /** Author identity, trimmed to what a card shows. Null when unavailable. */
  author?: Partial<UserDto> | null;

  /**
   * Why it cannot be shown, for the client's copy. Coarse on purpose: a reader
   * does not learn whether they were blocked or the post went private.
   */
  unavailableReason?: 'deleted' | 'not_accessible' | null;

  /** How long a caption may run on a card before it is cut. */
  private static readonly CAPTION_LENGTH = 120;

  /**
   * Build the card for a post this reader is allowed to see.
   *
   * `author` is passed in rather than read off the post so the caller can batch
   * the user lookups for a whole page of messages.
   */
  public static fromPost(post: PostDto, author?: UserDto | null): SharedPostDto {
    const dto = new SharedPostDto();
    const files = (post.files || []) as Array<Record<string, any>>;

    dto.postId = post._id.toString();
    dto.available = true;
    dto.type = post.type || null;
    dto.thumbnailUrl = SharedPostDto.resolveThumbnail(post, files);
    dto.caption = SharedPostDto.trimCaption(post.text || post.title || '');
    // Derived from the post's own type, not from its attachments: the card is
    // built from a plain post read, which does not resolve files against the
    // file server. Keying on `files` left every card without a play badge.
    dto.isVideo = `${post.type || ''}`.includes('video')
      || files.some(file => `${file?.type || ''}`.includes('video'));
    dto.isMultiImage = SharedPostDto.hasMultipleImages(post, files);
    dto.author = author ? author.toActorResponse() : null;
    dto.unavailableReason = null;

    return dto;
  }

  /**
   * The card for a post this reader cannot see.
   *
   * Carries the id and nothing else. The message stays in history — deleting
   * someone's conversation because a post went away would be worse than the
   * gap — but the content it pointed at does not come back through this door.
   */
  public static unavailable(
    postId: string,
    reason: 'deleted' | 'not_accessible' = 'not_accessible'
  ): SharedPostDto {
    const dto = new SharedPostDto();
    dto.postId = postId;
    dto.available = false;
    dto.unavailableReason = reason;
    return dto;
  }

  /**
   * The cover, from the same fields the feed card uses.
   *
   * The portrait cover comes first because this card is portrait; falling
   * straight to the attachment would mean a file-server round trip per shared
   * post, and the covers are already on the post document.
   */
  private static resolveThumbnail(post: PostDto, files: Array<Record<string, any>>): string | null {
    if (post.cover3x4Url) return post.cover3x4Url;
    if (post.cover4x3Url) return post.cover4x3Url;
    if (post.thumbnailUrl) return post.thumbnailUrl;

    const withThumbnail = files.find(file => file?.thumbnails?.length);
    if (withThumbnail) return withThumbnail.thumbnails[0];

    const image = files.find(file => `${file?.type || ''}`.includes('photo'));
    return image?.url || null;
  }

  /**
   * Does the post hold more than one image?
   *
   * Counted from `fileIds` when the attachments are not resolved, which is the
   * normal case here — the ids are on the document and their number is all this
   * badge needs.
   */
  private static hasMultipleImages(post: PostDto, files: Array<Record<string, any>>): boolean {
    if (!`${post.type || ''}`.includes('photo')) return false;

    const resolvedImages = files.filter(file => `${file?.type || ''}`.includes('photo')).length;
    if (resolvedImages) return resolvedImages > 1;

    return (post.fileIds || []).length > 1;
  }

  private static trimCaption(text: string): string | null {
    const trimmed = (text || '').trim();
    if (!trimmed) return null;
    return trimmed.length > SharedPostDto.CAPTION_LENGTH
      ? `${trimmed.slice(0, SharedPostDto.CAPTION_LENGTH)}…`
      : trimmed;
  }
}
