import { PostCreateSection } from './post-create-layout';

interface PostCreateActionsProps {
  isUploading: boolean;
  isSubmitting: boolean;
  onPost: () => void;
  /**
   * Which composer these actions belong to. Defaults to `create`, so the publish flow keeps the
   * exact buttons it always had; `edit` swaps in Save changes / Cancel.
   */
  mode?: 'create' | 'edit';
  /** Whether edit fields differ from the values originally loaded from the post. */
  hasChanges?: boolean;
  /** Required in edit mode — leaves the form without writing anything. */
  onCancel?: () => void;
}

export default function PostCreateActions({
  isUploading,
  isSubmitting,
  onPost,
  mode = 'create',
  hasChanges = true,
  onCancel
}: PostCreateActionsProps) {
  const isEdit = mode === 'edit';
  const isPrimaryDisabled = isUploading || isSubmitting || (isEdit && !hasChanges);
  const primaryLabel = isEdit
    ? (isSubmitting ? 'Saving...' : 'Save changes')
    : (isSubmitting ? 'Posting...' : isUploading ? 'Uploading...' : 'Post');

  return (
    <PostCreateSection>
      <div className={`flex items-center gap-3 ${isEdit ? 'justify-start pl-[166px]' : 'justify-center'}`}>
        <button
          type="button"
          disabled={isPrimaryDisabled}
          className="h-8 w-[124px] cursor-pointer whitespace-nowrap rounded-sm bg-[#fe2c55] px-4 text-sm font-medium text-white transition hover:bg-[#e9274e] disabled:cursor-not-allowed disabled:bg-(--action-card-bg) disabled:text-(--text-muted) disabled:opacity-100 disabled:hover:bg-(--action-card-bg)"
          onClick={onPost}
        >
          {primaryLabel}
        </button>
        {isEdit ? (
          <button
            type="button"
            disabled={isSubmitting}
            className="h-8 w-[124px] cursor-pointer whitespace-nowrap rounded-sm bg-(--action-card-bg) px-4 text-sm font-medium text-(--text-soft) transition hover:text-(--text-strong) disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onCancel}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            disabled
            title="Draft saving is not available yet"
            className="h-8 w-[120px] cursor-not-allowed rounded-sm bg-(--action-card-bg) px-8 text-sm font-medium text-(--text-muted) opacity-60"
          >
            Save
          </button>
        )}
      </div>
    </PostCreateSection>
  );
}
