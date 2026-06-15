"use client"

import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Folder, Circle } from 'lucide-react'
import type { GoalNode } from '@/types/goals'
import { useGoalsStore } from '@/stores/goals-store'
import { useDragStore } from '@/stores/drag-store'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import { goalInScope, type PlanScope } from '../utils/dateRange'
import { SortableGoalList } from './GoalRow'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  defaultDropAnimationSideEffects,
} from '@dnd-kit/core'

// end-drop zone ids look like "end:<parentId|root>"
function parseEndZone(id: string): string | null | undefined {
  if (!id.startsWith('end:')) return undefined        // not an end zone
  const pid = id.slice(4)
  return pid === 'root' ? null : pid                   // parentId to append into
}

export function GoalsTreeList({
  scope = 'month',
  createScale,
  emptyHint,
}: {
  scope?: PlanScope
  createScale?: PlanScope
  emptyHint?: string
} = {}) {
  const goals = useGoalsStore(s => s.goals)
  const selectedDate = useGoalsStore(s => s.selectedDate)
  const reorderGoal = useGoalsStore(s => s.reorderGoal)
  const moveGoal = useGoalsStore(s => s.moveGoal)

  const setActive = useDragStore(s => s.setActive)
  const setOver = useDragStore(s => s.setOver)
  const resetDrag = useDragStore(s => s.reset)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Walk the tree once: keep a goal if it (or any descendant) is in scope. The
  // kept set is threaded into the list so each folder only shows its in-scope
  // children — no more "looking at August but seeing June goals" bleed.
  const { topGoals, keptIds } = useMemo(() => {
    const childrenOf = new Map<string | null, GoalNode[]>()
    for (const g of goals) {
      if (g.status === 'archived') continue
      const p = g.parentId ?? null
      const arr = childrenOf.get(p)
      if (arr) arr.push(g); else childrenOf.set(p, [g])
    }
    const kept = new Set<string>()
    const visit = (g: GoalNode): boolean => {
      let anyChild = false
      for (const c of childrenOf.get(g.id) ?? []) {
        if (visit(c)) anyChild = true
      }
      const keep = goalInScope(g, scope, selectedDate) || anyChild
      if (keep) kept.add(g.id)
      return keep
    }
    for (const g of childrenOf.get(null) ?? []) visit(g)
    const roots = (childrenOf.get(null) ?? []).filter(g => kept.has(g.id))
    return { topGoals: roots, keptIds: kept }
  }, [goals, scope, selectedDate])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const activeGoal = activeId ? goals.find(g => g.id === activeId) ?? null : null
  const activeHasChildren = activeGoal
    ? goals.some(g => g.parentId === activeGoal.id && g.status !== 'archived')
    : false

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string)
    setActive(event.active.id as string)
  }

  function handleDragOver(event: DragOverEvent) {
    setOver((event.over?.id as string) ?? null)
  }

  function handleDragCancel() {
    setActiveId(null)
    resetDrag()
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null)
    resetDrag()
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeId = active.id as string
    const overRawId = over.id as string

    const activeContainerId = (active.data.current?.sortable?.containerId as string) ?? 'root'
    const activeParentId = activeContainerId === 'root' ? null : activeContainerId

    // Dropped onto an end-of-list zone → append into that parent.
    const endParent = parseEndZone(overRawId)
    if (endParent !== undefined) {
      moveGoal(activeId, endParent, null)   // overId=null → append at end
      return
    }

    // containerId is the SortableContext id — equals parentId (or 'root' for top level)
    const overContainerId = (over.data.current?.sortable?.containerId as string) ?? 'root'
    const overParentId = overContainerId === 'root' ? null : overContainerId

    if (activeParentId === overParentId) {
      // Same parent → reorder within siblings
      const siblings = goals
        .filter(g => (g.parentId ?? null) === activeParentId && g.status !== 'archived')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      const oldIdx = siblings.findIndex(g => g.id === activeId)
      const newIdx = siblings.findIndex(g => g.id === overRawId)
      if (oldIdx !== -1 && newIdx !== -1) {
        reorderGoal(activeId, oldIdx, newIdx, activeParentId)
      }
    } else {
      // Different parent → move cross-tree (insert after the hovered item)
      moveGoal(activeId, overParentId, overRawId)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableGoalList
        goals={topGoals}
        parentId={null}
        depth={0}
        keptIds={keptIds}
        createScale={createScale ?? scope}
        emptyHint={emptyHint}
      />

      {/* Portal the overlay to <body> so it isn't trapped by a filtered/transformed
          ancestor (the framer-motion plan wrapper keeps `filter: blur(0px)`, which
          would otherwise become the containing block for this fixed-position overlay). */}
      {typeof document !== 'undefined' && createPortal(
        <DragOverlay
          dropAnimation={{
            duration: 220,
            easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: '0.4' } } }),
          }}
        >
          {activeGoal && (
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/95 dark:bg-[#1a1a24]/95 border border-pink-500/25 dark:border-pink-400/25 shadow-[0_12px_40px_-6px_rgba(15,23,42,0.35)] dark:shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl max-sm:backdrop-blur-none text-[13px] font-medium text-foreground/95 cursor-grabbing">
              {activeHasChildren
                ? <Folder className="w-4 h-4 text-pink-400 shrink-0" />
                : <Circle className="w-3.5 h-3.5 text-foreground/40 shrink-0" />}
              <span className="truncate max-w-[220px]">{activeGoal.title}</span>
              <span
                className="ml-1 h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: ACCENT_GRADIENT }}
              />
            </div>
          )}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  )
}
