'use client';

import Button from '@components/ui/button';
import { Tooltip } from '@components/ui/tooltip';
import { thousandToK } from '@lib/index';
import { showErrorMessage } from '@lib/utils';
import { useAuthModal } from '@providers/auth-modal.provider';
import { toggleReaction } from '@services/reaction.service';
import { useMutation } from '@tanstack/react-query';
import { ReactNode, useEffect, useState } from 'react';
import { AiFillHeart, AiOutlineHeart } from 'react-icons/ai';
import { FiBookmark } from 'react-icons/fi';
import { useProfile } from 'src/providers/profile.provider';

type IconType = 'liked' | 'wishlist';

type RenderIconParams = {
  isLiked: boolean;
  totalLikes: number;
  isPending: boolean;
  animating: boolean;
};

interface LikeButtonProps {
  contentType: string;
  contentId: string;
  initialIsLiked?: boolean;
  initialTotalLikes?: number;
  disabled?: boolean;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'grey' | 'grey-light' | 'border';
  showCount?: boolean;
  iconSize?: number;
  iconType?: IconType;
  requireLogin?: (() => boolean) | null;
  onSuccess?: (isLiked: boolean, totalLikes: number) => void;
  onError?: (error: any) => void;
  renderIcon?: (params: RenderIconParams) => ReactNode;
  renderCount?: (totalLikes: number) => ReactNode;
  tooltip?: boolean;
  tooltipTitle?: string;
  unstyled?: boolean;
  animateOnLike?: boolean;
}

export default function LikeButton({
  contentType,
  contentId,
  initialIsLiked = false,
  initialTotalLikes = 0,
  disabled = false,
  className = '',
  size = 'md',
  variant = 'grey-light',
  showCount = true,
  iconSize = 16,
  iconType = 'liked',
  requireLogin = null,
  onSuccess,
  onError,
  renderIcon,
  renderCount,
  tooltip = true,
  tooltipTitle,
  unstyled = false,
  animateOnLike = false
}: LikeButtonProps) {
  const { loggedIn } = useProfile();
  const { openAuthModal } = useAuthModal();
  const [isLiked, setIsLiked] = useState(initialIsLiked);
  const [totalLikes, setTotalLikes] = useState(initialTotalLikes);
  const [animating, setAnimating] = useState(false);

  // Two effects rather than one, and the split is load-bearing.
  //
  // A live total arriving because *somebody else* liked this content changes
  // only `initialTotalLikes`. Resetting both together would then also reset
  // `isLiked` back to the value this content was fetched with — silently
  // un-filling the heart of a viewer who had just liked it themselves, whenever
  // a stranger liked the same comment.
  useEffect(() => {
    setIsLiked(initialIsLiked);
  }, [initialIsLiked]);

  useEffect(() => {
    setTotalLikes(initialTotalLikes);
  }, [initialTotalLikes]);

  const likeMutation = useMutation({
    mutationFn: async () => {
      const res = await toggleReaction(contentType, contentId, { action: 'like' });
      return (res && (res.data ?? res)) as { action: 'added' | 'removed' };
    },
    onMutate: async () => {
      const nextIsLiked = !isLiked;
      const snapshot = { prevLiked: isLiked, prevTotal: totalLikes };

      setIsLiked(nextIsLiked);
      setTotalLikes((n) => (nextIsLiked ? n + 1 : Math.max(0, n - 1)));

      if (animateOnLike && nextIsLiked) {
        setAnimating(true);
        window.setTimeout(() => setAnimating(false), 650);
      }

      return snapshot;
    },
    onSuccess: (result, _vars, ctx) => {
      if (!ctx) return;

      const wasLiked = ctx.prevLiked;
      const wasTotal = ctx.prevTotal;

      if (result?.action === 'added') {
        const nextTotal = wasLiked ? wasTotal : wasTotal + 1;
        setIsLiked(true);
        setTotalLikes(nextTotal);
        onSuccess?.(true, nextTotal);
        return;
      }

      if (result?.action === 'removed') {
        const nextTotal = wasLiked ? Math.max(0, wasTotal - 1) : wasTotal;
        setIsLiked(false);
        setTotalLikes(nextTotal);
        onSuccess?.(false, nextTotal);
        return;
      }

      setIsLiked(wasLiked);
      setTotalLikes(wasTotal);
      onSuccess?.(wasLiked, wasTotal);
    },
    onError: (error: any, _vars, ctx) => {
      if (ctx) {
        setIsLiked(ctx.prevLiked);
        setTotalLikes(ctx.prevTotal);
      }

      showErrorMessage(error, 'Error occurred, please try again');
      onError?.(error);
    }
  });

  const handleLike = () => {
    if (disabled || likeMutation.isPending) return;

    // Blocked, then offered the login dialog over whatever the visitor is
    // watching. The like is not queued for after sign-in: replaying a write the
    // visitor pressed while signed out is how one tap becomes two.
    if (requireLogin !== null) {
      if (requireLogin?.()) {
        openAuthModal();
        return;
      }
    } else if (!loggedIn) {
      openAuthModal();
      return;
    }

    likeMutation.mutate();
  };

  const getTooltipTitle = () => {
    if (tooltipTitle) return tooltipTitle;
    if (iconType === 'wishlist') return isLiked ? 'Bookmarked' : 'Bookmark';
    return isLiked ? 'Liked' : 'Like';
  };

  const defaultIcon = () => {
    if (iconType === 'wishlist') {
      return <FiBookmark size={iconSize} fill={isLiked ? 'currentColor' : 'none'} />;
    }

    return isLiked ? <AiFillHeart size={iconSize} /> : <AiOutlineHeart size={iconSize} />;
  };

  const iconNode = renderIcon
    ? renderIcon({
      isLiked,
      totalLikes,
      isPending: likeMutation.isPending,
      animating
    })
    : defaultIcon();

  const countNode = showCount
    ? renderCount
      ? renderCount(totalLikes)
      : <span>{totalLikes > 0 ? thousandToK(totalLikes) : '0'}</span>
    : null;

  const colorClass =
    renderIcon || unstyled
      ? ''
      : iconType === 'wishlist'
        ? isLiked
          ? 'text-blue-500'
          : ''
        : isLiked
          ? 'text-red-500'
          : '';

  const combinedClassName = `${colorClass} ${className} ${disabled ? 'pointer-events-none' : ''
    }`.trim();

  const buttonNode = unstyled ? (
    <button
      type="button"
      className={combinedClassName}
      onClick={handleLike}
      disabled={disabled || likeMutation.isPending}
    >
      {iconNode}
      {countNode}
    </button>
  ) : (
    <Button
      className={combinedClassName}
      onClick={handleLike}
      disabled={disabled || likeMutation.isPending}
      variant={variant}
      size={size}
    >
      {iconNode}
      {countNode}
    </Button>
  );

  if (!tooltip) return buttonNode;

  return <Tooltip title={getTooltipTitle()}>{buttonNode}</Tooltip>;
}
