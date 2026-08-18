'use client';

import Dropdown from '@components/ui/dropdown-menu';
import { useEffect, useState } from 'react';
import { FiTrash2 } from 'react-icons/fi';
import { FiMoreHorizontal } from 'react-icons/fi';
import { IPost, IUser } from 'src/interfaces';
import { useProfile } from 'src/providers/profile.provider';

interface PostMenuProps {
  /** Post data */
  post: IPost;
  /** Current user */
  currentUser?: IUser;
  /** Whether the component is mounted (for client-side checks) */
  isMounted?: boolean;
  /** Callback when delete is clicked */
  onDelete?: (post: IPost) => void;
  /** Additional CSS classes */
  className?: string;
}

/**
 * PostMenu - A dropdown menu component for post actions
 *
 * This component includes:
 * - Delete post button (for post owner)
 *
 * Note: Copy link functionality is now handled by ShareButton in PostActions
 *
 * @example
 * <PostMenu
 *   post={post}
 *   currentUser={user}
 *   isMounted={true}
 *   onDelete={(post) => handleDelete(post)}
 * />
 */
export default function PostMenu({
  post,
  isMounted = false,
  onDelete,
  className = ''
}: PostMenuProps) {
  const { current: user } = useProfile();
  const isOwner = post.userId && user?._id === post.userId;
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    const newData = [
      isOwner && {
        label: 'Delete Post',
        value: 'delete',
        icon: <FiTrash2 />,
        onClick: () => onDelete?.(post)
      }
    ].filter(Boolean);
    setData(newData);
  }, [isOwner, post, onDelete]);

  return (
    <div className={`flex items-center space-x-1 ${className}`}>
      {/* Post details */}
      {Array.isArray(data) && data.length > 0 && isMounted && typeof window !== 'undefined' ? (
        <Dropdown
          trigger={<FiMoreHorizontal className="text-xl cursor-pointer opacity-60 hover:text-black" />}
          position="right"
          width={200}
          data={data}
        />
      ) : null}
    </div>
  );
}
