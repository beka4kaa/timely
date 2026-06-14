"use client"

import React from 'react'
import dynamic from 'next/dynamic'

// react-force-graph-2d touches `window`/canvas → client-side only.
const GoalGraphInner = dynamic(() => import('./GoalGraphInner'), {
  ssr: false,
  loading: () => (
    <div className="h-full flex items-center justify-center text-sm text-white/40">Загрузка графа…</div>
  ),
})

export function GoalsGraphView() {
  return (
    <div className="relative rounded-[28px] overflow-hidden border border-white/[0.08] bg-[#0a0a0e] h-full">
      {/* subtle dot grid */}
      <svg className="absolute inset-0 w-full h-full pointer-events-none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="graphdots" x="0" y="0" width="30" height="30" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill="rgba(255,255,255,0.05)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#graphdots)" />
      </svg>
      <GoalGraphInner />
    </div>
  )
}
