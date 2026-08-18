/**
 * PostPageClient Component
 *
 * A client-side component for displaying individual post/post details with full functionality.
 * Handles post deletion, navigation, and displays the post content using PostCard.
 *
 * @example
 * // Basic usage with post data
 * <PostPageClient post={postData} />
 *
 * Features:
 * - Individual post display with full content
 * - Post deletion functionality (owner only)
 * - Back navigation with history support
 * - Loading states during deletion
 * - Permission-based actions
 * - Toast notifications for user postback
 * - Responsive design with proper spacing
 * - SEO-friendly post display
 */

'use client';

import PostCard from '@components/content/post/post-card';
import { IPost } from '@interfaces/post';
import { showErrorMessage } from '@lib/utils';
import { deletePost } from '@services/post.service';
import { useRouter } from 'next/navigation';
import { FC, useState } from 'react';
import { AiOutlineArrowLeft } from 'react-icons/ai';
import { toast } from 'react-toastify';
import { useProfile } from 'src/providers/profile.provider';

interface PostPageClientProps {
  post: IPost;
}

export const PostPageClient: FC<PostPageClientProps> = ({ post }) => {
  const router = useRouter();
  const { current: currentUser } = useProfile();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleBack = () => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  };

  // Handle delete post
  const handleDelete = async (postToDelete: IPost) => {
    if (currentUser?._id !== postToDelete.userId) {
      toast.error('Permission denied');
      return;
    }

    if (!window.confirm('Are you sure you want to delete this post?')) {
      return;
    }

    setIsDeleting(true);
    try {
      await deletePost(postToDelete._id);
      toast.success('Post deleted successfully');
      handleBack();
    } catch (error: any) {
      showErrorMessage(error);
    } finally {
      setIsDeleting(false);
    }
  };

  const creator = post.user;

  return (
    <div className="min-h-screen bg-surface rounded-xl">
      <div className="max-w-2xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <button
            type="button"
            onClick={handleBack}
            className="flex items-center gap-2 opacity-60 transition-colors font-medium"
          >
            <AiOutlineArrowLeft size={20} />
            <span>{creator?.name || 'User'}&apos;s Post</span>
          </button>
        </div>

        {/* Post Card */}
        <div className="bg-surface rounded-lg shadow-xs">
          <PostCard
            post={post}
            onDelete={handleDelete}
          />
        </div>

        {/* Delete Loading Overlay */}
        {isDeleting ? (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-surface rounded-lg p-6 text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-4" />
              <p className="opacity-60">Deleting post...</p>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
