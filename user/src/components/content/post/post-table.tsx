'use client';

import { FormFieldText } from '@components/ui/form-field';
import PostListItem from '@components/ui/list-items';
import PostList from '@components/ui/list-post';
import { type PaginatedApiResponse } from '@components/ui/pagination';
import Table from '@components/ui/table';
import { FILE_PROCESSING_STATUS, FILE_STATUS } from '@constants/file';
import { DEFAULT_PAGE_SIZE } from '@constants/pagination';
import { useIsMobile } from '@hooks/use-mobile';
import { usePaginationHandlers } from '@hooks/use-pagination-handlers';
import { usePaginationInitialState } from '@hooks/use-pagination-initial-state';
import { IPost } from '@interfaces/post';
import { formatDate } from '@lib/date';
import { getThumbnail } from '@lib/utils';
import { enhancePaginatedResponse, extractCursorFromRecord } from '@lib/utils/pagination';
import { deletePost, myPosts } from '@services/post.service';
import { useMutation, useQuery } from '@tanstack/react-query';
import debounce from 'lodash/debounce';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FiEdit, FiTrash2 } from 'react-icons/fi';
import { toast } from 'react-toastify';

interface PostTableProps {
  initialData: PaginatedApiResponse<IPost>;
  searchParams?: Record<string, string | string[] | undefined>;
}

