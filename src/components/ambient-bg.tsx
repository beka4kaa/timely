"use client"

export function AmbientBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-tm-bg"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgb(var(--tm-dot) / 0.06) 1px, transparent 1.15px)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="absolute -left-40 -top-48 h-[38rem] w-[38rem] rounded-full bg-tm-accent-soft/35 blur-[140px]" />
      <div className="absolute -right-44 top-1/4 h-[34rem] w-[34rem] rounded-full bg-tm-surface-3/45 blur-[150px]" />
      <div className="absolute inset-x-0 top-0 h-56 bg-gradient-to-b from-tm-surface/85 to-transparent" />
    </div>
  )
}
