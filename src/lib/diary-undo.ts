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

/** Single grade entry in a template snapshot */
export interface TemplateGradeEntry {
  dayId: string
  lessonId: string
  gradeField: string
  value: 1 | 2 | 3 | 4 | 5 | null
}

/** Snapshot of all grades before a template was applied */
export interface TemplateUndoAction {
  type: 'template'
  weekId: string
  /** All grades that existed before the template wiped them */
  snapshot: TemplateGradeEntry[]
  label: string
}

export type DiaryUndoAction = GradeUndoAction | TemplateUndoAction

const MAX_STACK = 30
let undoStack: DiaryUndoAction[] = []
let redoStack: DiaryUndoAction[] = []

/** Push a new undoable grade action. Clears redo stack. */
export function pushGradeUndo(action: Omit<GradeUndoAction, 'type'>) {
  undoStack = [...undoStack.slice(-(MAX_STACK - 1)), { type: 'grade', ...action }]
  redoStack = []
}

/** Push a template undo action (snapshot of all grades). Clears redo stack. */
export function pushTemplateUndo(action: Omit<TemplateUndoAction, 'type'>) {
  undoStack = [...undoStack.slice(-(MAX_STACK - 1)), { type: 'template', ...action }]
  redoStack = []
}

/** Perform undo. Returns the label of the reverted action, or null if nothing to undo. */
export async function performUndo(
  patchFn: (weekId: string, dayId: string, lessonId: string, field: string, value: any) => Promise<void>,
): Promise<string | null> {
  const action = undoStack.pop()
  if (!action) return null

  if (action.type === 'grade') {
    await patchFn(action.weekId, action.dayId, action.lessonId, action.gradeField, action.before)
    redoStack = [...redoStack, action]
    return action.label
  }

  if (action.type === 'template') {
    // Restore all grades from snapshot in parallel
    await Promise.all(
      action.snapshot.map(entry =>
        patchFn(action.weekId, entry.dayId, entry.lessonId, entry.gradeField, entry.value)
      )
    )
    redoStack = [...redoStack, action]
    return action.label
  }

  return null
}

/** Perform redo. Returns the label of the reapplied action, or null if nothing to redo. */
export async function performRedo(
  patchFn: (weekId: string, dayId: string, lessonId: string, field: string, value: any) => Promise<void>,
): Promise<string | null> {
  const action = redoStack.pop()
  if (!action) return null

  if (action.type === 'grade') {
    await patchFn(action.weekId, action.dayId, action.lessonId, action.gradeField, action.after)
    undoStack = [...undoStack, action]
    return action.label
  }

  if (action.type === 'template') {
    // Re-apply template = wipe all grades (patch everything to null)
    await Promise.all(
      action.snapshot.map(entry =>
        patchFn(action.weekId, entry.dayId, entry.lessonId, entry.gradeField, null)
      )
    )
    undoStack = [...undoStack, action]
    return action.label
  }

  return null
}

export function canUndo() { return undoStack.length > 0 }
export function canRedo() { return redoStack.length > 0 }
export function undoDepth() { return undoStack.length }
export function redoDepth() { return redoStack.length }

/** Clear both stacks. */
export function clearUndoHistory() {
  undoStack = []
  redoStack = []
}
