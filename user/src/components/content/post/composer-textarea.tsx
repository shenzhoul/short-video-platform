'use client';

import { formatCompactCount } from '@components/content/post/home-feed-media';
import { useTextareaMentions } from '@hooks/use-textarea-mentions';
import { IUser } from '@interfaces/user';
import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

interface ComposerTextareaProps {
  value: string;
  onChange: (value: string) => void;
  /** Called whenever the set of resolved @mentions changes. */
  onMentionsChange?: (users: IUser[]) => void;
  placeholder?: string;
  className?: string;
  id?: string;
}

/**
 * Post composer text field with `#hashtag` and `@mention` autocomplete.
 *
 * The trigger detection, candidate loading, cursor-accurate insertion and
 * keyboard handling all come from `useTextareaMentions`, which the comment
 * composer uses too — there is one textarea mention implementation, not two.
 */
export default function ComposerTextarea({
  value,
  onChange,
  onMentionsChange,
  placeholder,
  className = '',
  id = 'composer-text'
}: ComposerTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Users picked from the dropdown. Retained so their ids can accompany the text,
  // while the submitted text stays the final authority on who is mentioned.
  const [mentioned, setMentioned] = useState<IUser[]>([]);

  const mentions = useTextareaMentions({
    textareaRef,
    value,
    onChange,
    // The post composer offers hashtag and user search from the first keystroke
    // rather than a relationship-based starting list.
    withRecommendations: false,
    formatTagHint: (postCount) => `${formatCompactCount(postCount)} posts`
  });

  // Drop mentions whose @username is no longer present in the text.
  useEffect(() => {
    setMentioned((current) => {
      const next = current.filter((user) => value.includes(`@${user.username}`));
      return next.length === current.length ? current : next;
    });
  }, [value]);

  useEffect(() => {
    onMentionsChange?.(mentioned);
  }, [mentioned, onMentionsChange]);

  const handleSelect = (option: typeof mentions.options[number]) => {
    mentions.applyOption(option);
    if (option.user) {
      setMentioned((current) => (current.some((item) => item._id === option.user!._id)
        ? current
        : [...current, option.user!]));
    }
  };

  const showPanel = mentions.isOpen && (mentions.options.length > 0 || mentions.loading);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          mentions.detectTrigger(event.target.value, event.target.selectionStart);
        }}
        onClick={(event) => mentions.detectTrigger(value, event.currentTarget.selectionStart)}
        onKeyDown={(event) => mentions.handleKeyDown(event)}
        onBlur={() => {
          // Delayed so a click on an option lands before the panel unmounts.
          setTimeout(() => mentions.closePicker(), 150);
        }}
        className={clsx(
          'w-full resize-none rounded-[10px] border-0 bg-[#363743] px-2 py-2 text-sm leading-5 text-white/75 outline-none caret-white/80 placeholder:text-white/38 focus:bg-[#3b3c49]',
          'h-32',
          className
        )}
      />

      {showPanel ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-[#252631] py-1 shadow-xl">
          {mentions.loading && !mentions.options.length ? (
            <p className="px-3 py-2 text-[13px] text-white/45">Searching...</p>
          ) : null}
          {mentions.options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              // Mouse down fires before blur, so the pick is not lost to the blur handler.
              onMouseDown={(event) => {
                event.preventDefault();
                handleSelect(option);
              }}
              onMouseEnter={() => mentions.setHighlighted(index)}
              className={clsx(
                'flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm transition',
                index === mentions.highlighted ? 'bg-white/10 text-white' : 'text-white/80 hover:bg-white/5'
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {option.user ? (
                  <img
                    src={option.user.avatar || '/no_avatar.jpeg'}
                    alt=""
                    className="h-6 w-6 shrink-0 rounded-full object-cover"
                  />
                ) : null}
                <span className="truncate font-medium">{option.label}</span>
              </span>
              {option.hint ? <span className="shrink-0 text-xs text-white/45">{option.hint}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
