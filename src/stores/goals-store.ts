import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type {
  GoalNode, GoalLink, GoalView, GoalFilters, GoalLinkType, TimeScale, DateRange,
} from '@/types/goals'
import { MOCK_GOALS, MOCK_LINKS } from '@/components/goals-map/mock-data'
import { calculateGoalProgress, getActiveBlockers } from '@/components/goals-map/utils/calculateProgress'
import { todayISO } from '@/components/goals-map/utils/dateRange'

const EMPTY_FILTERS: GoalFilters = { status: [], type: [], month: null, priority: [] }

function uid(prefix = 'g'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

interface GoalsState {
  // ── data ──
  goals: GoalNode[]
  links: GoalLink[]

  // ── ui ──
  selectedGoalId: string | null
  activeView: GoalView
  timeScale: TimeScale
  selectedDate: string        // anchor day, "YYYY-MM-DD"
  dateRange: DateRange        // drag-selected range (null when none)
  filters: GoalFilters

  // ── view actions ──
  setActiveView: (view: GoalView) => void
  setTimeScale: (scale: TimeScale) => void
  setSelectedDate: (iso: string) => void
  setDateRange: (range: DateRange) => void
  selectGoal: (id: string | null) => void
  setFilters: (patch: Partial<GoalFilters>) => void

  // ── data actions ──
  createGoal: (payload: Partial<GoalNode> & { title: string; type: GoalNode['type'] }) => string
  updateGoal: (id: string, patch: Partial<GoalNode>) => void
  deleteGoal: (id: string) => void
  toggleTaskDone: (id: string) => void
  reorderGoal: (id: string, fromIdx: number, toIdx: number, parentId: string | null) => void
  moveGoal: (id: string, newParentId: string | null, overId: string | null) => void
  createLink: (source: string, target: string, type: GoalLinkType) => void
  deleteLink: (id: string) => void
  resetToMock: () => void

  // ── selectors (pure reads over current state) ──
  getChildren: (parentId: string) => GoalNode[]
  getDependencies: (goalId: string) => GoalNode[]
  getBlockedBy: (goalId: string) => GoalNode[]
  getProgress: (goalId: string) => number
}

export const useGoalsStore = create<GoalsState>()(
  persist(
    (set, get) => ({
      goals: MOCK_GOALS,
      links: MOCK_LINKS,

      selectedGoalId: null,
      activeView: 'plan',
      timeScale: 'month',
      selectedDate: todayISO(),
      dateRange: { start: null, end: null },
      filters: EMPTY_FILTERS,

      setActiveView: (view) => set({ activeView: view }),
      setTimeScale: (scale) => set({ timeScale: scale }),
      setSelectedDate: (iso) => set({ selectedDate: iso, dateRange: { start: null, end: null } }),
      setDateRange: (range) => set({ dateRange: range }),
      selectGoal: (id) => set({ selectedGoalId: id }),
      setFilters: (patch) => set(s => ({ filters: { ...s.filters, ...patch } })),

      createGoal: (payload) => {
        const id = payload.id ?? uid()
        const ts = new Date().toISOString()
        const goal: GoalNode = {
          status: 'not_started',
          progress: 0,
          ...payload,
          id,
          createdAt: ts,
          updatedAt: ts,
        }
        set(s => ({ goals: [...s.goals, goal] }))
        return id
      },

      updateGoal: (id, patch) =>
        set(s => ({
          goals: s.goals.map(g =>
            g.id === id ? { ...g, ...patch, updatedAt: new Date().toISOString() } : g,
          ),
        })),

      deleteGoal: (id) =>
        set(s => {
          // Collect the goal and all descendants.
          const toRemove = new Set<string>([id])
          let changed = true
          while (changed) {
            changed = false
            for (const goal of s.goals) {
              if (goal.parentId && toRemove.has(goal.parentId) && !toRemove.has(goal.id)) {
                toRemove.add(goal.id)
                changed = true
              }
            }
          }
          return {
            goals: s.goals.filter(g => !toRemove.has(g.id)),
            links: s.links.filter(l => !toRemove.has(l.source) && !toRemove.has(l.target)),
            selectedGoalId: toRemove.has(s.selectedGoalId ?? '') ? null : s.selectedGoalId,
          }
        }),

      toggleTaskDone: (id) =>
        set(s => ({
          goals: s.goals.map(g => {
            if (g.id !== id) return g
            const done = g.status === 'done'
            return {
              ...g,
              status: done ? 'active' : 'done',
              progress: done ? 0 : 100,
              updatedAt: new Date().toISOString(),
            }
          }),
        })),

      moveGoal: (id, newParentId, overId) =>
        set(s => {
          const isDescendant = (checkId: string, ancestorId: string): boolean => {
            if (checkId === ancestorId) return true
            const g = s.goals.find(x => x.id === checkId)
            if (!g?.parentId) return false
            return isDescendant(g.parentId, ancestorId)
          }
          if (newParentId !== null && isDescendant(newParentId, id)) return s

          const newSiblings = s.goals
            .filter(g => (g.parentId ?? null) === newParentId && g.id !== id && g.status !== 'archived')
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

          const overIdx = overId ? newSiblings.findIndex(g => g.id === overId) : -1
          const insertIdx = overIdx >= 0 ? overIdx + 1 : newSiblings.length
          const reordered = [...newSiblings]
          reordered.splice(insertIdx, 0, { id } as GoalNode)
          const orderMap = new Map(reordered.map((g, i) => [g.id, i]))
          const ts = new Date().toISOString()

          return {
            goals: s.goals.map(g => {
              if (g.id === id) return { ...g, parentId: newParentId ?? null, order: orderMap.get(id) ?? 0, updatedAt: ts }
              if (orderMap.has(g.id)) return { ...g, order: orderMap.get(g.id)!, updatedAt: ts }
              return g
            }),
          }
        }),

      reorderGoal: (id, fromIdx, toIdx, parentId) =>
        set(s => {
          const siblings = s.goals
            .filter(g => (g.parentId ?? null) === parentId && g.status !== 'archived')
            .sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)))
          if (fromIdx < 0 || toIdx < 0 || fromIdx >= siblings.length || toIdx >= siblings.length) return s
          const reordered = [...siblings]
          const [moved] = reordered.splice(fromIdx, 1)
          reordered.splice(toIdx, 0, moved)
          const orderMap = new Map(reordered.map((g, i) => [g.id, i]))
          return {
            goals: s.goals.map(g =>
              orderMap.has(g.id)
                ? { ...g, order: orderMap.get(g.id)!, updatedAt: new Date().toISOString() }
                : g
            ),
          }
        }),

      createLink: (source, target, type) =>
        set(s => {
          if (source === target) return s
          const exists = s.links.some(
            l => l.source === source && l.target === target && l.type === type,
          )
          if (exists) return s
          return { links: [...s.links, { id: uid('l'), source, target, type }] }
        }),

      deleteLink: (id) => set(s => ({ links: s.links.filter(l => l.id !== id) })),

      resetToMock: () =>
        set({ goals: MOCK_GOALS, links: MOCK_LINKS, selectedGoalId: null }),

      getChildren: (parentId) => get().goals.filter(g => g.parentId === parentId),

      getDependencies: (goalId) => {
        const { goals, links } = get()
        const ids = links.filter(l => l.type === 'depends_on' && l.source === goalId).map(l => l.target)
        const set_ = new Set(ids)
        return goals.filter(g => set_.has(g.id))
      },

      getBlockedBy: (goalId) => {
        const { goals, links } = get()
        return getActiveBlockers(goalId, goals, links)
      },

      getProgress: (goalId) => {
        const { goals } = get()
        return calculateGoalProgress(goalId, goals)
      },
    }),
    {
      name: 'timely-goals',
      version: 3, // bumped: GoalNode gained planningScale
      storage: createJSONStorage(() => localStorage),
      // Persist data only; transient UI state (selection/view) stays in-session.
      partialize: (s) => ({ goals: s.goals, links: s.links }),
      // New fields are optional, so old persisted state upgrades as-is.
      migrate: (persisted) => persisted as { goals: GoalNode[]; links: GoalLink[] },
    },
  ),
)
