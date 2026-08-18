import { IUser } from '@interfaces/user';

export interface IPostFile {
  _id: string;
  url: string;
  type: string;
  name?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  blurImage?: string;
  thumbnails?: string[];
  duration?: number;
  status?: string;
  processingStatus?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface IPost {
  _id: string;
  type: string;
  fromRef: string;
  refId: string;
  user: IUser;
  /** Optional headline shown above the description. Exposed by PostDto. */
  title?: string;
  text: string;
  /** Normalized hashtags extracted from the text server-side. */
  tags?: string[];
  /** Content category key from the POST_TOPICS list, or null when the creator skipped it. */
  topicKey?: string | null;
  mentionedUserIds?: string[];
  /** Trending hashtag the creator associated this post with ("hotspot" in the UI). */
  associatedTag?: string | null;
  fileIds: Array<string>;
  totalLike: number;
  totalComment: number;
  /** Distinct users who have shared the post. Only ever grows: there is no unshare. */
  totalShare?: number;
  totalView?: number;
  createdAt: Date;
  updatedAt: Date;
  files: IPostFile[];
  isLiked: boolean;
  thumbnailId: string;
  thumbnailUrl: string;
  cover4x3Id?: string;
  cover3x4Id?: string;
  cover4x3Url?: string;
  cover3x4Url?: string;
  coverDisplayRatio?: '4:3' | '3:4';
  teaserId: string;
  teaser: any;
  tagline: string;
  userId: any;
  status: string;
  isCreatorDeleted: boolean;
  isPinned: boolean;
  pinnedAt?: Date | null;
}

export type PostInteractionPatch = Partial<Pick<IPost,
  'isLiked' | 'totalLike' | 'totalComment' | 'totalShare' | 'totalView'
>>;
