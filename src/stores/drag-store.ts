import { create } from 'zustand'

/**
 * Transient drag state for the goals tree.
 *
 * Kept in its own Zustand store (not React Context) so that updating `overId`
 * on every pointer-move only re-renders the rows whose selected boolean
 * actually changed — instead of every row in the tree (which caused the
 * drag lag / micro-stutter).
 */
interface DragState {
  activeId: string | null
  overId: string | null
  setActive: (id: string | null) => void
  setOver: (id: string | null) => void
  reset: () => void
}

export const useDragStore = create<DragState>((set) => ({
  activeId: null,
  overId: null,
  setActive: (id) => set((s) => (s.activeId === id ? s : { activeId: id })),
  setOver: (id) => set((s) => (s.overId === id ? s : { overId: id })),
  reset: () => set((s) => (s.activeId === null && s.overId === null ? s : { activeId: null, overId: null })),
}))
