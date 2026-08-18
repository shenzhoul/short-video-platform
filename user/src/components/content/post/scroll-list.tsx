'use client';

import PostCard from '@components/content/post/post-card';
import InfiniteScroll from 'react-infinite-scroll-component';
import type { IPost } from 'src/interfaces';

interface IProps {
  items?: IPost[];
  canLoadMore: boolean;
  loadMore: () => void;
  onDelete: (post: IPost) => void;
}

export default function ScrollListPost({
  items = [],
  loadMore,
  onDelete,
  canLoadMore
}: IProps) {
  return (
    <InfiniteScroll
      dataLength={items.length}
      hasMore={canLoadMore}
      loader={null}
      next={loadMore}
      endMessage={<p style={{ textAlign: 'center' }} />}
      scrollThreshold={0.9}
    >
      <div className="pb-3">
        {items.length > 0 &&
          items.map((item) =>
            <PostCard post={item} key={item._id} onDelete={onDelete} />
          )}
      </div>
    </InfiniteScroll>
  );
}
