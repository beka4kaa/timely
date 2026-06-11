"use client"

/**
 * Soft peach→lavender ambient gradient blobs that sit behind page content.
 * Fixed, non-interactive, theme-aware. Gives the "expensive" depth used by
 * the glassmorphism surfaces layered on top.
 */
export function AmbientBackground() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div className="absolute inset-0 bg-slate-50 dark:bg-[#0a0a0f]" />
      {/* peach */}
      <div className="absolute -top-32 -left-24 h-[42rem] w-[42rem] rounded-full bg-orange-300/35 dark:bg-orange-500/10 blur-[120px]" />
      {/* lavender */}
      <div className="absolute top-1/3 -right-24 h-[40rem] w-[40rem] rounded-full bg-violet-400/30 dark:bg-violet-500/12 blur-[120px]" />
      {/* sky accent */}
      <div className="absolute -bottom-40 left-1/4 h-[36rem] w-[36rem] rounded-full bg-sky-300/25 dark:bg-sky-500/10 blur-[120px]" />
    </div>
  )
}
