// comment-replies.tsx
'use client';

import CommentItem from '@components/comment/comment-item';
import Spin from '@components/ui/spin';
import { useComments } from '@hooks/use-comments';
import { IComment } from '@interfaces/comment';
import { IUser } from '@interfaces/user';
import { useEffect, useState } from 'react';

type Props = {
  parentId: string;
  user?: IUser;
  onDelete?: (commentId: string) => void | Promise<void>;
  onReply?: (comment: IComment) => void;
  replyTargetId?: string;
  createdReply?: IComment | null;
  highlightedCommentId?: string | null;
  postOwnerId?: string | null;
};

export default function CommentReplies({
  parentId,
  user,
  onDelete,
  onReply,
  replyTargetId,
  createdReply,
  highlightedCommentId = null,
  postOwnerId = null
}: Props) {
  const [localReplies, setLocalReplies] = useState<IComment[]>([]);

  const {
    comments,
    loading
  } = useComments({
    objectId: parentId,
    objectType: 'comment',
    limit: 10,
    autoload: true
  });

  useEffect(() => {
    const sorted = [...comments].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

    setLocalReplies(sorted);
  }, [comments]);

  useEffect(() => {
    if (!createdReply) return;
    if (createdReply.objectId !== parentId) return;
    if (createdReply.objectType !== 'comment') return;

    setLocalReplies((prev) => {
      if (prev.some((item) => item._id === createdReply._id)) return prev;
      return [...prev, createdReply];
    });
  }, [createdReply, parentId]);

  if (loading) {
    return (
      <div className="py-2 pl-12">
        <Spin spinning />
      </div>
    );
  }

  if (!localReplies.length) return null;

  return (
    <div className="mt-3 space-y-3">
      {localReplies.map((reply) => (
        <CommentItem
          key={reply._id}
          item={reply}
          user={user}
          onDelete={async (commentId) => {
            await onDelete?.(commentId);

            setLocalReplies((prev) =>
              prev.filter((item) => item._id !== commentId)
            );
          }}
          canReply={false}
          level={1}
          onReply={onReply}
          isReplying={replyTargetId === reply._id}
          highlightedCommentId={highlightedCommentId}
          postOwnerId={postOwnerId}
        />
      ))}
    </div>
  );
}
