interface PostPinnedBadgeProps {
  className?: string;
}

/** Shared Douyin-style marker for posts promoted to the top of a creator list. */
export default function PostPinnedBadge({ className = '' }: PostPinnedBadgeProps) {
  return (
    <span
      className={`inline-flex h-5 max-lg:h-4 max-w-[calc(100%-8px)] items-center truncate rounded bg-[#face15] px-1.5 max-lg:px-1 text-[11px] max-lg:text-[9px] font-semibold leading-5 max-lg:leading-4 text-[#161823] shadow-sm ${className}`}
    >
      Pinned on top
    </span>
  );
}
