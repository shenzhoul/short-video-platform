export interface IComment {
  _id: string;
  objectId: string;
  content: string;
  user: any;
  level: number;
  objectType: string;
  isLiked: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  totalReply: number;
  totalLike: number;
  replyToName?: string;
  parentCommentId?: string;
  isReplyToReply?: boolean;
}
export interface ICreateComment {
  objectId: string;
  content: string;
  objectType: string;
  replyToUserId?: string;
  replyToName?: string;
  /** Users named with @ in the text. Re-verified server-side before storage. */
  mentionedUserIds?: string[];
}
