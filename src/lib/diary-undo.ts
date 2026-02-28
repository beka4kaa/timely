/**
 * diary-undo.ts
 * Lightweight undo/redo manager for diary grade changes.
 * Module-level singleton — persists across re-renders.
 */

export interface GradeUndoAction {
  type: 'grade'
  weekId: string
  dayId: string
  lessonId: string
  gradeField: string          // 'retelling' | 'exercises' | 'test'
  before: 1 | 2 | 3 | 4 | 5 | null
  after: 1 | 2 | 3 | 4 | 5 | null
  label: string               // human-readable, e.g. "Оценка Упражнения: 4"
}

export type DiaryUndoAction = GradeUndoAction

const MAX_STACK = 30
let undoStack: DiaryUndoAction[] = []
let redoStack: DiaryUndoAction[] = []

/** Push a new undoable action. Clears redo stack. */
export function pushGradeUndo(action: Omit<GradeUndoAction, 'type'>) {
  undoStack = [...undoStack.slice(-(MAX_STACK - 1)), { type: 'grade', ...action }]
  redoStack = []
}

/** Perform undo. Returns the label of the reverted action, or null if nothing to undo. */
export async function performUndo(
  patchFn: (weekId: string, dayId: string, lessonId: string, field: string, value: any) => Promise<void>,
): Promise<string | null> {
  const action = undoStack.pop()
  if (!action) return null
  await patchFn(action.weekId, action.dayId, action.lessonId, action.gradeField, action.before)
  redoStack = [...redoStack, action]
  return action.label
}

/** Perform redo. Returns the label of the reapplied action, or null if nothing to redo. */
export async function performRedo(
  patchFn: (weekId: string, dayId: string, lessonId: string, field: string, value: any) => Promise<void>,
): Promise<string | null> {
  const action = redoStack.pop()
  if (!action) return null
  await patchFn(action.weekId, action.dayId, action.lessonId, action.gradeField, action.after)
  undoStack = [...undoStack, action]
  return action.label
}

export function canUndo() { return undoStack.length > 0 }
export function canRedo() { return redoStack.length > 0 }
export function undoDepth() { return undoStack.length }
export function redoDepth() { return redoStack.length }

/** Clear both stacks (e.g. when navigating away or applying a template). */
export function clearUndoHistory() {
  undoStack = []
  redoStack = []
}
