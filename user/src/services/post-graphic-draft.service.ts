export type PostGraphicDraftUploadState = 'preparing' | 'uploading' | 'uploaded' | 'interrupted' | 'failed';

export interface PostGraphicDraftItem {
  id: string;
  fileId?: string;
  fileName: string;
  uploadState: PostGraphicDraftUploadState;
}

export interface PostGraphicDraft {
  version: 1;
  userId: string;
  title: string;
  description: string;
  topicKey?: string;
  selectedCoverId: string;
  items: PostGraphicDraftItem[];
  updatedAt: string;
}

const STORAGE_KEY_PREFIX = 'post-graphic-draft:v1';

const getStorageKey = (userId: string) => `${STORAGE_KEY_PREFIX}:${userId}`;

export const loadPostGraphicDraft = (userId: string): PostGraphicDraft | null => {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const storedDraft = window.localStorage.getItem(getStorageKey(userId));
    if (!storedDraft) return null;
    const draft = JSON.parse(storedDraft) as PostGraphicDraft;
    if (draft.version !== 1 || draft.userId !== userId || !Array.isArray(draft.items)) return null;
    return draft;
  } catch {
    return null;
  }
};

export const savePostGraphicDraft = (
  userId: string,
  draft: Omit<PostGraphicDraft, 'version' | 'userId' | 'updatedAt'>
): PostGraphicDraft => {
  const persistedDraft: PostGraphicDraft = {
    ...draft,
    version: 1,
    userId,
    updatedAt: new Date().toISOString()
  };
  try {
    window.localStorage.setItem(getStorageKey(userId), JSON.stringify(persistedDraft));
  } catch {
    // Uploading must continue when browser storage is restricted.
  }
  return persistedDraft;
};

export const clearPostGraphicDraft = (userId: string) => {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.removeItem(getStorageKey(userId));
  } catch {
    // A restricted storage policy must not block publish or discard.
  }
};
