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
  /** The single image this comment carries, when it has one. */
  image?: {
    id: string;
    url: string;
    width: number;
    height: number;
    mimeType: string;
  };
}
export interface ICreateComment {
  objectId: string;
  content: string;
  objectType: string;
  replyToUserId?: string;
  replyToName?: string;
  /** Users named with @ in the text. Re-verified server-side before storage. */
  mentionedUserIds?: string[];
  /** An already-uploaded image to attach. Ownership is re-checked server-side. */
  imageId?: string;
}
