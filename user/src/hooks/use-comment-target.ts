'use client';

import { IComment } from '@interfaces/comment';
import { resolveCommentTarget } from '@services/comment.service';
import { useEffect, useState } from 'react';

/**
 * What became of the comment a notification pointed at.
 *
 * `missing` is a normal outcome, not a failure: the notification deliberately
 * outlives the comment it quotes, so the comment being gone is exactly the case
 * the UI has to explain.
 */
export type CommentTargetStatus = 'idle' | 'resolving' | 'found' | 'missing';

export interface CommentTarget {
  status: CommentTargetStatus;
  /** The exact comment or reply named by the notification. */
  comment: IComment | null;
  /**
   * Root of the thread the target lives in. Equals `comment` for a top-level
   * comment; for a reply it is the comment whose thread must be expanded first.
   */
  root: IComment | null;
  /** True when the target is a reply, so its thread has to be opened. */
  isReply: boolean;
  /**
   * True when nothing resolved but the row stands for several events, so it is
   * not honest to say "the comment was deleted" — others may well survive.
   */
  ambiguous: boolean;
}

const IDLE: CommentTarget = {
  status: 'idle', comment: null, root: null, isReply: false, ambiguous: false
};

/**
 * Resolve a notification's target comment directly by id.
 *
 * The single place "open the exact comment", "open the exact reply" and
 * "explain a deleted target" are answered, so all three cannot drift apart.
 *
 * Deliberately one request per candidate rather than walking the paginated
 * list: the target may be the 2,431st comment on a busy post, and fetching
 * pages until it turns up would be unbounded work that still fails if it sits
 * beyond the last page the user ever scrolls to.
 *
 * @param targetCommentId The event the row is really about — for an aggregate,
 * its newest.
 * @param fallbackCommentId Only supplied for an aggregate whose newest event
 * differs from the one that created it. Tried when the newest is gone, and its
 * presence marks the row as representing several events.
 */
export function useCommentTarget(
  targetCommentId?: string | null,
  fallbackCommentId?: string | null
): CommentTarget {
  const [target, setTarget] = useState<CommentTarget>(IDLE);

  useEffect(() => {
    if (!targetCommentId) {
      setTarget(IDLE);
      return;
    }

    let cancelled = false;
    setTarget({ ...IDLE, status: 'resolving' });

    /** @returns the resolved payload, or null when that id no longer exists. */
    const resolveOne = async (id: string) => {
      try {
        const response = await resolveCommentTarget(id);
        const data = response?.data;
        // The server reports a deleted comment as found:false rather than an
        // error, so this is the ordinary tombstone path.
        return data?.found && data.comment ? data : null;
      } catch {
        // A failed lookup is treated as unresolvable: either way the target
        // cannot be shown, and saying so beats a silent dead end.
        return null;
      }
    };

    void (async () => {
      // Newest first. Only if that event is gone does the aggregate fall back
      // to the comment that opened it, which is still a genuinely represented
      // event rather than a guess.
      const candidates = [targetCommentId, fallbackCommentId].filter(Boolean) as string[];
      const representsSeveralEvents = candidates.length > 1;

      for (const id of candidates) {
        // Sequential on purpose: the fallback is only worth a request once the
        // preferred target is known to be gone.

        const data = await resolveOne(id);
        if (cancelled) return;
        if (!data) continue;

        const comment = data.comment as IComment;
        const root = (data.root as IComment) || comment;
        setTarget({
          status: 'found',
          comment,
          root,
          isReply: root._id !== comment._id,
          ambiguous: false
        });
        return;
      }

      if (cancelled) return;
      setTarget({ ...IDLE, status: 'missing', ambiguous: representsSeveralEvents });
    })();

    return () => {
      cancelled = true;
    };
  }, [targetCommentId, fallbackCommentId]);

  return target;
}
