export interface PostStatisticsMetric {
  label: string;
  /** Already formatted for display, so real and placeholder metrics render identically. */
  value: string;
  /**
   * True when the value is frontend filler rather than something the API measured. Kept on the
   * metric rather than inferred from its label so the distinction survives reordering, and so a
   * future backend field only has to flip this flag.
   */
  isPlaceholder?: boolean;
}

interface PostStatisticsProps {
  metrics: PostStatisticsMetric[];
}

/**
 * The metric strip under a managed post.
 *
 * Array-driven so a metric moving from placeholder to real is a one-line change at the call site.
 * Placeholder cells are dimmed and carry a title — the layout matches the reference while still
 * being honest about which numbers mean anything.
 */
export default function PostStatistics({ metrics }: PostStatisticsProps) {
  return (
    <div className="absolute bottom-0 flex h-10.25 items-center">
      {metrics.map((metric) => (
        <div
          className="relative min-w-26 mr-5 pr-5 after:absolute after:right-0 after:top-1/2 after:h-7.5 after:w-px after:-translate-y-1/2 after:bg-(--active-bg) last:mr-0 last:pr-0 last:after:hidden"
          key={metric.label}
        >
          <div className="group relative cursor-pointer whitespace-nowrap">
            <span className="pointer-events-none absolute -inset-x-3 -inset-y-0.75 rounded-sm opacity-0 transition-opacity group-hover:opacity-100" />
            <div className="relative z-1 text-[13px] leading-4.5 text-(--text-muted)">
              {metric.label}
            </div>
            <div className="relative z-1 mt-px text-[15px] font-bold leading-5.25 text-(--text-strong)">
              {metric.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
