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

import { CommentImagePreview, ReplaceImageDialog } from '@components/comment/comment-image-attachment';
import { Emotions } from '@components/shared';
import { toast } from '@douyin-clone/shared-toast';
import {
  COMMENT_IMAGE_ACCEPT_ATTRIBUTE, describeInvalidImageContent, useCommentImage
} from '@hooks/use-comment-image';
import { useTextareaMentions } from '@hooks/use-textarea-mentions';
import { IComment, ICreateComment } from '@interfaces/comment';
import { resolveMentionedUserIds } from '@lib/post-mentions';
import { isMobileDevice } from '@utils/device';
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { FiAtSign, FiImage, FiSend, FiSmile } from 'react-icons/fi';
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
  /**
   * Hands the comment to whoever owns the list.
   *
   * Resolving to `null` means it was not created, and the composer keeps the
   * text and the image so the author can try again. `undefined` is treated as
   * success, so a caller that reports nothing behaves as it always did.
   */
  onSubmit?: (comment: CommentSubmitData) => void | Promise<IComment | null | void>;
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

  const commentImage = useCommentImage();
  const imageInputRef = useRef<HTMLInputElement>(null);
  // The candidate waiting on the replacement decision. Held here rather than
  // attached, so declining leaves the composer exactly as it was.
  const [pendingReplacement, setPendingReplacement] = useState<File | null>(null);
  const [replacing, setReplacing] = useState(false);

  /**
   * Choosing a file.
   *
   * With nothing attached this simply attaches. With an image already there it
   * asks first — replacing is destructive to a choice the author already made.
   */
  const handleImagePicked = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so picking the *same* file again still fires a change.
    event.target.value = '';
    if (!file) return;

    // Judged on its actual first bytes, not on its name or the MIME the browser
    // guessed from the extension — both of which change when somebody renames a
    // video to `.png`.
    //
    // Reported before anything else happens: before a preview, before an
    // upload, and before a dialog asks whether to replace the current image
    // with a file that was never going to be accepted. Nothing is uploaded, so
    // no record exists to clean up and the image already attached is untouched.
    const invalid = await describeInvalidImageContent(file);
    if (invalid) {
      toast.error(invalid);
      return;
    }

    if (!commentImage.image) {
      const attached = await commentImage.attach(file);
      if (attached.error) toast.error(attached.error);
      return;
    }

    setPendingReplacement(file);
  };

  const cancelReplacement = () => {
    setPendingReplacement(null);
    // Nothing was uploaded for the candidate, so there is nothing to discard —
    // the old image and the text are untouched.
    imageInputRef.current?.focus();
  };

  const confirmReplacement = async () => {
    if (!pendingReplacement || replacing) return;
    setReplacing(true);
    try {
      const previous = commentImage.image;
      const next = await commentImage.attach(pendingReplacement);
      if (next.error || !next.fileId) {
        // The replacement failed, so the original stays. Nothing was discarded.
        toast.error(next.error || 'That image could not be uploaded.');
        if (previous) commentImage.replaceWith(previous);
        return;
      }
      // Only now is the old one let go — and `replaceWith` discards it from the
      // server as well as revoking its preview.
      if (previous && previous.fileId !== next.fileId) {
        void commentImage.discard(previous.fileId);
        commentImage.revoke(previous.previewUrl);
      }
    } finally {
      setReplacing(false);
      setPendingReplacement(null);
    }
  };

  const onFinish = async (values: ICreateComment) => {
    if (!isLoggedIn || !onSubmit) return;
    const data = values;
    const trimmedContent = data.content?.trim() || '';
    const attached = commentImage.image;

    // A comment needs something in it. Text or an image will do; neither will
    // not, and an upload still running is not yet an image.
    if (!trimmedContent && !attached?.fileId) return;
    if (attached?.uploading || attached?.error) return;

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
      ...(attached?.fileId ? { imageId: attached.fileId } : {}),
      ...(mentionedUserIds.length ? { mentionedUserIds } : {})
    };

    // The composer is cleared only once the comment exists.
    //
    // It used to clear first and post afterwards, which reads as optimistic but
    // is not: a failed request left the author with an empty box, no text and
    // no picture, and nothing to retry with. Their image had already been
    // uploaded, so the only trace of the attempt was a file they could not see.
    const created = await onSubmit?.(submitData);
    if (created === null) return;

    reset();
    // Released rather than removed: the file now belongs to the comment, and
    // discarding it here is exactly the late cleanup the server refuses.
    commentImage.release();
    if (textareaRef.current) {
      textareaRef.current.style.height = '35px';
    }
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

  /**
   * The action group, rendered in whichever row currently owns it.
   *
   * One definition, two positions: inline with the text when nothing is
   * attached, and in the row beneath it when something is. Defining it twice
   * would be two things to keep identical.
   */
  const renderToolbar = () => (
    // Kept in a single element so the row they live in can move — inline with
    // the text when there is no attachment, into the row beneath it when there
    // is — without the buttons themselves changing. Spacing is a `gap` on the
    // group rather than a margin on each button, so reordering or adding one
    // cannot leave a hole.
    <div
      className={`flex shrink-0 items-center gap-2 ${commentImage.image ? 'pb-2' : 'ml-2'}`}
      data-testid="comment-toolbar"
    >
      <input
        ref={imageInputRef}
        type="file"
              // The same whitelist the server enforces, so the picker offers
              // what will actually be accepted. Still only a hint — the bytes
              // are what decide, and they are checked on both sides.
        accept={COMMENT_IMAGE_ACCEPT_ATTRIBUTE}
        className="sr-only"
        onChange={handleImagePicked}
        disabled={!isLoggedIn}
        aria-label="Attach an image"
        data-testid="comment-image-input"
      />
      <button
        type="button"
        onClick={() => imageInputRef.current?.click()}
        aria-label="Attach an image"
        data-testid="comment-image-button"
        className="cursor-pointer text-white/45 transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!isLoggedIn}
      >
        <FiImage size={21} />
      </button>

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
        className="cursor-pointer text-white/45 hover:text-white/80"
        disabled={!isLoggedIn}
      >
        <FiAtSign size={21} />
      </button>

      {/* Emoji Picker Button */}
      <button
        type="button"
        onClick={() => setShowEmojiPicker(!showEmojiPicker)}
        aria-label="Add an emoji"
        className="cursor-pointer text-white/45 hover:text-white/80"
        disabled={!isLoggedIn}
      >
        <FiSmile size={22} />
      </button>

      {/* Submit Button */}
      <button
        type="submit"
        aria-label="Post comment"
              // Enabled by text or a settled image — and never while one is still
              // uploading, which would post a comment referencing nothing.
        disabled={
                requesting
                || !isLoggedIn
                || Boolean(commentImage.image?.uploading)
                || (!content.trim() && !commentImage.image?.fileId)
              }
        className="cursor-pointer text-white/45 transition hover:text-white/80 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <FiSend size={21} />
      </button>
    </div>
  );

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

        {/*
          One row until there is something to show underneath.

          With no attachment this is the original single-line input: the text and
          the actions share a row, and the composer keeps the height it has
          always had. Only an attached image turns it into a column — text on
          top, then the thumbnail and the actions sharing the row below — which
          is the shape the reference design uses and costs one extra row rather
          than three stacked blocks.
        */}
        <div
          className={`
          flex min-h-11 px-3
          ${commentImage.image ? 'flex-col' : 'items-center'}
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

          {commentImage.image ? (
            <div className="flex items-end justify-between gap-2">
              <CommentImagePreview
                image={commentImage.image}
                onRemove={() => void commentImage.remove()}
              />
              {renderToolbar()}
            </div>
          ) : renderToolbar()}
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

      <ReplaceImageDialog
        open={Boolean(pendingReplacement)}
        busy={replacing}
        onCancel={cancelReplacement}
        onConfirm={() => void confirmReplacement()}
      />
    </form>
  );
});

export default CommentForm;
