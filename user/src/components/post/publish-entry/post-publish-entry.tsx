'use client';

import { usePostPublishEntry } from '@hooks/use-post-publish-entry';
import {
  CREATOR_PUBLISH_TABS,
  type CreatorPublishTabKey,
  getCreatorPublishUrl
} from '@lib/creator-publish';
import { useRouter, useSearchParams } from 'next/navigation';
import { type HTMLAttributes, type ReactNode, useEffect, useState } from 'react';
import { FaChevronRight } from 'react-icons/fa';
import { type TabItem, Tabs } from 'src/components/ui/tabs';

import PostArticlePublishSection from './post-article-publish-section';
import PostDraftBanner from './post-draft-banner';
import PostPhotoUploadSection from './post-photo-upload-section';
import PostVideoUploadSection from './post-video-upload-section';
import PostVrUploadSection from './post-vr-upload-section';

interface PostPublishTab extends TabItem<CreatorPublishTabKey> {
  text: string;
}

const POST_PUBLISH_TABS: PostPublishTab[] = CREATOR_PUBLISH_TABS;

interface PostPublishNavigationProps {
  getTabProps: (item: PostPublishTab) => HTMLAttributes<HTMLElement>;
  isActive: (item: PostPublishTab) => boolean;
}

interface PostPublishPanelProps {
  active: boolean;
  children: ReactNode;
}

function PostPublishPanel({ active, children }: PostPublishPanelProps) {
  return (
    <div
      role="tabpanel"
      aria-hidden={!active}
      inert={!active}
      className={`transition-[opacity,transform] duration-300 ease-in-out motion-reduce:transition-none ${active
        ? 'relative translate-x-0 opacity-100'
        : 'pointer-events-none absolute inset-0 translate-x-15 opacity-0'
        }`}
    >
      {children}
    </div>
  );
}

function PostPublishNavigation({
  getTabProps,
  isActive
}: PostPublishNavigationProps) {
  return (
    <nav
      aria-label="Publishing type"
      role="tablist"
      className="relative flex items-center border-b border-(--border-faint)"
    >
      <div className="flex h-12 items-stretch gap-8">
        {POST_PUBLISH_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            {...getTabProps(tab)}
            className={`inline-flex h-12 shrink-0 cursor-pointer items-center border-b-[3px] p-0 text-base font-medium leading-none transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#fe2c55] ${isActive(tab)
              ? 'border-b-[#fe2c55] text-(--text-strong)'
              : 'border-b-transparent text-(--text-muted) hover:text-(--text-strong)'
              }`}
          >
            {tab.text}
          </button>
        ))}
      </div>
      <span
        className="ml-auto flex shrink-0 items-center gap-1 pl-8 text-right text-xs text-[#168ef9]"
      >
        Learn more about upload rules
        <FaChevronRight className="text-[10px]" />
      </span>
    </nav>
  );
}

export default function PostPublishEntry() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const defaultTab = POST_PUBLISH_TABS.some(tab => tab.key === requestedTab)
    ? requestedTab as CreatorPublishTabKey
    : 'uploadVideo';
  const [activeTab, setActiveTab] = useState<CreatorPublishTabKey>(defaultTab);
  const {
    draft,
    graphicDraft,
    isDiscarding,
    isDiscardingGraphic,
    handleContinueDraft,
    handleContinueGraphicDraft,
    handleDiscardDraft,
    handleDiscardGraphicDraft,
    handlePhotoDrop,
    handlePhotoFileChange,
    handleVideoDrop,
    handleVideoFileChange
  } = usePostPublishEntry();

  useEffect(() => {
    if (POST_PUBLISH_TABS.some(tab => tab.key === requestedTab)) {
      setActiveTab(requestedTab as CreatorPublishTabKey);
    }
  }, [requestedTab]);

  return (
    <main className="relative min-h-[calc(100vh-3.5rem)] min-w-228 bg-(--post-bg) p-6 text-(--text-strong)">
      <section className="min-h-[calc(100vh-5.5rem)] w-full overflow-hidden rounded-lg bg-(--surface-raised) px-6 pb-8">
        <Tabs
          tabs={POST_PUBLISH_TABS}
          value={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            router.replace(getCreatorPublishUrl(key), { scroll: false });
          }}
        >
          {({ activeKey, getTabProps, isActive }) => (
            <>
              <PostPublishNavigation
                getTabProps={getTabProps}
                isActive={isActive}
              />
              {activeKey === 'uploadVideo' && draft ? (
                <PostDraftBanner
                  message="There is an unpublished video. Do you want to continue editing?"
                  detail={draft.fileName}
                  isDiscarding={isDiscarding}
                  onContinue={handleContinueDraft}
                  onDiscard={handleDiscardDraft}
                />
              ) : null}
              {activeKey === 'uploadGraphic' && graphicDraft ? (
                <PostDraftBanner
                  message="There are unpublished graphics. Do you want to continue editing?"
                  detail={`${graphicDraft.items.length} image${graphicDraft.items.length === 1 ? '' : 's'}`}
                  isDiscarding={isDiscardingGraphic}
                  onContinue={handleContinueGraphicDraft}
                  onDiscard={handleDiscardGraphicDraft}
                />
              ) : null}
              <div className="relative mt-2 box-border w-full overflow-hidden">
                <PostPublishPanel active={activeKey === 'uploadVideo'}>
                  <PostVideoUploadSection
                    onChange={handleVideoFileChange}
                    onDrop={handleVideoDrop}
                  />
                </PostPublishPanel>
                <PostPublishPanel active={activeKey === 'uploadGraphic'}>
                  <PostPhotoUploadSection
                    onChange={handlePhotoFileChange}
                    onDrop={handlePhotoDrop}
                  />
                </PostPublishPanel>
                <PostPublishPanel active={activeKey === 'uploadVR'}>
                  <PostVrUploadSection />
                </PostPublishPanel>
                <PostPublishPanel active={activeKey === 'publishArticle'}>
                  <PostArticlePublishSection />
                </PostPublishPanel>
              </div>
            </>
          )}
        </Tabs>
      </section>
    </main>
  );
}
