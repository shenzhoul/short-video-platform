'use client';

import PostTable from '@components/content/post/post-table';
import ScrollListPost from '@components/content/post/scroll-list';
import SearchFilter from '@components/shared/search-filter';
import Button from '@components/ui/button';
import NoData from '@components/ui/no-data';
import { useCreatorPostSearch } from '@hooks/use-creator-post-search';
import type { PaginatedApiResponse } from '@interfaces/pagination';
import { IPost } from '@interfaces/post';
import { FC, useMemo, useState } from 'react';
import { FaList, FaPlus, FaTh } from 'react-icons/fa';

interface CreatorPostClientProps {
  initialData: PaginatedApiResponse<IPost>;
  searchParams?: Record<string, string | string[] | undefined>;
}

export const CreatorPostClient: FC<CreatorPostClientProps> = ({
  initialData,
  searchParams
}) => {
  const [view, setView] = useState<'table' | 'scroll'>('table');
  const {
    posts: initialPosts,
    total: initialTotal,
    hasMore: initialHasMore,
    nextCursor: initialNextCursor
  } = useMemo(() => ({
    posts: initialData?.data ?? [],
    total: typeof initialData?.total === 'number' ? initialData.total : (initialData?.data?.length ?? 0),
    hasMore: initialData?.hasMore ?? false,
    nextCursor: initialData?.nextCursor ?? null
  }), [initialData]);
  const {
    posts,
    total,
    loading,
    hasMore,
    nextCursor,
    handleFilter,
    loadMore,
    deletePost
  } = useCreatorPostSearch({
    initialPosts,
    initialTotal,
    initialHasMore,
    initialNextCursor
  });

  const postTypes = [
    { key: '', text: 'All types' },
    { key: 'text', text: 'Text' },
    { key: 'photo', text: 'Photo' },
    { key: 'video', text: 'Video' }
  ];

  return (
    <>
      <div className="flex items-center justify-between">
        <h2 className="font-bold text-xl">{`${total} posts`}</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setView('table')} className={`p-3 cursor-pointer rounded-full ${view === 'table' ? 'bg-primary text-white' : 'bg-surface-muted'}`}><FaTh /></button>
          <button type="button" onClick={() => setView('scroll')} className={`p-3 cursor-pointer rounded-full ${view === 'scroll' ? 'bg-primary text-white' : 'bg-surface-muted'}`}><FaList /></button>
          <Button href="/content/posts/create" size='md'>
            <FaPlus />
            <span>New Post</span>
          </Button>
        </div>
      </div>
      {/* Main Content */}
      <div className="">
        {view === 'table' ? (
          <PostTable
            initialData={{
              data: posts,
              total,
              hasMore,
              nextCursor: nextCursor ?? undefined,
              paginationInfo: initialData.paginationInfo
            }}
            searchParams={searchParams}
          />
        ) : (
          <>
            <div className="mb-8 max-w-4xl mx-auto">
              <SearchFilter
                type={postTypes}
                onSubmit={handleFilter}
                searchWithKeyword
              />
            </div>
            <div className="space-y-4 max-w-2xl mx-auto">
              <ScrollListPost
                items={posts}
                canLoadMore={hasMore}
                loadMore={loadMore}
                onDelete={(post: IPost) => deletePost(post._id)}
              />
              {!loading && posts.length === 0 && (
                <NoData
                  title='No posts found'
                  description='Create your first post!'
                />
              )}
              {loading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
                </div>
              ) : null}
            </div>
          </>
        )}
      </div>
    </>
  );
};
