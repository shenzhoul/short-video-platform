'use client';

import Button from '@components/ui/button';
import { thousandToK } from '@lib/index';
import { AiOutlineComment } from 'react-icons/ai';
import { toast } from 'react-toastify';

interface CommentButtonProps {
  /** Total number of comments */
  totalComments?: number;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Button size */
  size?: 'sm' | 'md' | 'lg';
  /** Button variant style */
  variant?: 'primary' | 'grey' | 'grey-light' | 'border';
  /** Whether to show the comment count */
  showCount?: boolean;
  /** Size of the comment icon */
  iconSize?: number;
  /** Function to check if login is required. Return true to block the action. Pass null/undefined to use default profile check. */
  requireLogin?: (() => boolean) | null;
  /** Callback fired when comment button is clicked */
  onClick?: () => void;
  /** Custom text to display instead of count */
  customText?: string;
}

/**
 * CommentButton - A button component for triggering comment interactions
 *
 * This component provides a standardized button for comment functionality:
 * - Shows comment count with formatting
 * - Handles login requirements
 * - Consistent styling with other social buttons
 * - Customizable appearance and behavior
 *
 * @example
 * // Basic usage
 * <CommentButton
 *   totalComments={42}
 *   onClick={() => commentRef.current?.toggle()}
 * />
 *
 * @example
 * // With login check
 * <CommentButton
 *   totalComments={10}
 *   requireLogin={() => !user?._id}
 *   onClick={() => {
 *     commentRef.current?.setVisible(true);
 *   }}
 * />
 *
 * @example
 * // Custom styling
 * <CommentButton
 *   totalComments={5}
 *   variant="primary"
 *   size="lg"
 *   customText="View comments"
 *   onClick={handleShowComments}
 * />
 */
export default function CommentButton({
  totalComments = 0,
  disabled = false,
  className = '',
  size = 'md',
  variant = 'grey-light',
  showCount = true,
  iconSize = 16,
  requireLogin = null, // Default to using profile check
  onClick,
  customText
}: CommentButtonProps) {
  const handleClick = () => {
    // Check if login is required
    if (requireLogin !== null) {
      // Use custom requireLogin function if provided
      if (requireLogin && requireLogin()) {
        toast.error('Please login to view comments');
        return;
      }
    }

    onClick?.();
  };

  const displayText = customText || (showCount ? (totalComments > 0 ? thousandToK(totalComments) : '0') : '');

  return (
    <Button
      className={className}
      onClick={handleClick}
      disabled={disabled}
      variant={variant}
      size={size}
    >
      <AiOutlineComment size={iconSize} />
      {displayText ? (
        <span>
          {displayText}
        </span>
      ) : null}
    </Button>
  );
}
