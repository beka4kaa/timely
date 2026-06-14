"use client"

import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Folder, FolderOpen, Circle, CheckCircle2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { GoalNode } from '@/types/goals'
import { useGoalsStore } from '@/stores/goals-store'
import { useDragStore } from '@/stores/drag-store'
import { ACCENT_GRADIENT } from '@/components/habits/lib'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  defaultAnimateLayoutChanges,
  type AnimateLayoutChanges,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// Keep items animated even when they were just dragged (smoother settle on drop).
const animateLayoutChanges: AnimateLayoutChanges = (args) =>
  defaultAnimateLayoutChanges({ ...args, wasDragging: true })

// Stable id for the "drop at the very end of this list" zone.
export const endDropId = (parentId: string | null) => `end:${parentId ?? 'root'}`

type GoalListFC = (props: { goals: GoalNode[]; parentId: string | null; depth?: number }) => React.ReactElement | null
let SortableGoalList: GoalListFC = () => null

// ── GoalRow ──────────────────────────────────────────────────────────────────
export function GoalRow({ goal, depth = 0 }: { goal: GoalNode; depth?: number }) {
  const goals = useGoalsStore(s => s.goals)
  const selectedGoalId = useGoalsStore(s => s.selectedGoalId)
  const selectGoal = useGoalsStore(s => s.selectGoal)
  const toggleTaskDone = useGoalsStore(s => s.toggleTaskDone)
  const getProgress = useGoalsStore(s => s.getProgress)

  // Per-row selectors → only this row re-renders when ITS drop state flips.
  const isDropTarget = useDragStore(s => !!s.activeId && s.overId === goal.id && s.activeId !== goal.id)

  const children = goals
    .filter(g => g.parentId === goal.id && g.status !== 'archived')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const hasChildren = children.length > 0
  const [open, setOpen] = useState(depth < 2)

  const isSelected = selectedGoalId === goal.id
  const isDone = goal.status === 'done'
  const isTask = goal.type === 'task'
  const progress = getProgress(goal.id)

  const isFolderTarget = isDropTarget && hasChildren && !isTask

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: goal.id,
    animateLayoutChanges,
  })

  // Suppress the click that fires right after a real drag completes.
  const wasDragging = useRef(false)
  useEffect(() => {
    if (isDragging) wasDragging.current = true
  }, [isDragging])

  const handleRowClick = () => {
    if (wasDragging.current) { wasDragging.current = false; return }
    selectGoal(isSelected ? null : goal.id)
  }

  return (
    <div className="relative">
      <div
        ref={setNodeRef}
        style={{ transform: CSS.Transform.toString(transform), transition }}
        className="relative"
      >
        {/* Insertion line — glows at the top edge of the drop target */}
        {isDropTarget && !isFolderTarget && <InsertionLine />}

        {/* Indentation wrapper */}
        <div style={{ paddingLeft: depth * 18 }}>
          <div
            {...attributes}
            {...listeners}
            onClick={handleRowClick}
            className={cn(
              'group flex items-center gap-2 rounded-xl py-1.5 px-2 cursor-grab active:cursor-grabbing transition-[background-color,box-shadow] duration-150 select-none',
              isSelected
                ? 'bg-foreground/[0.06] ring-1 ring-foreground/[0.08]'
                : 'hover:bg-foreground/[0.035]',
              isFolderTarget && 'ring-1 ring-pink-400/50 bg-pink-400/[0.07] shadow-[0_0_14px_rgba(244,114,182,0.12)]',
              isDragging && 'opacity-0',
            )}
          >
            {isTask || !hasChildren ? (
              <button
                onClick={e => { e.stopPropagation(); toggleTaskDone(goal.id) }}
                className="shrink-0 transition-colors"
              >
                {isDone
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400/70" />
                  : <Circle className="w-3.5 h-3.5 text-foreground/20 hover:text-foreground/40" />}
              </button>
            ) : (
              <button
                onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
                className="shrink-0 transition-colors"
              >
                {open
                  ? <FolderOpen className={cn('w-4 h-4', isFolderTarget ? 'text-pink-400' : 'text-pink-400/70')} />
                  : <Folder className={cn('w-4 h-4', isFolderTarget ? 'text-pink-400' : 'text-muted-foreground/50 hover:text-muted-foreground/80')} />}
              </button>
            )}

            <span className={cn(
              'flex-1 min-w-0 truncate',
              depth === 0 ? 'text-[13px] font-medium' : 'text-[12px] font-normal',
              isDone ? 'text-muted-foreground/60 line-through' : 'text-foreground/90',
            )}>
              {goal.title}
            </span>

            {!isDone && !isTask && progress > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="w-10 h-1 rounded-full bg-foreground/10 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${progress}%`, background: ACCENT_GRADIENT }} />
                </div>
                {depth === 0 && (
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground/50 w-6 text-right">
                    {progress}%
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {!isDragging && open && hasChildren && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pt-0.5">
              <SortableGoalList goals={children} parentId={goal.id} depth={depth + 1} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function InsertionLine() {
  return (
    <motion.div
      initial={{ opacity: 0, scaleX: 0.6 }}
      animate={{ opacity: 1, scaleX: 1 }}
      transition={{ duration: 0.15 }}
      className="absolute -top-[3px] left-1 right-1 h-[2px] rounded-full z-10"
      style={{ background: ACCENT_GRADIENT, boxShadow: '0 0 8px rgba(244,114,182,0.6)' }}
    />
  )
}

// ── End-of-list drop zone: lets you drop AFTER the last item in a folder ──────
function EndDropZone({ parentId, depth }: { parentId: string | null; depth: number }) {
  const id = endDropId(parentId)
  const { setNodeRef, transform, transition } = useSortable({ id, animateLayoutChanges })
  const isActive = useDragStore(s => s.activeId != null)
  const isOver = useDragStore(s => s.overId === id)

  return (
    <div
      ref={setNodeRef}
      style={{ paddingLeft: depth * 18, transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative', isActive ? 'h-2 -my-0.5' : 'h-1')}
    >
      {isOver && (
        <div
          className="absolute left-1 right-1 top-1/2 h-[2px] -translate-y-1/2 rounded-full"
          style={{ background: ACCENT_GRADIENT, boxShadow: '0 0 8px rgba(244,114,182,0.6)' }}
        />
      )}
    </div>
  )
}

// ── SortableGoalList — one SortableContext per sibling level, no DndContext ───
function SortableGoalListImpl({
  goals,
  parentId,
  depth = 0,
}: {
  goals: GoalNode[]
  parentId: string | null
  depth?: number
}) {
  const createGoal = useGoalsStore(s => s.createGoal)
  const selectGoal = useGoalsStore(s => s.selectGoal)
  const selectedDate = useGoalsStore(s => s.selectedDate)

  const sorted = [...goals].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  // Include the end-drop zone in the sortable items so dnd-kit resolves a valid
  // overIndex when hovering it. Without it, overIndex is -1 and the list strategy
  // displaces every row by the dragged item's full height — a huge gap when
  // dropping a folder at the very end.
  const endId = endDropId(parentId)
  const ids = [...sorted.map(g => g.id), endId]

  if (sorted.length === 0 && depth === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 gap-2">
        <p className="text-sm font-medium text-foreground/80">В этом месяце пока пусто</p>
        <p className="text-xs text-muted-foreground">Запланируй цель — она появится здесь и в календаре.</p>
        <button
          onClick={() => {
            const id = createGoal({
              title: 'Новая цель', type: 'goal', status: 'active',
              startDate: selectedDate, month: selectedDate.slice(0, 7), priority: 'medium',
            })
            selectGoal(id)
          }}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-foreground/[0.06] transition-colors"
        >
          <Plus className="w-4 h-4" /> Добавить цель
        </button>
      </div>
    )
  }

  return (
    <SortableContext id={parentId ?? 'root'} items={ids} strategy={verticalListSortingStrategy}>
      <div className="flex flex-col gap-0.5">
        {sorted.map(g => <GoalRow key={g.id} goal={g} depth={depth} />)}
        <EndDropZone parentId={parentId} depth={depth} />
        {depth === 0 && sorted.length > 0 && (
          <button
            onClick={() => {
              const id = createGoal({
                title: 'Новая цель', type: 'goal', status: 'active',
                startDate: selectedDate, month: selectedDate.slice(0, 7), priority: 'medium',
              })
              selectGoal(id)
            }}
            className="self-start mt-1 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Добавить цель
          </button>
        )}
      </div>
    </SortableContext>
  )
}

SortableGoalList = SortableGoalListImpl
export { SortableGoalList }
