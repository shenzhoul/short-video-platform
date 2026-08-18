export interface PostPhotoHandoff {
  files: File[];
  previousDraftFileIds: string[];
}

let pendingPhotoHandoff: PostPhotoHandoff | null = null;

export const setPendingPostPhotoFiles = (files: File[], previousDraftFileIds: string[] = []) => {
  pendingPhotoHandoff = { files: [...files], previousDraftFileIds: [...previousDraftFileIds] };
};

export const consumePendingPostPhotoFiles = (): PostPhotoHandoff | null => {
  const handoff = pendingPhotoHandoff;
  pendingPhotoHandoff = null;
  return handoff;
};
