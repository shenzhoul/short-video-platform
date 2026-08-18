export interface PostVideoHandoff {
  file: File;
  previousDraftFileId?: string;
}

let pendingVideoHandoff: PostVideoHandoff | null = null;

export const setPendingPostVideoFile = (file: File, previousDraftFileId?: string) => {
  pendingVideoHandoff = { file, previousDraftFileId };
};

export const consumePendingPostVideoFile = (): PostVideoHandoff | null => {
  const handoff = pendingVideoHandoff;
  pendingVideoHandoff = null;
  return handoff;
};
