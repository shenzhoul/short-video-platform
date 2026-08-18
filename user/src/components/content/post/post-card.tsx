'use client';

/**
 * PostCard Component
 *
 * A comprehensive card component for displaying social media post items with rich media content.
 * This is the main post item component used throughout the application.
 *
 * Features:
 * - Mixed media display (images, videos) with carousel functionality
 * - User interaction buttons (like, comment, tip, share)
 * - Post content with text, polls, and metadata
 * - Creator profile integration with subscription handling
 * - Teaser video modal for premium content previews
 * - Responsive design for mobile and desktop
 * - Video autoplay management and viewport detection
 * - Purchase flow integration for paid content
 *
 * The component handles both free and premium content, showing appropriate
 * purchase buttons and teaser previews for locked content.
 *
 * Usage:
 * ```tsx
 * <PostCard
 *   post={postData}
 *   onDelete={handleDelete}
 * />
 * ```
 */

import { PostActions, PostMenu } from '@components/content/post';
import { usePostDetails } from '@hooks/use-content';
import { useUserOnlineStatus } from '@hooks/use-user-online-status';
import { linkifyText } from '@lib/html-helper';
import { formatDateFromNow } from '@lib/index';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { IPost } from 'src/interfaces';
import { useProfile } from 'src/providers/profile.provider';

const TeaserVideoModal = dynamic(() => import('../common/teaser-video-modal'), { ssr: false });
const PostMediaDisplay = dynamic(() => import('./post-media-display'));
const CommentWrapper = dynamic(() => import('@components/comment/comment-wrapper'), { ssr: false });

type Props = {
  post: IPost;
  onDelete?: (f: IPost) => void;
};

export default function PostCard({ post, onDelete }: Props) {
  const router = useRouter();
  const { current: user } = useProfile();
  // Use the post details hook
  const { post: currentPost } = usePostDetails(post);

  const [isOpenComment, setIsOpenComment] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const pathname = usePathname();

  // Track creator's online status
  const { isOnline: creatorIsOnline } = useUserOnlineStatus({
    userId: post?.user?._id || '',
    initialOnlineStatus: post?.user?.isOnline || false
  });

  const [totalComment, setTotalComment] = useState<number>(currentPost?.totalComment || 0);

  const [openTeaser, setOpenTeaser] = useState(false);
  const [previewThumbnail, setPreviewThumbnail] = useState<string | null>(null);

  const creator = post?.user;

  const onToggleComments = () => {
    if (currentPost?.isCreatorDeleted) return;
    setIsOpenComment(!isOpenComment);
  };

  const handleCommentTotalChange = (total: number) => {
    setTotalComment(total);
  };

  const onClickViewPost = () => {
    if (!user?._id) {
      toast.error('You can subscribe to the model once you login/register.');
      router.push(`/auth/login?redirectUrl=${encodeURIComponent(pathname)}`);
      return;
    }
  };

  const actionsDisabled = currentPost.isCreatorDeleted;

  // Handle client-side mounting for pathname access
  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    setTotalComment(currentPost?.totalComment || 0);
    // Prioritize thumbnailUrl from API response
    if (currentPost?.thumbnailUrl) {
      setPreviewThumbnail(currentPost.thumbnailUrl);
    } else {
      // Fallback: try to find first file's thumbnail (not blurImage)
      const found = currentPost?.files?.find((f) => f.thumbnails && f.thumbnails.length > 0);
      if (found) {
        setPreviewThumbnail(found.thumbnails[0]);
      } else {
        // Last resort: use blurImage if no thumbnails available
        const foundBlur = currentPost?.files?.find((f) => f.blurImage);
        if (foundBlur) setPreviewThumbnail(foundBlur.blurImage);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPost?._id]);

  return (
    <>
      <div className="hover:bg-surface-soft border-b border-border mb-4">
        {/* Top */}
        <div className="flex justify-between p-3 pb-0">
          <Link href={`/${creator?.username || ''}`}>
            <div className="flex cursor-pointer relative">
              <img alt="creator_avatar" src={creator?.avatar || '/no_avatar.jpeg'} width="50" height="50" className="w-10 h-10 rounded-full" />
              <div className="px-2">
                <h4 className="text-sm font-semibold m-0 capitalize">{creator?.name || 'N/A'}</h4>
                <h5 className="text-xs opacity-70 m-0">@{creator?.username || 'N/A'}</h5>
              </div>
              {creatorIsOnline ? (
                <span className="w-2 h-2 bg-green-500 rounded-full absolute bottom-1 left-8" />
              ) : (
                <span className="w-2 h-2 bg-gray-400 rounded-full absolute bottom-1 left-8" />
              )}
            </div>
          </Link>
          <div className="flex items-center space-x-2">
            <span className="text-xs opacity-70 whitespace-nowrap text-right">{formatDateFromNow(currentPost.createdAt)}</span>
            <PostMenu
              post={currentPost}
              currentUser={user}
              isMounted={isMounted}
              onDelete={onDelete}
            />
          </div>
        </div>

        {currentPost?.text ? <div className="text-sm whitespace-pre-line p-3">{linkifyText(currentPost.text)}</div> : null}

        <PostMediaDisplay
          variant='slider'
          post={currentPost}
          user={user}
          creator={creator}
          previewThumbnail={previewThumbnail}
          actionsDisabled={actionsDisabled}
          onClickViewPost={onClickViewPost}
          onViewTeaser={() => setOpenTeaser(true)}
        />

        {/* Bottom / Actions */}
        {/* Show warning if creator is deleted */}
        {currentPost.isCreatorDeleted ? (
          <div className="mx-3 mt-2 p-2 bg-orange-50 border border-orange-200 rounded-md text-sm text-orange-700">
            ⚠️ This creator&apos;s account has been deleted. Interactions are disabled.
          </div>
        ) : null}

        <div className="flex w-full transition-all duration-300 py-2">
          <div className="w-full p-1">
            <PostActions
              post={currentPost}
              currentUser={user}
              totalComments={totalComment}
              disabled={actionsDisabled}
              isCommentOpen={isOpenComment}
              onCommentClick={onToggleComments}
            />
          </div>
        </div>
        {isOpenComment && !currentPost.isCreatorDeleted ? (
          <div className='mt-2 p-3'>
            <CommentWrapper
              contentId={currentPost._id}
              contentType="post"
              user={user}
              initialVisible={isOpenComment}
              canReply
              onTotalChange={handleCommentTotalChange}
              className="space-y-4"
            />
          </div>
        ) : null}
      </div>

      {openTeaser ? (
        <TeaserVideoModal
          open={openTeaser}
          onClose={() => setOpenTeaser(false)}
          teaser={currentPost?.teaser}
          title="Teaser Video"
        />
      ) : null}
    </>
  );
}
