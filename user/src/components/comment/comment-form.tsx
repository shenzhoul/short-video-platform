/**
 * CommentForm Component
 *
 * A form component for creating comments and replies with emoji picker support.
 * Features real-time character counting, emoji insertion, and form validation.
 *
 * @example
 * // Basic comment form
 * <CommentForm
 *   objectId="post-123"
 *   objectType="post"
 *   creator={currentUser}
 *   onSubmit={(comment) => handleCreateComment(comment)}
 * />
 *
 * // Reply form
 * <CommentForm
 *   objectId="post-123"
 *   creator={currentUser}
 *   isReply
 *   onSubmit={(reply) => handleCreateReply(reply)}
 * />
 *
 * Features:
 * - Rich text input with emoji picker
 * - Character count display
 * - Form validation and submission
 * - Support for both comments and replies
 * - Loading states during submission
 * - Auto-resize textarea
 * - Keyboard shortcuts (Enter to submit)
 */

'use client';

import { Emotions } from '@components/shared';
import { useTextareaMentions } from '@hooks/use-textarea-mentions';
import { IComment, ICreateComment } from '@interfaces/comment';
import { resolveMentionedUserIds } from '@lib/post-mentions';
import { isMobileDevice } from '@utils/device';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FiAtSign, FiSend, FiSmile } from 'react-icons/fi';
import { IUser } from 'src/interfaces';

import MentionPicker from './mention-picker';

export interface CommentFormRef {
  focus: () => void;
}

type CommentObjectType = 'post' | 'comment';

type CommentSubmitData = ICreateComment & {
  objectId: string;
  objectType: CommentObjectType;
};

type IProps = {
  objectId: string;
  objectType?: CommentObjectType;
  onSubmit?: (comment: CommentSubmitData) => void;
  creator: IUser;
  requesting?: boolean;
  isReply?: boolean;
  replyTarget?: IComment | null;
  onCancelReply?: () => void;
}

