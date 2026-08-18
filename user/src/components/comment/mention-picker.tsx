'use client';

import type { MentionOption } from '@hooks/use-textarea-mentions';

interface MentionPickerProps {
  options: MentionOption[];
  highlighted: number;
  loading: boolean;
  /** True once a query is typed, so the empty state can say the right thing. */
  isSearching: boolean;
  onHighlight: (index: number) => void;
  onSelect: (option: MentionOption) => void;
}

/**
 * Candidate list shown above the comment composer.
 *
 * Opens upward because the comment box sits at the bottom of the detail panel,
 * where a downward list would fall outside the viewport. Colours come from the
 * theme tokens rather than the reference screenshot's palette, so it follows
 * light and dark mode with everything else.
 */
export default function MentionPicker({
  options,
  highlighted,
  loading,
  isSearching,
  onHighlight,
  onSelect
}: MentionPickerProps) {
  const isEmpty = !loading && options.length === 0;

  return (
    <div
      role="listbox"
      aria-label="Mention a user"
      className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-(--border-faint) bg-(--surface-raised) py-1 shadow-(--shadow-popover)"
    >
      {!isSearching && options.length > 0 ? (
        <p className="px-3 pb-1 pt-1.5 text-[12px] leading-4 text-(--text-muted)">
          Suggested
        </p>
      ) : null}

      {loading && !options.length ? (
        <p className="px-3 py-2 text-[13px] leading-5 text-(--text-muted)">Searching…</p>
      ) : null}

      {isEmpty ? (
        <p className="px-3 py-2 text-[13px] leading-5 text-(--text-muted)">
          {isSearching ? 'No matching users' : 'No suggestions yet'}
        </p>
      ) : null}

      {options.map((option, index) => (
        <button
          key={option.id}
          type="button"
          role="option"
          aria-selected={index === highlighted}
          // Mouse down fires before the textarea blurs, so the pick is not lost.
          onMouseDown={(event) => {
            event.preventDefault();
            onSelect(option);
          }}
          onMouseEnter={() => onHighlight(index)}
          className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left transition ${
            index === highlighted ? 'bg-(--hover-bg)' : ''
          }`}
        >
          <img
            src={option.user?.avatar || '/no_avatar.jpeg'}
            alt=""
            className="h-7 w-7 shrink-0 rounded-full object-cover"
          />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] leading-5 text-(--text-strong)">
              {option.label}
            </span>
            {option.hint ? (
              <span className="block truncate text-[12px] leading-4 text-(--text-muted)">
                {option.hint}
              </span>
            ) : null}
          </span>
        </button>
      ))}
    </div>
  );
}
