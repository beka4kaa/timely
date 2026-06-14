"use client"

import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import { Crosshair, RotateCcw, Tag, Info, X } from 'lucide-react'
import { useGoalsStore } from '@/stores/goals-store'
import { buildGraphData, getNeighborhood } from '../utils/buildGraphData'
import { graphNodeColor, LINK_STYLE, TYPE_LABEL } from '../utils/goalColors'
import type { GoalType } from '@/types/goals'

type FGNode = { id: string; title: string; type: GoalType; status: string; progress: number; val: number; x?: number; y?: number }

const SELECT_GLOW = '#f0abfc' // soft pink — the only accent in the graph
const LINK_ACCENT = '#f472b6'
const LEGEND: GoalType[] = ['global_goal', 'subgoal', 'milestone', 'task', 'financial_goal']

// Weak gravity toward the centre (0,0). Pulls *disconnected* clusters inward so
// the whole graph gathers into a rough circle, without changing the spacing
// between connected nodes (that's governed by charge + link forces).
function centerGravity(strength: number) {
  let nodes: any[] = []
  const force = (alpha: number) => {
    for (const n of nodes) {
      n.vx -= (n.x || 0) * strength * alpha
      n.vy -= (n.y || 0) * strength * alpha
    }
  }
  ;(force as any).initialize = (n: any[]) => { nodes = n }
  return force
}

