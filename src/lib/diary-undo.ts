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
  label: string
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

export type DiaryUndoAction = GradeUndoAction | TemplateUndoAction

const MAX_STACK = 30
let undoStack: DiaryUndoAction[] = []
let redoStack: DiaryUndoAction[] = []

/** Push a new undoable grade action. Clears redo stack. */
export function pushGradeUndo(action: Omit<GradeUndoAction, 'type'>) {
  undoStack = [...undoStack.slice(-(MAX_STACK - 1)), { type: 'grade', ...action }]
  redoStack = []
}

/** Push a template undo action (full week snapshot). Clears redo stack. */
export function pushTemplateUndo(action: Omit<TemplateUndoAction, 'type'>) {
  undoStack = [...undoStack.slice(-(MAX_STACK - 1)), { type: 'template', ...action }]
  redoStack = []
}

/**
 * Perform undo.
 * @param patchFn - for grade undo: patches a single grade field
 * @param restoreWeekFn - for template undo: restores the full week snapshot
 * Returns the human-readable label, or null if nothing to undo.
 */
export async function performUndo(
  patchFn: (weekId: string, dayId: string, lessonId: string, field: string, value: any) => Promise<void>,
  restoreWeekFn?: (weekId: string, snapshot: any) => Promise<void>,
): Promise<string | null> {
  const action = undoStack.pop()
  if (!action) return null

  if (action.type === 'grade') {
    await patchFn(action.weekId, action.dayId, action.lessonId, action.gradeField, action.before)
    redoStack = [...redoStack, action]
    return action.label
  }

  if (action.type === 'template') {
    if (restoreWeekFn) {
      await restoreWeekFn(action.weekId, action.weekSnapshot)
    }
    redoStack = [...redoStack, action]
    return action.label
  }

  return null
}

/**
 * Perform redo.
 * Note: redo of template apply is not supported (would require a second snapshot).
 * Template redo actions are silently discarded.
 */
export async function performRedo(
  patchFn: (weekId: string, dayId: string, lessonId: string, field: string, value: any) => Promise<void>,
  restoreWeekFn?: (weekId: string, snapshot: any) => Promise<void>,
): Promise<string | null> {
  const action = redoStack.pop()
  if (!action) return null

  if (action.type === 'grade') {
    await patchFn(action.weekId, action.dayId, action.lessonId, action.gradeField, action.after)
    undoStack = [...undoStack, action]
    return action.label
  }

  if (action.type === 'template') {
    // Redo of template not supported — silently discard action
    return null
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