export default function PostTable({ initialData, searchParams }: PostTableProps) {
  const router = useRouter();

  const {
    page: initialPage,
    pageSize: initialPageSize,
    sortBy: initialSortBy,
    sort: initialSort,
    filter: initialFilter,
    cursor: initialCursorState,
    lastCreatedAt: initialLastCreatedAt,
    sanitizedInitialData,
    maxOffset: initialMaxOffset
  } = usePaginationInitialState<IPost>({
    searchParams: searchParams ?? null,
    initialData,
    itemToCursor: extractCursorFromRecord,
    defaultPageSize: DEFAULT_PAGE_SIZE,
    defaultSortBy: 'updatedAt',
    defaultSort: 'desc'
  });

  const {
    currentPage,
    currentPageSize,
    sortBy,
    sort,
    filter,
    currentCursor,
    lastCreatedAt,
    maxOffsetLimit,
    setFilter,
    setMaxOffsetLimit,
    clampOffsetValue,
    updateRoute,
    handleCursorNext,
    handlePaginationChange,
    handleTableChange
  } = usePaginationHandlers<IPost>({
    initialPage,
    initialPageSize,
    initialSortBy,
    initialSort,
    initialFilter,
    initialCursor: initialCursorState,
    initialLastCreatedAt,
    initialMaxOffset,
    itemToCursor: extractCursorFromRecord
  });

  const { data, isFetching, isLoading, refetch } = useQuery({
    queryKey: ['creator-posts', currentPage, currentPageSize, filter, sortBy, sort, currentCursor, lastCreatedAt],
    queryFn: async () => {
      const desiredOffset = (currentPage - 1) * currentPageSize;
      const currentOffset = clampOffsetValue(desiredOffset);
      const params: any = {
        offset: currentOffset,
        limit: currentPageSize,
        ...filter,
        sortBy,
        sort
      };

      // Add cursor parameters if we're in cursor mode
      if (currentCursor && lastCreatedAt) {
        params.cursor = currentCursor.id;
        params.lastCreatedAt = lastCreatedAt;
      }

      const resp = await myPosts(params);
      return enhancePaginatedResponse<IPost>(resp.data, {
        offset: desiredOffset,
        limit: currentPageSize,
        itemToCursor: extractCursorFromRecord
      });
    },
    placeholderData: sanitizedInitialData,
    staleTime: 60000
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePost(id),
    onSuccess: () => {
      toast.success('Post deleted successfully');
      refetch();
    }
  });

  const posts = data?.data || [];
  const total = data?.total || 0;
  const hasMore = data?.hasMore || false;
  const nextCursor = data?.nextCursor || null;
  const paginationInfo = data?.paginationInfo;

  useEffect(() => {
    if (typeof paginationInfo?.maxOffset === 'number' && paginationInfo.maxOffset !== maxOffsetLimit) {
      setMaxOffsetLimit(paginationInfo.maxOffset);
    }
  }, [maxOffsetLimit, paginationInfo?.maxOffset, setMaxOffsetLimit]);

  const handleDeletePost = (id: string) => {
    if (window.confirm('Are you sure you want to delete this post?')) {
      deleteMutation.mutate(id);
    }
  };

  const handleSearch = debounce((value: string) => {
    const trimmed = value.trim();
    const nextFilter: Record<string, any> = { ...filter };

    if (trimmed) {
      nextFilter.q = trimmed;
    } else {
      delete nextFilter.q;
    }

    setFilter(nextFilter);

    updateRoute({
      page: 1,
      pageSize: currentPageSize,
      filter: nextFilter,
      extra: {
        cursor: null,
        lastCreatedAt: null,
        offset: 0
      }
    });
  }, 500);

  const columns: any = [
    {
      title: 'Thumbnail',
      dataIndex: 'thumbnailUrl',
      key: 'thumbnail',
      render: (_: string, record: IPost) => {
        const thumbUrl = getThumbnail(record);
        return (
          <div className="w-16 h-12 bg-surface-muted rounded overflow-hidden">
            <img src={thumbUrl} alt={record.text} className="w-full h-full object-cover" />
          </div>
        );
      }
    },
    {
      title: 'Text',
      dataIndex: 'text',
      key: 'text',
      render: (text: string) => <div className="max-w-xs truncate" title={text}>{text}</div>
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type'
    },
    {
      title: 'Processing status',
      dataIndex: 'filesProcessing',
      key: 'filesProcessing',
      render: (_: string, record: IPost) => {
        const videos = (record?.files || []).filter((f) => f.type.includes('video'));

        const isFailed = videos.some((f) => f.processingStatus === FILE_PROCESSING_STATUS.FAILED || f.status === FILE_STATUS.ERROR);
        const isInQueue = videos.some((f) => f.processingStatus === FILE_PROCESSING_STATUS.IN_QUEUE);
        const isProcessing = videos.some((f) => f.processingStatus === FILE_PROCESSING_STATUS.PROCESSING);
        const isPending = videos.some((f) => f.processingStatus === FILE_PROCESSING_STATUS.PENDING);

        return (
          <span
            title={isFailed ? 'Files-Processing failed' : isInQueue ? 'Files-Processing in queue' : isProcessing ? 'Files-Processing in progress' : 'Files-Processing completed'}
            className={`px-2 py-1 rounded text-xs font-medium ${isFailed ? 'bg-red-100 text-red-800' : isInQueue ? 'bg-blue-100 text-blue-800' : isProcessing ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'}`}
          >
            {isFailed ? 'Failed' : isInQueue ? 'In queue' : isProcessing ? 'Processing' : isPending ? 'Pending' : 'Completed'}
          </span>
        );
      }
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (status: string) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {status === 'active' ? 'Active' : 'Inactive'}
        </span>
      )
    },
    {
      title: 'Last Update',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      render: (date: string) => formatDate(new Date(date))
    },
    {
      title: 'Actions',
      key: 'actions',
      render: (_: any, record: IPost) => (
        <div className="flex space-x-3">
          {/* Edit button */}
          <button
            type="button"
            onClick={() => router.push(`/content/posts/update/${record._id}`)}
            className="text-primary hover:text-primary-700 transition-colors cursor-pointer"
            title="Edit Post"
          >
            <FiEdit size={18} />
          </button>

          {/* Delete button */}
          <button
            type="button"
            onClick={() => handleDeletePost(record._id)}
            className="text-red-600 hover:text-red-800 transition-colors disabled:opacity-50 cursor-pointer"
            disabled={deleteMutation.isPending}
            title="Delete Post"
          >
            {deleteMutation.isPending ? (
              <span className="text-xs">...</span>
            ) : (
              <FiTrash2 size={18} />
            )}
          </button>
        </div>
      )
    }
  ];

  // Wrapper functions to adapt handlePaginationChange and handleTableChange to component-specific logic
  const onPaginationChange = (page: number, pageSize?: number) => {
    handlePaginationChange(page, pageSize, posts, nextCursor, (message) => toast.warn(message));
  };

  const onTableChange = (paginationState: any, _filters: any, sorter: any, extra: any) => {
    handleTableChange(paginationState, _filters, sorter, extra, posts, nextCursor, (message) => toast.warn(message));
  };

  const isMobile = useIsMobile();

  return (
    <div className="space-y-4">
      <div className="md:w-64 w-full">
        <FormFieldText
          name=''
          type="text"
          placeholder="Search posts..."
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>
      {isMobile ? (
        <PostList
          data={posts}
          emptyMessage="No posts found"
          renderItem={(post) => {
            const thumb = getThumbnail(post);
            return (
              <PostListItem
                key={post._id}
                _id={post._id}
                text={post.text}
                thumbnailUrl={thumb}
                totalComment={post.totalComment}
                status={(
                  <span
                    className={`px-2 py-1 rounded text-xs font-medium ${post.status === 'active'
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                      }`}
                  >
                    {post.status}
                  </span>
                )}
                updatedAt={post.createdAt}
                actions={[
                  {
                    type: 'edit',
                    href: `/content/posts/update/${post._id}`
                  },
                  {
                    type: 'delete',
                    onClick: () => handleDeletePost(post._id)
                  }
                ]}
              >
                <>
                  {post.type} • {post.totalLike ?? 0} Likes • {post.totalComment ?? 0} Comments
                </>
              </PostListItem>
            );
          }}
          pagination={{
            current: currentPage,
            pageSize: currentPageSize,
            total,
            onChange: onPaginationChange,
            showSizeChanger: true,
            showTotal: (totalCount, range) => `${range[0]}-${range[1]} of ${totalCount} posts`,
            hasMore,
            nextCursor,
            paginationInfo,
            onCursorNext: handleCursorNext,
            showCursorNavigation: true
          }}
        />
      )
        : (
          <Table
            dataSource={posts}
            columns={columns}
            pagination={{
              current: currentPage,
              pageSize: currentPageSize,
              total,
              onChange: onPaginationChange,
              showSizeChanger: true,
              showTotal: (totalCount, range) => `${range[0]}-${range[1]} of ${totalCount} posts`,
              hasMore,
              nextCursor,
              paginationInfo,
              onCursorNext: handleCursorNext,
              showCursorNavigation: true
            }}
            loading={isFetching || isLoading || deleteMutation.isPending}
            onChange={onTableChange}
            rowKey="_id"
            scroll={{ x: 800 }}
          />
        )}
    </div>
  );
}
