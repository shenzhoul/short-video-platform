export type PostVideoDraftUploadState =
  | 'preparing'
  | 'uploading'
  | 'uploaded'
  | 'interrupted'
  | 'failed';

export interface PostVideoDraft {
  version: 1;
  userId: string;
  title: string;
  description: string;
  fileId?: string;
  fileName?: string;
  uploadState: PostVideoDraftUploadState;
  updatedAt: string;
}

const STORAGE_KEY_PREFIX = 'post-video-draft:v1';

const getStorageKey = (userId: string) => `${STORAGE_KEY_PREFIX}:${userId}`;

export const loadPostVideoDraft = (userId: string): PostVideoDraft | null => {
  if (typeof window === 'undefined' || !userId) return null;

  try {
    const storedDraft = window.localStorage.getItem(getStorageKey(userId));
    if (!storedDraft) return null;

    const draft = JSON.parse(storedDraft) as PostVideoDraft;
    if (draft.version !== 1 || draft.userId !== userId) return null;
    return draft;
  } catch {
    return null;
  }
};

export const savePostVideoDraft = (
  userId: string,
  draft: Omit<PostVideoDraft, 'version' | 'userId' | 'updatedAt'>
): PostVideoDraft => {
  const persistedDraft: PostVideoDraft = {
    ...draft,
    version: 1,
    userId,
    updatedAt: new Date().toISOString()
  };

  try {
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(persistedDraft));
  } catch {
    // Uploading must continue even when browser storage is unavailable or full.
  }
  return persistedDraft;
};

export const clearPostVideoDraft = (userId: string) => {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(getStorageKey(userId));
  } catch {
    // A restricted browser storage policy should not block post creation or discard.
  }
};
