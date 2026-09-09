interface PostPinnedBadgeProps {
  className?: string;
}

/**
 * Shared Douyin-style marker for posts promoted to the top of a creator list.
 *
 * The compact size is 10px, the floor of the app's compact type ramp. It was
 * 9px, which made it the only text on the profile grid below that floor — a
 * badge is small on purpose, but it is still something a person has to read.
 * The post-detail creator grid overrides this to 6px with `!` because its tiles
 * are a third of the width; that override still wins, so this is a change to
 * the profile grid only.
 */
export default function PostPinnedBadge({ className = '' }: PostPinnedBadgeProps) {
  return (
    <span
      className={`inline-flex h-5 max-lg:h-4 max-w-[calc(100%-8px)] items-center truncate rounded bg-[#face15] px-1.5 max-lg:px-1 text-[11px] max-lg:text-[10px] font-semibold leading-5 max-lg:leading-4 text-[#161823] shadow-sm ${className}`}
    >
      Pinned on top
    </span>
  );
}