export const CommentForm = forwardRef<CommentFormRef, IProps>(function CommentForm({
  objectId,
  creator,
  objectType = 'post',
  onSubmit,
  requesting = false,
  isReply = false,
  replyTarget,
  onCancelReply
}, ref) {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const closeEmojiPickerOnSelect = isMobileDevice();
  /**
   * Pending "close the picker after blur" timer.
   *
   * Blurring the textarea schedules the picker to close, which is right when the
   * reader clicks away but wrong when they click the @ button: that blur fired
   * first, so the picker opened and was then closed by the timer a moment later.
   * Cancelling the pending close removes the race instead of delaying past it.
   */
  const blurCloseRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingClose = () => {
    if (blurCloseRef.current) {
      clearTimeout(blurCloseRef.current);
      blurCloseRef.current = null;
    }
  };

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset
  } = useForm<ICreateComment>({
    defaultValues: {
      content: ''
    }
  });

  const content = watch('content') || '';
  const isLoggedIn = !!creator?._id;

  const setContent = (next: string) => setValue('content', next);

  /**
   * Mention picker shared with the post composer.
   *
   * Only the mention behaviour is borrowed — the textarea, react-hook-form
   * state, emoji insertion, auto-resize and reply banner below all stay as they
   * were, so typing `@` and pressing the `@` button drive one picker without
   * replacing the composer.
   */
  const mentions = useTextareaMentions({
    textareaRef,
    value: content,
    onChange: setContent,
    enabled: isLoggedIn
  });

  const onFinish = async (values: ICreateComment) => {
    if (!isLoggedIn || !onSubmit) return;
    const data = values;
    const trimmedContent = data.content?.trim() || '';

    // Validate minimum length (1 character after trimming)
    if (!trimmedContent || trimmedContent.length < 1) {
      return;
    }

    // Update content with trimmed value
    data.content = trimmedContent;

    // The final text is the source of truth for who was named, so editing a
    // handle away before posting removes the mention with it. Unresolvable
    // handles are dropped, matching what the server does with ids it cannot find.
    const mentionedUserIds = await resolveMentionedUserIds(trimmedContent, mentions.pickedUsers);

    const submitData = {
      ...data,
      objectId,
      objectType,
      ...(mentionedUserIds.length ? { mentionedUserIds } : {})
    };
    reset();
    if (textareaRef.current) {
      textareaRef.current.style.height = '35px';
    }
    onSubmit?.(submitData);
  };

  const onEmojiClick = (emoji: string) => {
    if (!isLoggedIn) return;
    const newContent = `${content} ${emoji} `;
    setValue('content', newContent);
    if (closeEmojiPickerOnSelect) {
      setShowEmojiPicker(false);
    }

    // Focus back to textarea
    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue('content', e.target.value);
    // Same keystroke drives the picker, so typing `@` opens it immediately.
    mentions.detectTrigger(e.target.value, e.target.selectionStart);

    // Auto-resize textarea
    if (textareaRef.current) {
      const textarea = textareaRef.current;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, isReply ? 80 : 120)}px`;

    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // The picker claims Enter/arrows while open, so choosing a candidate cannot
    // submit the comment by accident.
    mentions.handleKeyDown(e);
  };

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus()
  }));

  return (
    <form onSubmit={handleSubmit(onFinish)} className="relative w-full">
      {mentions.isOpen && mentions.triggerType === 'user' ? (
        <MentionPicker
          options={mentions.options}
          highlighted={mentions.highlighted}
          loading={mentions.loading}
          isSearching={mentions.isSearching}
          onHighlight={mentions.setHighlighted}
          onSelect={mentions.applyOption}
        />
      ) : null}
      <div
        className="
      overflow-hidden rounded-xl
      bg-[rgba(255,255,255,.16)]
      outline outline-transparent
      transition
      hover:outline-[rgba(255,255,255,.5)]
      focus-within:outline-[rgba(255,255,255,.5)]
    "
      >
        {replyTarget ? (
          <div className="flex h-7 items-center gap-2 px-3 text-xs text-white/45">
            <span className="min-w-0 flex-1 truncate">
              Reply to @{replyTarget.user?.name || replyTarget.user?.username}: {replyTarget.content}
            </span>

            <button
              type="button"
              onClick={onCancelReply}
              className="shrink-0 text-white/45 hover:text-white/80"
            >
              ×
            </button>
          </div>
        ) : null}

        {/* Comment Input Area */}
        <div
          className={`
          flex min-h-11 items-center px-3
          ${replyTarget ? 'bg-[rgba(255,255,255,.08)]' : ''}
        `}
        >
          <textarea
            {...register('content')}
            ref={(el) => {
              register('content').ref(el);
              textareaRef.current = el;
            }}
            disabled={!isLoggedIn}
            maxLength={250}
            rows={1}
            placeholder='Add comment...'
            onChange={handleTextChange}
            onKeyDown={handleKeyDown}
            onClick={(e) => mentions.detectTrigger(content, e.currentTarget.selectionStart)}
            onBlur={() => {
              // Delayed so a click on a candidate lands before the picker
              // unmounts. Tracked so an action that deliberately opens the
              // picker can cancel it — see `cancelPendingClose`.
              blurCloseRef.current = setTimeout(() => mentions.closePicker(), 150);
            }}
            className="
          h-[35px] min-h-[35px] flex-1 resize-none overflow-hidden
          border-0 bg-transparent p-0 py-2 text-sm leading-5
          text-white outline-none placeholder:text-white/45
        "
          />

          {/* Mention Button — opens the same picker as typing @ */}
          <button
            type="button"
            // Keeps focus and the caret in the textarea, so the click neither
            // blurs it nor loses the insertion point for a mid-text mention.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              // A keyboard user reaches this button by tabbing, which already
              // blurred the textarea and scheduled a close. Cancelling it here
              // covers that path too, rather than relying on focus alone.
              cancelPendingClose();
              mentions.openMentionPicker();
            }}
            aria-label="Mention someone"
            className="ml-2 cursor-pointer text-white/45 hover:text-white/80"
            disabled={!isLoggedIn}
          >
            <FiAtSign size={21} />
          </button>

          {/* Emoji Picker Button */}
          <button
            type="button"
            onClick={() => setShowEmojiPicker(!showEmojiPicker)}
            className="ml-2 cursor-pointer text-white/45 hover:text-white/80"
            disabled={!isLoggedIn}
          >
            <FiSmile size={22} />
          </button>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={requesting || !isLoggedIn}
            className="ml-3 cursor-pointer text-white/45 transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FiSend size={21} />
          </button>
        </div>

        {/* Click outside to close emoji picker */}
        {showEmojiPicker ? (
          <>
            <div className="absolute bottom-16 right-4 z-50 rounded-lg border border-white/10 bg-[#252631] shadow-xl">
              <Emotions
                onEmojiClick={onEmojiClick}
                onClose={() => setShowEmojiPicker(false)}
                closeOnSelect={closeEmojiPickerOnSelect}
              />
            </div>
            <div className="fixed inset-0 z-40" onClick={() => setShowEmojiPicker(false)} />
          </>
        ) : null}
      </div>
    </form>
  );
});

export default CommentForm;
