'use client';

import PostCreateActions from '@components/post/post-create-actions';
import PostCreateSettings from '@components/post/post-create-settings';
import PostGraphicBasicInformation from '@components/post/post-graphic-basic-information';
import PostGraphicExtendedInformation from '@components/post/post-graphic-extended-information';
import PostGraphicPreviewPanel from '@components/post/post-graphic-preview-panel';
import Spin from '@components/ui/spin';
import { usePostGraphicCreate } from '@hooks/use-post-graphic-create';
import { useEffect, useRef } from 'react';

interface PostGraphicCreateClientProps {
  userId: string;
}

export default function PostGraphicCreateClient({ userId }: PostGraphicCreateClientProps) {
  const graphicCreate = usePostGraphicCreate(userId);
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
      const scrollTop = scrollTarget === window ? window.scrollY : (scrollTarget as HTMLElement).scrollTop;
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

  if (!graphicCreate.canAccessCreatePage) {
    return (
      <main ref={pageRef} className="flex min-h-[calc(100vh-3.5rem)] min-w-[912px] items-center justify-center bg-(--post-bg)">
        <Spin size="large" tip="Preparing your graphics..." />
      </main>
    );
  }

  return (
    <main ref={pageRef} className="relative min-h-[calc(100vh-3.5rem)] min-w-[912px] shrink-0 bg-(--post-bg) text-(--text-strong)">
      <div className="flex min-h-full w-full justify-center rounded-lg p-10">
        <div className="mr-12 flex w-[778px] flex-col">
          <div className="relative">
            <PostGraphicBasicInformation
              title={graphicCreate.title}
              description={graphicCreate.description}
              topicKey={graphicCreate.topicKey}
              descriptionEditorRef={graphicCreate.descriptionEditorRef}
              items={graphicCreate.items}
              selectedCoverId={graphicCreate.selectedCoverId}
              isSubmitting={graphicCreate.isSubmitting}
              onTitleChange={graphicCreate.setTitle}
              onDescriptionChange={graphicCreate.setDescription}
              onTopicChange={graphicCreate.setTopicKey}
              onCoverSelect={graphicCreate.setSelectedCoverId}
              onAddFiles={graphicCreate.addFiles}
              onRemoveItem={graphicCreate.removeItem}
              onReplaceItem={graphicCreate.replaceItem}
              onReorderItems={graphicCreate.reorderItems}
            />
          </div>
          <div className="relative mt-5"><PostGraphicExtendedInformation /></div>
          <div className="relative mt-5"><PostCreateSettings /></div>
          <div className="relative mt-5">
            {graphicCreate.isUploading ? (
              <div className="absolute left-1/2 top-4 z-10 w-[260px] -translate-x-1/2">
                <div className="h-1 overflow-hidden rounded-full bg-(--border-soft)"><div className="h-full bg-[#fe2c55] transition-[width]" style={{ width: `${graphicCreate.uploadPercentage}%` }} /></div>
              </div>
            ) : null}
            <PostCreateActions
              isUploading={graphicCreate.isUploading}
              isSubmitting={graphicCreate.isSubmitting}
              onPost={graphicCreate.handlePost}
            />
          </div>
        </div>
        <PostGraphicPreviewPanel
          items={graphicCreate.items}
          caption={graphicCreate.previewCaption}
          onReplaceFiles={graphicCreate.replaceFiles}
        />
      </div>
    </main>
  );
}
