'use client';

import Modal from '@components/ui/modal';
import NoData from '@components/ui/no-data';
import Spin from '@components/ui/spin';
import { useCreatorPostSearch } from '@hooks/use-creator-post-search';
import type { IPost } from '@interfaces/post';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';

import CreatorPostRow from './creator-post-row';
import CreatorPostsToolbar from './creator-posts-toolbar';

/**
 * Content management: the creator's works as full-width rows.
 *
 * Reuses `useCreatorPostSearch` for cursor pagination and confirmed deletion. The screen owns the
 * styled confirmation modal, while the hook owns the API request and list/total reconciliation.
 *
 * Posts are shown exactly as the API returns them, including soft-deleted ones with their status.
 * Filtering those out client-side would desynchronise the page from `limit`/`total` and make
 * pagination wrong, and the API has no status filter to do it properly.
 */
export default function CreatorPostsClient() {
  const {
    posts,
    total,
    loading,
    hasMore,
    handleFilter,
    loadMore,
    deletePostConfirmed,
    isDeleting,
    pinningPostId,
    togglePinned
  } = useCreatorPostSearch({});
  const hasRequestedRef = useRef(false);
  const [postToDelete, setPostToDelete] = useState<IPost | null>(null);

  useEffect(() => {
    // The hook does not fetch on mount, and a ref guard keeps Strict Mode's double-invoke from
    // issuing the request twice.
    if (hasRequestedRef.current) return;
    hasRequestedRef.current = true;
    handleFilter({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isInitialLoad = loading && !posts.length;
  const confirmDelete = async () => {
    if (!postToDelete || isDeleting) return;
    const deletedIds = await deletePostConfirmed(postToDelete._id);
    if (deletedIds.length) setPostToDelete(null);
  };

  return (
    <main className="flex min-h-0 flex-1 overflow-hidden bg-(--post-bg) p-4 text-(--text-strong)">
      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg bg-(--surface-raised)">
        <div className="shrink-0 px-8 pb-4 pt-6 text-[16px] font-semibold leading-6">Content management</div>

        <CreatorPostsToolbar worksCount={total} />

        <div className="scrollbar-custom min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {isInitialLoad ? (
            <div className="flex justify-center py-20">
              <Spin size="large" tip="Loading your works..." />
            </div>
          ) : null}

          {!isInitialLoad && !posts.length ? (
            <NoData
              title="No works yet"
              description={(
                <p className="mx-auto max-w-sm text-sm opacity-60">
                  Everything you publish shows up here.{' '}
                  <Link href="/creator/publish" className="text-[#fe2c55] hover:underline">Publish your first work</Link>
                  .
                </p>
              )}
            />
          ) : null}

          {posts.length ? (
            <ul>
              {posts.map(post => (
                <CreatorPostRow
                  key={post._id}
                  post={post}
                  isDeleting={Boolean(isDeleting && postToDelete?._id === post._id)}
                  isPinning={pinningPostId === post._id}
                  onDelete={setPostToDelete}
                  onTogglePinned={(item) => void togglePinned(item)}
                />
              ))}
            </ul>
          ) : null}

          {posts.length ? (
            <div className="flex justify-center py-8 text-[13px] font-normal text-(--text-faint)">
              {hasMore ? (
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loading}
                  className="h-9 cursor-pointer rounded-sm border border-(--border-soft) px-6 text-sm font-medium text-(--text-soft) transition hover:border-[#fe2c55] hover:text-[#fe2c55] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Loading...' : 'Load more'}
                </button>
              ) : (
                <span>No more works</span>
              )}
            </div>
          ) : null}
        </div>
      </section>
      <Modal
        open={Boolean(postToDelete)}
        width={472}
        footer={false}
        noPadding
        maskClosable={!isDeleting}
        onCancel={() => {
          if (!isDeleting) setPostToDelete(null);
        }}
        className="border border-(--border-soft) bg-(--surface-raised) text-(--text-strong) shadow-[0_16px_48px_rgba(0,0,0,.28)]"
      >
        <div className="px-6 py-6">
          <div className="flex items-center gap-3 pr-8">
            <FiAlertTriangle className="shrink-0 text-2xl text-[#ff9f00]" />
            <h2 className="m-0 text-[17px] font-semibold leading-6">Are you sure you want to delete this work?</h2>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => setPostToDelete(null)}
              className="h-8 min-w-16 cursor-pointer rounded-sm bg-(--action-card-bg) px-4 text-[13px] font-medium text-(--text-soft) transition-colors hover:text-(--text-strong) disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isDeleting}
              onClick={() => void confirmDelete()}
              className="h-8 min-w-16 cursor-pointer rounded-sm bg-[#fe2c55] px-4 text-[13px] font-medium text-white transition-colors hover:bg-[#e9274e] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>
        </div>
      </Modal>
    </main>
  );
}
