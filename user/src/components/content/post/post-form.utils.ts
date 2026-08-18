interface UploadModalCancelBehaviorInput {
  hasPost: boolean;
  existingFileCount: number;
  selectedFileCount: number;
}

export function shouldResetPostTypeOnUploadModalCancel({
  hasPost,
  existingFileCount,
  selectedFileCount
}: UploadModalCancelBehaviorInput) {
  if (hasPost) return false;

  return existingFileCount === 0 && selectedFileCount === 0;
}
