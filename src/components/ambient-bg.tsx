"use client"

/**
 * Soft peach→lavender ambient gradient blobs that sit behind page content.
 * Rendered `absolute` inside the page's `relative` wrapper (NOT fixed) so it
 * only tints the content area and never covers the top header bar.
 * Non-interactive, theme-aware.
 */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-slate-50 dark:bg-[#0a0a0f]" />
      {/* peach */}
      <div className="absolute -top-32 -left-24 h-[42rem] w-[42rem] rounded-full bg-orange-300/22 dark:bg-orange-500/[0.07] blur-[130px]" />
      {/* lavender */}
      <div className="absolute top-1/3 -right-24 h-[40rem] w-[40rem] rounded-full bg-violet-400/18 dark:bg-violet-500/[0.08] blur-[130px]" />
      {/* sky accent */}
      <div className="absolute -bottom-40 left-1/4 h-[36rem] w-[36rem] rounded-full bg-sky-300/16 dark:bg-sky-500/[0.06] blur-[130px]" />
    </div>
  )
}