export default function GoalGraphInner() {
  const goals = useGoalsStore(s => s.goals)
  const links = useGoalsStore(s => s.links)
  const selectedGoalId = useGoalsStore(s => s.selectedGoalId)
  const selectGoal = useGoalsStore(s => s.selectGoal)
  const createLink = useGoalsStore(s => s.createLink)

  const fgRef = useRef<any>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const posRef = useRef<Map<string, { x: number; y: number }>>(new Map())

  const [dims, setDims] = useState({ w: 800, h: 560 })
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [alwaysLabels, setAlwaysLabels] = useState(false)
  const [showLegend, setShowLegend] = useState(false)

  // Shift+click linking: first shift-clicked node is the pending source.
  const [linkSource, setLinkSource] = useState<string | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setDims({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const baseData = useMemo(() => {
    const data = buildGraphData(goals, links)
    for (const n of data.nodes as FGNode[]) {
      const saved = posRef.current.get(n.id)
      if (saved) { n.x = saved.x; n.y = saved.y }
    }
    return data
  }, [goals, links])

  const graphData = useMemo(() => {
    const nodes = baseData.nodes as FGNode[]
    if (!(focusMode && selectedGoalId)) return baseData
    const allowed = getNeighborhood(selectedGoalId, goals, links, 2)
    return {
      nodes: nodes.filter(n => allowed.has(n.id)),
      links: baseData.links.filter((l: any) => {
        const s = typeof l.source === 'object' ? l.source.id : l.source
        const t = typeof l.target === 'object' ? l.target.id : l.target
        return allowed.has(s) && allowed.has(t)
      }),
    }
  }, [baseData, focusMode, selectedGoalId, goals, links])

  const activeId = hoverId ?? selectedGoalId
  const highlight = useMemo(() => (activeId ? getNeighborhood(activeId, goals, links, 1) : null), [activeId, goals, links])

  // Keep the original (good) spacing between connected nodes, but add a gentle
  // central gravity so independent clusters gather into a rough circle.
  useEffect(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('charge')?.strength(-150)
    fg.d3Force('link')?.distance((l: any) => (l.type === 'parent_child' ? 40 : 72))
    fg.d3Force('gravity', centerGravity(0.08))
    fg.d3ReheatSimulation?.()
    // Re-fit once the layout has had time to settle into its circular shape.
    const t = setTimeout(() => fgRef.current?.zoomToFit(500, 60), 1600)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Esc → clear pending link or deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (linkSource) setLinkSource(null)
      else selectGoal(null)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectGoal, linkSource])

  const resetView = useCallback(() => fgRef.current?.zoomToFit(500, 60), [])

  // Shift+click to connect two goals.
  const handleNodeClick = useCallback((node: FGNode, e: MouseEvent) => {
    if (e?.shiftKey) {
      setLinkSource(prev => {
        if (!prev) return node.id
        if (prev !== node.id) createLink(prev, node.id, 'depends_on')
        return null
      })
      return
    }
    selectGoal(node.id)
  }, [createLink, selectGoal])

  const drawNode = useCallback((node: FGNode, ctx: CanvasRenderingContext2D, scale: number) => {
    if (node.x != null && node.y != null) posRef.current.set(node.id, { x: node.x, y: node.y })
    const color = graphNodeColor(node.type, node.status as any)
    const r = node.val
    const isSel = node.id === selectedGoalId
    const isLinkSrc = node.id === linkSource
    const inHi = !highlight || highlight.has(node.id)
    const alpha = inHi ? 1 : 0.16

    ctx.save()
    ctx.globalAlpha = alpha
    ctx.shadowColor = isLinkSrc ? LINK_ACCENT : isSel ? SELECT_GLOW : color
    ctx.shadowBlur = isLinkSrc ? 18 : isSel ? 16 : inHi && node.id === hoverId ? 8 : 0
    ctx.beginPath()
    ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI)
    ctx.fillStyle = color
    ctx.fill()
    ctx.shadowBlur = 0

    if (isSel || isLinkSrc) {
      ctx.beginPath()
      ctx.arc(node.x!, node.y!, r + 4, 0, 2 * Math.PI)
      ctx.strokeStyle = isLinkSrc ? LINK_ACCENT : SELECT_GLOW
      ctx.lineWidth = 1.4
      ctx.globalAlpha = 0.9
      ctx.stroke()
    }

    const showLabel = alwaysLabels || isSel || isLinkSrc || node.id === hoverId || (highlight?.has(node.id) && activeId) || scale > 2.6
    if (showLabel) {
      const fontSize = Math.max(2.8, 9 / scale)
      ctx.font = `${isSel ? 600 : 400} ${fontSize}px Inter, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.globalAlpha = inHi ? 0.85 : 0.25
      const label = node.title.length > 22 ? node.title.slice(0, 20) + '…' : node.title
      ctx.fillStyle = 'rgba(235,235,245,0.9)'
      ctx.fillText(label, node.x!, node.y! + r + 2)
    }
    ctx.restore()
  }, [selectedGoalId, hoverId, highlight, activeId, alwaysLabels, linkSource])

  const drawPointerArea = useCallback((node: FGNode, color: string, ctx: CanvasRenderingContext2D) => {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(node.x!, node.y!, node.val + 3, 0, 2 * Math.PI)
    ctx.fill()
  }, [])

  const linkColorFn = useCallback((l: any) => {
    const base = LINK_STYLE[l.type as keyof typeof LINK_STYLE]?.color ?? 'rgba(255,255,255,0.1)'
    if (!highlight) return base
    const s = typeof l.source === 'object' ? l.source.id : l.source
    const t = typeof l.target === 'object' ? l.target.id : l.target
    return highlight.has(s) && highlight.has(t) ? base : 'rgba(255,255,255,0.04)'
  }, [highlight])

  const sourceTitle = linkSource ? goals.find(g => g.id === linkSource)?.title : null

  return (
    <div ref={wrapRef} className="relative w-full h-full">
      <ForceGraph2D
        ref={fgRef}
        width={dims.w}
        height={dims.h}
        graphData={graphData}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        nodeCanvasObjectMode={() => 'replace'}
        nodeCanvasObject={drawNode as any}
        nodePointerAreaPaint={drawPointerArea as any}
        linkColor={linkColorFn as any}
        linkWidth={(l: any) => {
          if (!highlight) return l.type === 'blocks' ? 1.3 : 0.8
          const s = typeof l.source === 'object' ? l.source.id : l.source
          const t = typeof l.target === 'object' ? l.target.id : l.target
          return highlight.has(s) && highlight.has(t) ? 1.6 : 0.5
        }}
        linkLineDash={(l: any) => (LINK_STYLE[l.type as keyof typeof LINK_STYLE]?.dashed ? [3, 3] : null)}
        onNodeClick={handleNodeClick as any}
        onNodeHover={(n: any) => setHoverId(n ? n.id : null)}
        onBackgroundClick={() => { if (linkSource) setLinkSource(null); else selectGoal(null) }}
        onEngineStop={() => fgRef.current?.zoomToFit(500, 50)}
        cooldownTicks={160}
        d3VelocityDecay={0.32}
      />

      {/* Tools — top-right, just under the floating План/Граф/+ controls */}
      <div className="absolute top-16 right-4 flex items-center gap-1 p-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-xl">
        <ToolBtn active={focusMode} disabled={!selectedGoalId} onClick={() => setFocusMode(v => !v)} title="Фокус на выбранном"><Crosshair className="w-4 h-4" /></ToolBtn>
        <ToolBtn active={alwaysLabels} onClick={() => setAlwaysLabels(v => !v)} title="Показать подписи"><Tag className="w-4 h-4" /></ToolBtn>
        <ToolBtn active={false} onClick={resetView} title="Сбросить вид"><RotateCcw className="w-4 h-4" /></ToolBtn>
      </div>

      {/* Shift+click hint — passive, bottom-center */}
      {!linkSource && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-white/[0.05] border border-white/10 backdrop-blur-xl text-[11px] text-white/45">
          Shift + клик по двум целям, чтобы связать
        </div>
      )}

      {/* Active link prompt */}
      {linkSource && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-pink-400/15 border border-pink-400/30 backdrop-blur-xl text-[11px] text-pink-100/90 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: LINK_ACCENT }} />
          {sourceTitle ? `«${sourceTitle.length > 22 ? sourceTitle.slice(0, 20) + '…' : sourceTitle}»` : 'Цель выбрана'} → Shift + клик по второй
          <button onClick={() => setLinkSource(null)} className="ml-1 text-pink-100/60 hover:text-pink-100"><X className="w-3 h-3" /></button>
        </div>
      )}

      {/* legend behind a button (bottom-left) */}
      <div className="absolute bottom-3 left-3">
        <button onClick={() => setShowLegend(v => !v)} className="w-8 h-8 rounded-full flex items-center justify-center bg-white/[0.06] border border-white/10 backdrop-blur-xl text-white/60 hover:text-white/90 transition-colors">
          <Info className="w-4 h-4" />
        </button>
        {showLegend && (
          <div className="absolute bottom-10 left-0 p-3 rounded-2xl bg-[#0e0e13]/90 border border-white/10 backdrop-blur-xl flex flex-col gap-2 min-w-[140px]">
            {LEGEND.map(type => (
              <div key={type} className="flex items-center gap-2.5">
                <span className="w-2 h-2 rounded-full" style={{ background: graphNodeColor(type, 'active' as any) }} />
                <span className="text-[11px] text-white/70">{TYPE_LABEL[type]}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ToolBtn({ children, active, disabled, onClick, title }: { children: React.ReactNode; active: boolean; disabled?: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick} disabled={disabled} title={title}
      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'} ${active ? 'bg-pink-400/20 text-pink-200' : 'text-white/55 hover:text-white/90 hover:bg-white/[0.06]'}`}
    >
      {children}
    </button>
  )
}
