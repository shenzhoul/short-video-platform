import { FiAlertTriangle } from 'react-icons/fi';

interface PostDraftBannerProps {
  message: string;
  detail?: string;
  isDiscarding: boolean;
  onContinue: () => void;
  onDiscard: () => void;
}

export default function PostDraftBanner({
  message,
  detail,
  isDiscarding,
  onContinue,
  onDiscard
}: PostDraftBannerProps) {
  return (
    <aside className="mt-2 flex min-h-12 items-center justify-between rounded-md border border-(--border-soft) bg-(--surface-raised) px-4">
      <div className="flex min-w-0 items-center gap-3">
        <FiAlertTriangle className="shrink-0 text-xl text-[#f59a23]" />
        <div className="min-w-0">
          <p className="m-0 truncate text-sm font-semibold text-(--text-strong)">{message}</p>
          {detail ? <p className="m-0 mt-0.5 truncate text-xs text-(--text-muted)">{detail}</p> : null}
        </div>
      </div>
      <div className="ml-5 flex shrink-0 items-center gap-6">
        <button
          type="button"
          className="text-sm font-semibold text-[#168ef9] transition hover:text-[#0878da] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#168ef9]"
          onClick={onContinue}
        >
          Edit
        </button>
        <button
          type="button"
          disabled={isDiscarding}
          className="text-sm font-semibold text-(--text-strong) transition hover:text-[#fe2c55] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#fe2c55] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onDiscard}
        >
          {isDiscarding ? 'Discarding...' : 'Discard'}
        </button>
      </div>
    </aside>
  );
}
