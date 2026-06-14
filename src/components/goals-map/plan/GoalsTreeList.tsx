"use client"

import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Folder, Circle } from 'lucide-react'
import type { GoalNode } from '@/types/goals'
import { useGoalsStore } from '@/stores/goals-store'
import { useDragStore } from '@/stores/drag-store'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import { rangeForScale, goalsInRange } from '../utils/dateRange'
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

export function GoalsTreeList() {
  const goals = useGoalsStore(s => s.goals)
  const selectedDate = useGoalsStore(s => s.selectedDate)
  const reorderGoal = useGoalsStore(s => s.reorderGoal)
  const moveGoal = useGoalsStore(s => s.moveGoal)

  const setActive = useDragStore(s => s.setActive)
  const setOver = useDragStore(s => s.setOver)
  const resetDrag = useDragStore(s => s.reset)
  const [activeId, setActiveId] = useState<string | null>(null)

  const year = Number(selectedDate.slice(0, 4))

  const topGoals = useMemo(() => {
    const { start, end } = rangeForScale('month', selectedDate)
    const byRange = new Set(goalsInRange(goals, start, end).map(g => g.id))
    const yearlyContext = new Set(
      goals
        .filter(g => g.planningScale === 'year' && g.year === year && g.status !== 'archived')
        .map(g => g.id),
    )
    const relevant = new Set([...Array.from(byRange), ...Array.from(yearlyContext)])

    const childrenOf = (id: string) => goals.filter(g => g.parentId === id)
    const hasRel = (g: GoalNode): boolean =>
      relevant.has(g.id) || childrenOf(g.id).some(hasRel)

    return goals.filter(g => !g.parentId && g.status !== 'archived' && hasRel(g))
  }, [goals, selectedDate, year])

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
      <SortableGoalList goals={topGoals} parentId={null} depth={0} />

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
            <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#1a1a24]/95 border border-pink-400/25 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl text-[13px] font-medium text-foreground/95 cursor-grabbing">
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
