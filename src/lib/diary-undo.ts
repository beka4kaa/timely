/**
 * diary-undo.ts
 * Lightweight undo/redo manager for diary changes.
 * Module-level singleton — persists across re-renders.
 */

import type { DayOfWeek } from '@/types/diary'

/**
 * Where a lesson sits in its week. Lesson ids are not stable: an untouched week
 * is rebuilt with new ids on every GET, so an action recorded earlier has to be
 * able to find its lesson again.
 */
export interface LessonSlot {
  dayOfWeek: DayOfWeek
  lessonNumber: number
  startTime: string
}

interface LessonUndoBase {
  weekId: string
  dayId: string
  lessonId: string
  slot: LessonSlot
  label: string
}

export interface GradeUndoAction extends LessonUndoBase {
  type: 'grade'
  gradeField: string          // 'retelling' | 'exercises' | 'test'
  before: 1 | 2 | 3 | 4 | 5 | null
  after: 1 | 2 | 3 | 4 | 5 | null
}

export interface HomeworkUndoAction extends LessonUndoBase {
  type: 'homework'
  before: string
  after: string
}

/**
 * Stores the FULL DiaryWeek JSON before a template was applied.
 * On undo, restores the entire week via PUT /api/diary/week.
 * This is necessary because forceRecreateWeek generates NEW UUIDs for
 * every day and lesson, so individual dayId/lessonId patches would fail.
 */
export interface TemplateUndoAction {
  type: 'template'
  weekId: string
  weekSnapshot: any  // full DiaryWeek JSON before template was applied
  label: string
}

export type LessonUndoAction = GradeUndoAction | HomeworkUndoAction
export type DiaryUndoAction = LessonUndoAction | TemplateUndoAction

const MAX_STACK = 30
let undoStack: DiaryUndoAction[] = []
let redoStack: DiaryUndoAction[] = []

// ── Listeners ────────────────────────────────────────────────
type HistoryListener = () => void
let listeners: HistoryListener[] = []

function notifyListeners() {
  listeners.forEach(fn => fn())
}

/** Subscribe to undo/redo stack changes. Returns unsubscribe fn. */
export function subscribeHistory(fn: HistoryListener): () => void {
  listeners = [...listeners, fn]
  return () => { listeners = listeners.filter(l => l !== fn) }
}

function pushUndo(action: DiaryUndoAction) {
  undoStack = [...undoStack.slice(-(MAX_STACK - 1)), action]
  redoStack = []
  notifyListeners()
}

/** Push a new undoable grade action. Clears redo stack. */
export function pushGradeUndo(action: Omit<GradeUndoAction, 'type'>) {
  pushUndo({ type: 'grade', ...action })
}

/** Push a new undoable homework text action. Clears redo stack. */
export function pushHomeworkUndo(action: Omit<HomeworkUndoAction, 'type'>) {
  pushUndo({ type: 'homework', ...action })
}

/** Push a template undo action (full week snapshot). Clears redo stack. */
export function pushTemplateUndo(action: Omit<TemplateUndoAction, 'type'>) {
  pushUndo({ type: 'template', ...action })
}

/** Writes one value of a lesson back: the `before` of an undo, the `after` of a redo. */
export type LessonPatchFn = (action: LessonUndoAction, value: LessonUndoAction['before']) => Promise<void>

/**
 * Perform undo.
 * @param patchFn - for lesson undo: writes the previous value back
 * @param restoreWeekFn - for template undo: restores the full week snapshot
 * Returns the human-readable label, or null if nothing to undo.
 * A failed write leaves the action on the stack, so it can be tried again.
 */
export async function performUndo(
  patchFn: LessonPatchFn,
  restoreWeekFn?: (weekId: string, snapshot: any) => Promise<void>,
): Promise<string | null> {
  const action = undoStack[undoStack.length - 1]
  if (!action) return null

  if (action.type === 'template') {
    if (restoreWeekFn) {
      await restoreWeekFn(action.weekId, action.weekSnapshot)
    }
  } else {
    await patchFn(action, action.before)
  }

  undoStack = undoStack.filter(item => item !== action)
  redoStack = [...redoStack, action]
  notifyListeners()
  return action.label
}

/**
 * Perform redo.
 * Note: redo of template apply is not supported (would require a second snapshot).
 * Template redo actions are silently discarded.
 */
export async function performRedo(
  patchFn: LessonPatchFn,
): Promise<string | null> {
  const action = redoStack[redoStack.length - 1]
  if (!action) return null

  if (action.type === 'template') {
    // Redo of template not supported — silently discard action
    redoStack = redoStack.filter(item => item !== action)
    notifyListeners()
    return null
  }

  await patchFn(action, action.after)
  redoStack = redoStack.filter(item => item !== action)
  undoStack = [...undoStack, action]
  notifyListeners()
  return action.label
}

export function canUndo() { return undoStack.length > 0 }
export function canRedo() { return redoStack.length > 0 }

/** Label of the action the next undo would revert. */
export function nextUndoLabel(): string | null {
  return undoStack[undoStack.length - 1]?.label ?? null
}

/** Clear both stacks. */
export function clearUndoHistory() {
  undoStack = []
  redoStack = []
  notifyListeners()
}
