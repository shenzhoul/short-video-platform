import { INotification, NOTIFICATION_TYPE } from '@interfaces/notification';

import {
  resolveActorName,
  resolveNotificationPresentation,
  resolveNotificationTarget,
  resolveTargetCommentIds
} from './notification-presentation';

function build(overrides: Partial<INotification> = {}): INotification {
  return {
    _id: 'n1',
    type: NOTIFICATION_TYPE.POST_LIKE,
    actorId: 'a1',
    actor: { _id: 'a1', username: 'bee', name: 'Bee' },
    postId: 'p1',
    read: false,
    lastActivityAt: '2026-08-14T10:00:00.000Z',
    createdAt: '2026-08-14T10:00:00.000Z',
    ...overrides
  };
}

describe('notification presentation', () => {
  it('gives every backend type its own wording', () => {
    const messages = Object.values(NOTIFICATION_TYPE).map((type) => (
      resolveNotificationPresentation(build({ type })).message
    ));

    // A type falling through to the neutral fallback would render "interacted
    // with you", which is the failure this guards against.
    expect(messages).not.toContain('interacted with you');
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('reads as a single actor when only one person is involved', () => {
    expect(resolveNotificationPresentation(build({ actorCount: 1 })).message)
      .toBe('liked your post');
  });

  it('names the remaining actors once a group represents several', () => {
    expect(resolveNotificationPresentation(build({ actorCount: 2 })).message)
      .toBe('and 1 other liked your post');
    expect(resolveNotificationPresentation(build({ actorCount: 4 })).message)
      .toBe('and 3 others liked your post');
  });

  it('treats a missing or nonsensical count as a single actor', () => {
    expect(resolveNotificationPresentation(build({ actorCount: 0 })).message)
      .toBe('liked your post');
    expect(resolveNotificationPresentation(build({ actorCount: undefined })).message)
      .toBe('liked your post');
  });

  it('shows a follow control only for follows, and a thumbnail only for post-scoped types', () => {
    const follow = resolveNotificationPresentation(build({ type: NOTIFICATION_TYPE.FOLLOW }));
    expect(follow.showFollowAction).toBe(true);
    expect(follow.showThumbnail).toBe(false);

    const like = resolveNotificationPresentation(build({ type: NOTIFICATION_TYPE.POST_LIKE }));
    expect(like.showFollowAction).toBe(false);
    expect(like.showThumbnail).toBe(true);
  });

  it('still renders a row for a type this client does not know yet', () => {
    const unknown = resolveNotificationPresentation(build({ type: 'post_share' as any }));
    expect(unknown.message).toBe('interacted with you');
  });

  it('opens post-scoped types on the default view', () => {
    // The subject is the post itself, so there is no reason to jump past it.
    [NOTIFICATION_TYPE.POST_LIKE, NOTIFICATION_TYPE.POST_MENTION].forEach((type) => {
      expect(resolveNotificationTarget(build({ type }))).toBe('/?modal_id=p1');
    });
  });

  it('opens comment-scoped types straight onto the Comments tab', () => {
    // The thing the reader was told about lives in the comments, so landing on
    // the video with it hidden behind another click would be a dead end.
    [
      NOTIFICATION_TYPE.POST_COMMENT,
      NOTIFICATION_TYPE.COMMENT_REPLY,
      NOTIFICATION_TYPE.COMMENT_LIKE,
      NOTIFICATION_TYPE.COMMENT_MENTION
    ].forEach((type) => {
      expect(resolveNotificationTarget(build({ type, commentId: 'c-1' })))
        .toBe('/?modal_id=p1&modal_tab=comments&target_comment_id=c-1');
    });
  });

  it('still opens the Comments tab when the comment itself was deleted', () => {
    // The link carries the id only. Whether the comment still exists is
    // resolved by the app, never asserted by the URL.
    const target = resolveNotificationTarget(build({
      type: NOTIFICATION_TYPE.COMMENT_MENTION,
      commentId: 'c-1',
      commentDeleted: true
    }));
    expect(target).toBe('/?modal_id=p1&modal_tab=comments&target_comment_id=c-1');
    expect(target).not.toContain('commentDeleted');
  });

  it('targets commentId on an individual POST_COMMENT', () => {
    const individual = build({
      type: NOTIFICATION_TYPE.POST_COMMENT,
      commentId: 'c-own',
      isAggregate: false,
      lastEventId: 'c-newer'
    });

    // An individual row stands for exactly one event, so its own comment is the
    // target no matter what lastEventId happens to hold.
    expect(resolveTargetCommentIds(individual)).toEqual({ targetId: 'c-own', fallbackId: null });
    expect(resolveNotificationTarget(individual))
      .toBe('/?modal_id=p1&modal_tab=comments&target_comment_id=c-own');
  });

  it('targets lastEventId on an aggregated POST_COMMENT', () => {
    const aggregate = build({
      type: NOTIFICATION_TYPE.POST_COMMENT,
      commentId: 'c5',
      lastEventId: 'c7',
      isAggregate: true,
      activityCount: 3
    });

    // The row reads "H and 2 others commented"; opening c5 would focus the
    // comment H replaced.
    expect(resolveTargetCommentIds(aggregate)).toEqual({ targetId: 'c7', fallbackId: 'c5' });
    expect(resolveNotificationTarget(aggregate))
      .toBe('/?modal_id=p1&modal_tab=comments&target_comment_id=c7&target_comment_fallback_id=c5');
  });

  it('carries the originating comment as the aggregate fallback', () => {
    const aggregate = build({
      type: NOTIFICATION_TYPE.COMMENT_REPLY,
      commentId: 'r1',
      lastEventId: 'r9',
      isAggregate: true
    });

    // Both ids are genuinely represented events — the only two the model keeps.
    expect(resolveTargetCommentIds(aggregate)).toEqual({ targetId: 'r9', fallbackId: 'r1' });
  });

  it('omits the fallback when it names the same event', () => {
    const aggregate = build({
      type: NOTIFICATION_TYPE.POST_COMMENT,
      commentId: 'c5',
      lastEventId: 'c5',
      isAggregate: true
    });

    expect(resolveTargetCommentIds(aggregate)).toEqual({ targetId: 'c5', fallbackId: null });
    expect(resolveNotificationTarget(aggregate)).not.toContain('target_comment_fallback_id');
  });

  it('falls back to commentId when an aggregate has no lastEventId', () => {
    const aggregate = build({
      type: NOTIFICATION_TYPE.POST_COMMENT,
      commentId: 'c5',
      lastEventId: null,
      isAggregate: true
    });

    // Legacy rows written before lastEventId existed still navigate.
    expect(resolveTargetCommentIds(aggregate)).toEqual({ targetId: 'c5', fallbackId: null });
  });

  it('never treats a like aggregate lastEventId as a comment', () => {
    [NOTIFICATION_TYPE.POST_LIKE, NOTIFICATION_TYPE.COMMENT_LIKE].forEach((type) => {
      const likeAggregate = build({
        type,
        commentId: 'c-real',
        // For a like aggregate this is a REACTION id, not a comment.
        lastEventId: 'reaction-1',
        isAggregate: true
      });

      expect(resolveTargetCommentIds(likeAggregate).targetId).toBe('c-real');
      expect(resolveNotificationTarget(likeAggregate)).not.toContain('reaction-1');
    });
  });

  it('resolves a follow to the actor profile rather than a post', () => {
    expect(resolveNotificationTarget(build({
      type: NOTIFICATION_TYPE.FOLLOW,
      postId: null
    }))).toBe('/bee');
  });

  it('refuses to invent a target it cannot resolve', () => {
    expect(resolveNotificationTarget(build({ postId: null }))).toBeNull();
    expect(resolveNotificationTarget(build({
      type: NOTIFICATION_TYPE.FOLLOW,
      actor: { _id: 'a1' }
    }))).toBeNull();
  });

  it('adds a removed-comment notice only to comment-scoped rows', () => {
    [
      NOTIFICATION_TYPE.POST_COMMENT,
      NOTIFICATION_TYPE.COMMENT_REPLY,
      NOTIFICATION_TYPE.COMMENT_LIKE,
      NOTIFICATION_TYPE.COMMENT_MENTION
    ].forEach((type) => {
      const presentation = resolveNotificationPresentation(build({ type, commentDeleted: true }));
      expect(presentation.deletedNotice).toBe('This comment has been deleted.');
      // The interaction still happened, so the original sentence survives.
      expect(presentation.message).not.toBe('');
    });
  });

  it('never puts a comment notice on a post-scoped or follow row', () => {
    [
      NOTIFICATION_TYPE.POST_LIKE,
      NOTIFICATION_TYPE.POST_MENTION,
      NOTIFICATION_TYPE.FOLLOW
    ].forEach((type) => {
      // A stray flag on the wrong type must not produce nonsense.
      expect(resolveNotificationPresentation(build({ type, commentDeleted: true })).deletedNotice)
        .toBeNull();
    });
  });

  it('carries no notice while the comment still exists', () => {
    expect(resolveNotificationPresentation(build({
      type: NOTIFICATION_TYPE.COMMENT_MENTION,
      commentDeleted: false
    })).deletedNotice).toBeNull();
    expect(resolveNotificationPresentation(build({
      type: NOTIFICATION_TYPE.COMMENT_MENTION
    })).deletedNotice).toBeNull();
  });

  it('keeps the aggregate wording alongside a removed-comment notice', () => {
    const presentation = resolveNotificationPresentation(build({
      type: NOTIFICATION_TYPE.COMMENT_LIKE,
      commentDeleted: true,
      actorCount: 3
    }));
    expect(presentation.message).toBe('and 2 others liked your comment');
    expect(presentation.deletedNotice).toBe('This comment has been deleted.');
  });

  it('quotes the referenced comment on every comment-scoped type', () => {
    [
      NOTIFICATION_TYPE.POST_COMMENT,
      NOTIFICATION_TYPE.COMMENT_REPLY,
      NOTIFICATION_TYPE.COMMENT_LIKE,
      NOTIFICATION_TYPE.COMMENT_MENTION
    ].forEach((type) => {
      const presentation = resolveNotificationPresentation(build({
        type,
        commentId: 'c-1',
        commentPreview: 'Is there a good travel guide? @devuser'
      }));

      expect(presentation.commentPreview).toBe('Is there a good travel guide? @devuser');
      // The action sentence survives alongside the quote.
      expect(presentation.message).not.toBe('');
    });
  });

  it('quotes nothing on post-scoped or follow rows', () => {
    [
      NOTIFICATION_TYPE.POST_LIKE,
      NOTIFICATION_TYPE.POST_MENTION,
      NOTIFICATION_TYPE.FOLLOW
    ].forEach((type) => {
      expect(resolveNotificationPresentation(build({
        type,
        commentPreview: 'stray text'
      })).commentPreview).toBeNull();
    });
  });

  it('shows the deletion notice instead of a quote once the comment is gone', () => {
    const presentation = resolveNotificationPresentation(build({
      type: NOTIFICATION_TYPE.COMMENT_MENTION,
      commentId: 'c-1',
      commentDeleted: true,
      commentPreview: null
    }));

    expect(presentation.deletedNotice).toBe('This comment has been deleted.');
    expect(presentation.commentPreview).toBeNull();
  });

  it('keeps the quote alongside aggregate wording', () => {
    const presentation = resolveNotificationPresentation(build({
      type: NOTIFICATION_TYPE.POST_COMMENT,
      commentId: 'c-1',
      commentPreview: 'Nice shot!',
      actorCount: 3
    }));

    expect(presentation.message).toBe('and 2 others commented on your post');
    expect(presentation.commentPreview).toBe('Nice shot!');
  });

  it('falls back through name, username and finally a placeholder', () => {
    expect(resolveActorName(build())).toBe('Bee');
    expect(resolveActorName(build({ actor: { _id: 'a1', username: 'bee' } }))).toBe('bee');
    expect(resolveActorName(build({ actor: undefined }))).toBe('Someone');
  });
});
