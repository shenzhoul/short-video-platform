import { ICreator } from '@interfaces/creator';

export interface CreatorProfileCurrentUser {
  _id: string;
  username: string;
}

export interface CreatorProfileTabItem {
  key: string;
  label: string;
  count?: number;
  locked?: boolean;
}

/** Query param that deep-links the profile page to one of its tabs. */
export const CREATOR_PROFILE_TAB_PARAM = 'tab';

/** Profile tabs that can be opened from a URL. Other tabs are placeholders with no content yet. */
export type CreatorProfileUrlTab = 'works' | 'liked';

export function isCreatorProfileUrlTab(value: string | null): value is CreatorProfileUrlTab {
  return value === 'works' || value === 'liked';
}

export interface CreatorProfilePageProps {
  creator: ICreator;
  currentUser?: CreatorProfileCurrentUser | null;
  initialPostData?: {
    data: import('@interfaces/post').IPost[];
    hasMore: boolean;
    nextCursor?: {
      id: string;
      createdAt: number;
    } | null;
    total: number;
  } | null;
}
