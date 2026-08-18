'use client';

import PostCreateActions from '@components/post/post-create-actions';
import PostCreateBasicInformation from '@components/post/post-create-basic-information';
import PostCreatePreviewPanel from '@components/post/post-create-preview-panel';
import PostGraphicPreviewPanel from '@components/post/post-graphic-preview-panel';
import Spin from '@components/ui/spin';
import { usePostEdit } from '@hooks/use-post-edit';
import Link from 'next/link';

import PostGraphicEditInformation from './post-graphic-edit-information';

interface PostEditClientProps {
  postId: string;
}

const pageClassName = 'relative min-h-[calc(100vh-3.5rem)] min-w-[912px] shrink-0 bg-(--post-bg) text-(--text-strong)';

/** Full-page message for a post that exists but cannot be edited, or could not be loaded. */
function EditUnavailable({ title, description }: { title: string; description: string }) {
  return (
    <main className={`${pageClassName} flex items-center justify-center`}>
      <div className="max-w-md text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-(--text-muted)">{description}</p>
        <Link
          href="/creator/posts"
          className="mt-6 inline-flex h-9 items-center rounded-sm bg-[#fe2c55] px-6 text-sm font-medium text-white transition hover:bg-[#e9274e]"
        >
          Back to Posts
        </Link>
      </div>
    </main>
  );
}

/**
 * Edit composer.
 *
 * Renders the *same* components as the create page rather than a parallel form, so the two cannot
 * drift apart in layout or field behaviour. The only differences are supplied as props: the preview
 * panel is read-only, and the actions are Save/Cancel.
 */
export default function PostEditClient({ postId }: PostEditClientProps) {
  const postEdit = usePostEdit(postId);

  if (postEdit.isLoading) {
    return (
      <main className={`${pageClassName} flex items-center justify-center`}>
        <Spin size="large" tip="Loading post..." />
      </main>
    );
  }

  if (postEdit.loadError || !postEdit.post) {
    return (
      <EditUnavailable
        title="Post not found"
        description={postEdit.loadError || 'This post is no longer available.'}
      />
    );
  }

  // The same rule the list uses to disable Edit, applied again here so opening the URL directly
  // cannot get around it.
  if (!postEdit.isEditable) {
    return (
      <EditUnavailable
        title="This post cannot be edited"
        description={postEdit.notEditableReason}
      />
    );
  }

  return (
    <main className={pageClassName}>
      <div className="flex min-h-full w-full justify-center rounded-lg p-10">
        <div className="mr-12 flex w-[778px] flex-col">
          <div className="relative">
            {postEdit.isGraphic ? (
              <PostGraphicEditInformation
                title={postEdit.title}
                description={postEdit.description}
                descriptionEditorRef={postEdit.descriptionEditorRef}
                items={postEdit.graphicItems}
                selectedCoverId={postEdit.selectedPhotoCoverId}
                onTitleChange={postEdit.setTitle}
                onDescriptionChange={postEdit.setDescription}
                onMentionsChange={postEdit.setMentionedUsers}
                onCoverSelect={postEdit.setSelectedPhotoCoverId}
              />
            ) : (
              <PostCreateBasicInformation
                mode="edit"
                title={postEdit.title}
                description={postEdit.description}
                descriptionEditorRef={postEdit.descriptionEditorRef}
                generatedCoverUrls={postEdit.generatedCoverUrls}
                selectedCoverIndex={postEdit.selectedCoverIndex}
                customCoverUrls={postEdit.customCoverUrls}
                existingCoverUrls={{
                '4:3': postEdit.post.cover4x3Url,
                '3:4': postEdit.post.cover3x4Url
              }}
                isSubmitting={postEdit.isSubmitting}
                onTitleChange={postEdit.setTitle}
                onDescriptionChange={postEdit.setDescription}
                onCoverSelect={postEdit.handleCoverSelect}
                onAiCoverSelect={postEdit.handleAiCoverSelect}
                onMentionsChange={postEdit.setMentionedUsers}
              />
)}
          </div>
          {/* Extended information and Settings are create-only. They are static placeholders even
              there, and the reference's edit screen shows neither — offering controls that cannot
              act on a published post is worse than leaving them out. */}
          <div className="relative mt-5">
            <PostCreateActions
              mode="edit"
              isUploading={false}
              isSubmitting={postEdit.isSubmitting}
              hasChanges={postEdit.hasChanges}
              onPost={postEdit.handleSave}
              onCancel={postEdit.handleCancel}
            />
          </div>
        </div>
        {postEdit.isGraphic ? (
          <PostGraphicPreviewPanel
            readOnlyMedia
            items={postEdit.graphicItems}
            caption={postEdit.previewCaption}
          />
        ) : (
          <PostCreatePreviewPanel
            readOnlyMedia
            caption={postEdit.previewCaption}
            cover4x3Url={postEdit.cover4x3PreviewUrl}
            cover3x4Url={postEdit.cover3x4PreviewUrl}
            coverDisplayRatio={postEdit.coverDisplayRatio}
            hasSelectedCover={postEdit.hasSelectedCover}
            onCoverDisplayRatioChange={postEdit.setCoverDisplayRatio}
            initialPreviewUrl={postEdit.videoPreviewUrl}
          // Media cannot change in edit mode, so the upload callbacks are never reached.
            onUploadStart={() => { }}
            onUploadPrepared={() => { }}
            onUploadComplete={() => { }}
            onUploadInterrupted={() => { }}
            onUploadStateChange={() => { }}
          />
)}
      </div>
    </main>
  );
}
