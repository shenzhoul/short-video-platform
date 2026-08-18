'use client';

import PostCreateActions from '@components/post/post-create-actions';
import PostCreateBasicInformation from '@components/post/post-create-basic-information';
import PostCreateExtendedInformation from '@components/post/post-create-extended-information';
import PostCreatePreviewPanel from '@components/post/post-create-preview-panel';
import PostCreateSettings from '@components/post/post-create-settings';
import Spin from '@components/ui/spin';
import { usePostCreate } from '@hooks/use-post-create';
import { useEffect, useRef } from 'react';

interface PostCreateClientProps {
  userId: string;
}

export default function PostCreateClient({ userId }: PostCreateClientProps) {
  const postCreate = usePostCreate(userId);
  const pageRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const previousHeader = root.style.getPropertyValue('--header-bg');
    let scrollContainer = pageRef.current?.parentElement;

    while (scrollContainer) {
      const overflowY = window.getComputedStyle(scrollContainer).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') break;
      scrollContainer = scrollContainer.parentElement;
    }

    const scrollTarget: HTMLElement | Window = scrollContainer || window;
    const updateHeaderBackground = () => {
      const scrollTop = scrollTarget === window
        ? window.scrollY
        : (scrollTarget as HTMLElement).scrollTop;

      if (scrollTop > 48) root.style.setProperty('--header-bg', 'var(--page-bg)');
      else root.style.removeProperty('--header-bg');
    };

    updateHeaderBackground();
    scrollTarget.addEventListener('scroll', updateHeaderBackground, { passive: true });

    return () => {
      scrollTarget.removeEventListener('scroll', updateHeaderBackground);
      if (previousHeader) root.style.setProperty('--header-bg', previousHeader);
      else root.style.removeProperty('--header-bg');
    };
  }, []);

  if (!postCreate.canAccessCreatePage) {
    return (
      <main
        ref={pageRef}
        className="flex min-h-[calc(100vh-3.5rem)] min-w-[912px] shrink-0 items-center justify-center bg-(--post-bg) text-(--text-strong)"
      >
        {postCreate.isCheckingAccess ? (
          <Spin size="large" tip="Checking your video..." />
        ) : null}
      </main>
    );
  }

  return (
    <main
      ref={pageRef}
      className="relative min-h-[calc(100vh-3.5rem)] min-w-[912px] shrink-0 bg-(--post-bg) text-(--text-strong)"
    >
      <div className="flex min-h-full w-full justify-center rounded-lg p-10">
        <div className="mr-12 flex w-[778px] flex-col">
          <div className="relative">
            <PostCreateBasicInformation
              title={postCreate.title}
              description={postCreate.description}
              descriptionEditorRef={postCreate.descriptionEditorRef}
              generatedCoverUrls={postCreate.generatedCoverUrls}
              selectedCoverIndex={postCreate.selectedCoverIndex}
              customCoverUrls={postCreate.customCoverUrls}
              isSubmitting={postCreate.isSubmitting}
              onTitleChange={postCreate.setTitle}
              onDescriptionChange={postCreate.setDescription}
              onCoverSelect={postCreate.handleCoverSelect}
              onAiCoverSelect={postCreate.handleAiCoverSelect}
              topicKey={postCreate.topicKey}
              onTopicChange={postCreate.setTopicKey}
              onMentionsChange={postCreate.setMentionedUsers}
            />
          </div>
          <div className="relative mt-5">
            <PostCreateExtendedInformation />
          </div>
          <div className="relative mt-5">
            <PostCreateSettings />
          </div>
          <div className="relative mt-5">
            <PostCreateActions
              isUploading={postCreate.isUploading}
              isSubmitting={postCreate.isSubmitting}
              onPost={postCreate.handlePost}
            />
          </div>
        </div>
        <PostCreatePreviewPanel
          caption={postCreate.previewCaption}
          cover4x3Url={postCreate.cover4x3PreviewUrl}
          cover3x4Url={postCreate.cover3x4PreviewUrl}
          coverDisplayRatio={postCreate.coverDisplayRatio}
          hasSelectedCover={postCreate.hasSelectedCover}
          onCoverDisplayRatioChange={postCreate.setCoverDisplayRatio}
          initialPreviewUrl={postCreate.restoredPreviewUrl}
          initialUploadFile={postCreate.initialUploadFile}
          onUploadStart={postCreate.handleUploadStart}
          onUploadPrepared={postCreate.handleUploadPrepared}
          onUploadComplete={postCreate.handleUploadComplete}
          onUploadInterrupted={postCreate.handleUploadInterrupted}
          onUploadStateChange={postCreate.setIsUploading}
          onPreviewUrlChange={postCreate.setCoverVideoPreviewUrl}
        />
      </div>
    </main>
  );
}
