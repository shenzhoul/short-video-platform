/**
 * EmojiPicker Component
 *
 * A modal emoji picker component that displays a grid of common emojis.
 * Features a backdrop overlay and configurable close-on-select behavior.
 *
 * @example
 * // Basic usage
 * <EmojiPicker
 *   onSelect={(emoji) => console.log('Selected:', emoji)}
 *   onClose={() => setShowPicker(false)}
 *   closeOnSelect={false}
 * />
 *
 * Features:
 * - Grid layout with 100 common emojis
 * - Modal overlay with backdrop
 * - Hover effects on emoji buttons
 * - Optional close on selection
 * - Scrollable content area
 * - Responsive design
 */

'use client';

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
  onClose: () => void;
  closeOnSelect?: boolean;
}

const COMMON_EMOJIS = [
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇',
  '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚',
  '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩',
  '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣',
  '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬',
  '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗',
  '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯',
  '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
  '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈',
  '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙',
  '👈', '👉', '👆', '🖕', '👇', '☝️', '👋', '🤚', '🖐️', '✋',
  '🖖', '👏', '🙌', '🤝', '🙏', '✊', '👊', '🤛', '🤜', '💪',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
  '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
  '✨', '🎉', '🎊', '🎈', '🎁', '🏆', '🥇', '🥈', '🥉', '⭐'
];

// Modal version with backdrop (for standalone use)
export default function EmojiPicker({
  onSelect,
  onClose,
  closeOnSelect = false
}: EmojiPickerProps) {
  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
    if (closeOnSelect) {
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Emoji picker */}
      <div className="absolute bottom-full right-0 z-50 mb-2 bg-surface border border-border rounded-lg shadow-lg p-3 w-80 max-h-60 overflow-y-auto">
        <div className="text-xs opacity-70 mb-2 font-medium">Choose an emoji</div>
        <div className="grid grid-cols-10 gap-1">
          {COMMON_EMOJIS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="w-7 h-7 flex items-center justify-center hover:bg-surface-muted rounded text-lg transition-colors"
              onClick={() => handleEmojiClick(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

// Compatibility component for Popover usage (replaces Emotions)
interface EmotionsProps {
  onEmojiClick: (emoji: string) => void;
  closeOnSelect?: boolean;
  onClose?: () => void;
}

export function Emotions({
  onEmojiClick,
  closeOnSelect = false,
  onClose
}: EmotionsProps) {
  const handleEmojiClick = (emoji: string) => {
    onEmojiClick(emoji);
    if (closeOnSelect) {
      onClose?.();
    }
  };

  return (
    <div className="p-2 w-80 max-h-60 overflow-y-auto">
      <div className="text-xs opacity-70 mb-2 font-medium">Choose an emoji</div>
      <div className="grid grid-cols-10 gap-1">
        {COMMON_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="w-7 h-7 flex items-center justify-center hover:bg-surface-muted rounded text-lg transition-colors"
            onClick={() => handleEmojiClick(emoji)}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
