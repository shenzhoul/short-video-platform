interface PostPinnedBadgeProps {
  className?: string;
}

/** Shared Douyin-style marker for posts promoted to the top of a creator list. */
export default function PostPinnedBadge({ className = '' }: PostPinnedBadgeProps) {
  return (
    <span
      className={`inline-flex h-5 items-center rounded bg-[#face15] px-1.5 text-[11px] font-semibold leading-5 text-[#161823] shadow-sm ${className}`}
    >
      Pinned on top
    </span>
  );
}
