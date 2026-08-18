'use client';

import { useEffect, useState } from 'react';
import { FiChevronUp } from 'react-icons/fi';
import { ChecklistIcon, QuestionOutlinedIcon } from 'src/icons';

interface PostCreateSendAssistantProps {
  hasSelectedCover?: boolean;
}

export default function PostCreateSendAssistant({
  hasSelectedCover = false
}: PostCreateSendAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (hasSelectedCover) setIsOpen(true);
  }, [hasSelectedCover]);

  return (
    <section className="relative mt-6 flex w-[243px] flex-col items-center justify-center">
      {!isOpen ? (
        <button
          type="button"
          className="mx-auto flex h-10 w-[134px] items-center justify-center rounded-xl bg-(--action-card-bg) text-(--text-strong) transition hover:bg-(--surface-hover)"
          onClick={() => setIsOpen(true)}
        >
          <ChecklistIcon className="text-xl" />
          <span className="ml-1 text-sm font-semibold leading-5">Send assistant</span>
        </button>
      ) : (
        <div className="relative w-[243px] rounded-xl border border-(--border-soft) bg-(--surface-raised) px-4 pb-4 pt-6 text-(--text-strong) shadow-(--shadow-popover)">
          <p className="mb-5 flex items-center justify-center">
            <ChecklistIcon className="text-xl" />
            <span className="ml-1 text-base font-medium leading-[26px]">Send assistant</span>
          </p>
          <div className="max-h-[460px] w-full overflow-y-auto overflow-x-hidden pr-2">
            <div className="flex flex-col items-center justify-between">
              <p className="flex self-start text-sm leading-5 text-(--text-soft)">
                Rapid detection
                <QuestionOutlinedIcon className="ml-1 text-sm" />
              </p>
              <button
                type="button"
                className="mt-4 flex h-8 w-[211px] items-center justify-center rounded-sm bg-(--action-card-bg) px-3 py-1 font-medium text-(--text-strong) hover:bg-(--surface-hover)"
              >
                Retest
              </button>
            </div>
            {hasSelectedCover ? (
              <div className="mt-4 rounded-lg bg-(--action-card-bg) px-3 py-4">
                <p className="text-sm leading-5 text-(--text-strong)">Cover inspection passed</p>
                <p className="mt-1.5 text-sm leading-5 text-(--text-soft)">
                  No low quality problem of the cover has been found yet.
                </p>
              </div>
            ) : (
              <>
                <p className="mt-1 text-[13px] leading-5 text-(--text-muted)">
                  Only supports detecting videos within 5 minutes
                </p>
                <div className="mt-4">
                  <p className="text-sm leading-5 text-[rgb(246,152,41)]">Horizontal/Vertical Double Cover Missing</p>
                  <p className="mt-1.5 text-sm leading-5 text-(--text-soft)">
                    To increase traffic, set up both horizontal and vertical covers.
                  </p>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            aria-label="Close send assistant"
            className="absolute right-3 top-3 flex h-6 w-8 items-center justify-center rounded-[22px] border border-(--border-soft) text-(--text-muted) hover:bg-(--surface-hover) hover:text-(--text-strong)"
            onClick={() => setIsOpen(false)}
          >
            <FiChevronUp className="text-base" />
          </button>
        </div>
      )}
    </section>
  );
}
