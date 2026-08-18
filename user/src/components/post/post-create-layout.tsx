import { Tooltip } from '@components/ui/tooltip';
import type { ReactNode } from 'react';
import { QuestionOutlinedIcon } from 'src/icons';

export const postCreateControlClassName = 'flex h-8 items-center justify-between rounded-sm bg-(--action-card-bg) px-3 text-sm text-(--text-strong) transition hover:bg-(--surface-hover)';
export const postCreatePlaceholderClassName = 'text-(--text-muted)';
export const postCreateDropdownMenuClassName = '!mt-1 !rounded-sm !border-none !bg-(--surface-raised) !p-1 !shadow-[0_6px_18px_rgba(22,24,35,.12)]';

interface PostCreateSectionProps {
  title?: string;
  className?: string;
  children: ReactNode;
}

export function PostCreateSection({
  title,
  className = '',
  children
}: PostCreateSectionProps) {
  return (
    <section className={`rounded-lg bg-(--surface-raised) px-8 py-6 ${className}`}>
      {title ? <h2 className="text-base font-semibold leading-[22px]">{title}</h2> : null}
      {children}
    </section>
  );
}

interface PostCreateFieldProps {
  label: ReactNode;
  tooltip?: string;
  tooltipWidth?: string;
  className?: string;
  children: ReactNode;
  tooltipPosition?: any;
}

export function PostCreateField({
  label,
  tooltip,
  tooltipWidth = 'w-[220px]',
  className = '',
  children,
  tooltipPosition = ''
}: PostCreateFieldProps) {
  return (
    <div className={`flex items-start justify-end gap-5 ${className}`}>
      <div className="mb-2.5 mt-2 flex text-sm">
        <span className="inline-flex flex-1 items-center gap-1 font-semibold leading-5">
          {label}
          {tooltip ? (
            <Tooltip
              title={tooltip}
              className="bg-[#3b3b48] px-3 py-3 text-sm leading-[18px] text-white"
              width={tooltipWidth}
              wrap
              placement={tooltipPosition}
            >
              <span className="inline-flex items-center">
                <QuestionOutlinedIcon className="text-sm" />
              </span>
            </Tooltip>
          ) : null}
        </span>
      </div>
      <div className="w-[548px] shrink-0">{children}</div>
    </div>
  );
}
