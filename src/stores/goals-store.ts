import { create } from 'zustand'
import type {
  GoalNode, GoalLink, GoalView, GoalFilters, GoalLinkType, TimeScale, DateRange, Currency,
} from '@/types/goals'
import { calculateGoalProgress, getActiveBlockers } from '@/components/goals-map/utils/calculateProgress'
import { todayISO } from '@/components/goals-map/utils/dateRange'

const EMPTY_FILTERS: GoalFilters = { status: [], type: [], month: null, priority: [] }

function uid(prefix = 'g'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`
}

function nowIso(): string {
  return new Date().toISOString()
}

function numberOrUndefined(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function normalizeGoal(raw: Record<string, any>): GoalNode {
  const createdAt = stringOrUndefined(raw.createdAt) ?? stringOrUndefined(raw.created_at) ?? nowIso()
  const updatedAt = stringOrUndefined(raw.updatedAt) ?? stringOrUndefined(raw.updated_at) ?? createdAt

  return {
    id: String(raw.id),
    title: String(raw.title ?? ''),
    description: stringOrUndefined(raw.description),
    type: raw.type ?? 'task',
    status: raw.status ?? 'not_started',
    parentId: raw.parentId ?? raw.parent_id ?? null,
    planningScale: raw.planningScale ?? raw.planning_scale ?? undefined,
    month: stringOrUndefined(raw.month),
    quarter: stringOrUndefined(raw.quarter),
    year: numberOrUndefined(raw.year),
    startDate: stringOrUndefined(raw.startDate) ?? stringOrUndefined(raw.start_date),
    endDate: stringOrUndefined(raw.endDate) ?? stringOrUndefined(raw.end_date),
    dueDate: stringOrUndefined(raw.dueDate) ?? stringOrUndefined(raw.due_date),
    time: stringOrUndefined(raw.time),
    progress: numberOrUndefined(raw.progress) ?? 0,
    priority: raw.priority ?? undefined,
    order: numberOrUndefined(raw.order) ?? numberOrUndefined(raw.order_index) ?? 0,
    targetAmount: numberOrUndefined(raw.targetAmount) ?? numberOrUndefined(raw.target_amount),
    currentAmount: numberOrUndefined(raw.currentAmount) ?? numberOrUndefined(raw.current_amount),
    currency: (raw.currency ?? undefined) as Currency | undefined,
    deadline: stringOrUndefined(raw.deadline),
    notes: stringOrUndefined(raw.notes),
    createdAt,
    updatedAt,
  }
}

function normalizeLink(raw: Record<string, any>): GoalLink {
  return {
    id: String(raw.id),
    source: String(raw.source),
    target: String(raw.target),
    type: raw.type ?? 'related_to',
    strength: numberOrUndefined(raw.strength),
  }
}

function normalizeSnapshot(data: any): { goals: GoalNode[]; links: GoalLink[] } {
  return {
    goals: Array.isArray(data?.goals) ? data.goals.map(normalizeGoal) : [],
    links: Array.isArray(data?.links) ? data.links.map(normalizeLink) : [],
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = await response.json()
    return data?.error || data?.detail || `Request failed with ${response.status}`
  } catch {
    return `Request failed with ${response.status}`
  }
}

interface GoalsState {
  // -- backend-backed data --
  goals: GoalNode[]
  links: GoalLink[]
  isLoading: boolean
  isSyncing: boolean
  hasLoaded: boolean
  loadError: string | null
  syncError: string | null
  lastSyncedAt: string | null
  revision: number

  // -- ui --
  selectedGoalId: string | null
  activeView: GoalView
  timeScale: TimeScale
  selectedDate: string
  dateRange: DateRange
  filters: GoalFilters

  // -- backend actions --
  loadGoals: (force?: boolean) => Promise<void>
  syncNow: () => Promise<void>

  // -- view actions --
  setActiveView: (view: GoalView) => void
  setTimeScale: (scale: TimeScale) => void
  setSelectedDate: (iso: string) => void
  setDateRange: (range: DateRange) => void
  selectGoal: (id: string | null) => void
  setFilters: (patch: Partial<GoalFilters>) => void

  // -- data actions --
  createGoal: (payload: Partial<GoalNode> & { title: string; type: GoalNode['type'] }) => string
  updateGoal: (id: string, patch: Partial<GoalNode>) => void
  deleteGoal: (id: string) => void
  toggleTaskDone: (id: string) => void
  reorderGoal: (id: string, fromIdx: number, toIdx: number, parentId: string | null) => void
  moveGoal: (id: string, newParentId: string | null, overId: string | null) => void
  createLink: (source: string, target: string, type: GoalLinkType) => void
  deleteLink: (id: string) => void

  // -- selectors --
  getChildren: (parentId: string) => GoalNode[]
  getDependencies: (goalId: string) => GoalNode[]
  getBlockedBy: (goalId: string) => GoalNode[]
  getProgress: (goalId: string) => number
}

export const useGoalsStore = create<GoalsState>()((set, get) => {
  let syncTimer: ReturnType<typeof setTimeout> | null = null
  let syncInFlight = false
  let syncQueued = false

  const pushToBackend = async (): Promise<void> => {
    if (syncInFlight) {
      syncQueued = true
      return
    }

    syncInFlight = true
    const revision = get().revision
    const snapshot = { goals: get().goals, links: get().links }
    set({ isSyncing: true, syncError: null })

    try {
      const response = await fetch('/api/goals/bulk-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      })
      if (!response.ok) throw new Error(await readError(response))
      const data = normalizeSnapshot(await response.json())

      if (get().revision === revision) {
        set({
          ...data,
          isSyncing: false,
          syncError: null,
          lastSyncedAt: nowIso(),
        })
      } else {
        set({ isSyncing: false, syncError: null, lastSyncedAt: nowIso() })
      }
    } catch (error) {
      set({
        isSyncing: false,
        syncError: error instanceof Error ? error.message : 'Failed to sync goals',
      })
    } finally {
      syncInFlight = false
      if (syncQueued) {
        syncQueued = false
        scheduleSync(0)
      }
    }
  }

  const scheduleSync = (delay = 350) => {
    if (!get().hasLoaded) return
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = null
      void pushToBackend()
    }, delay)
  }

  const mutate = (recipe: (state: GoalsState) => Partial<GoalsState>) => {
    set(state => ({ ...recipe(state), revision: state.revision + 1 }))
    scheduleSync()
  }

  return {
    goals: [],
    links: [],
    isLoading: false,
    isSyncing: false,
    hasLoaded: false,
    loadError: null,
    syncError: null,
    lastSyncedAt: null,
    revision: 0,

    selectedGoalId: null,
    activeView: 'plan',
    timeScale: 'month',
    selectedDate: todayISO(),
    dateRange: { start: null, end: null },
    filters: EMPTY_FILTERS,

    loadGoals: async (force = false) => {
      const state = get()
      if (state.isLoading || (state.hasLoaded && !force)) return

      const revision = state.revision
      set({ isLoading: true, loadError: null })
      try {
        const response = await fetch('/api/goals', { cache: 'no-store' })
        if (!response.ok) throw new Error(await readError(response))
        const data = normalizeSnapshot(await response.json())

        if (get().revision === revision) {
          set({ ...data, isLoading: false, hasLoaded: true, loadError: null })
        } else {
          set({ isLoading: false, hasLoaded: true, loadError: null })
        }
      } catch (error) {
        set({
          isLoading: false,
          loadError: error instanceof Error ? error.message : 'Failed to load goals',
        })
      }
    },

    syncNow: async () => {
      if (syncTimer) {
        clearTimeout(syncTimer)
        syncTimer = null
      }
      await pushToBackend()
    },

    setActiveView: (view) => set({ activeView: view }),
    setTimeScale: (scale) => set({ timeScale: scale }),
    setSelectedDate: (iso) => set({ selectedDate: iso, dateRange: { start: null, end: null } }),
    setDateRange: (range) => set({ dateRange: range }),
    selectGoal: (id) => set({ selectedGoalId: id }),
    setFilters: (patch) => set(s => ({ filters: { ...s.filters, ...patch } })),

    createGoal: (payload) => {
      const id = payload.id ?? uid()
      const ts = nowIso()
      const parentId = payload.parentId ?? null
      const siblingOrders = get().goals
        .filter(g => (g.parentId ?? null) === parentId && g.status !== 'archived')
        .map(g => g.order ?? 0)
      const order = payload.order ?? (siblingOrders.length > 0 ? Math.max(...siblingOrders) + 1 : 0)
      const goal: GoalNode = {
        status: 'not_started',
        progress: 0,
        ...payload,
        id,
        parentId,
        order,
        createdAt: ts,
        updatedAt: ts,
      }
      mutate(s => ({ goals: [...s.goals, goal] }))
      return id
    },

    updateGoal: (id, patch) =>
      mutate(s => ({
        goals: s.goals.map(g =>
          g.id === id ? { ...g, ...patch, updatedAt: nowIso() } : g,
        ),
      })),

    deleteGoal: (id) =>
      mutate(s => {
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
      mutate(s => ({
        goals: s.goals.map(g => {
          if (g.id !== id) return g
          const done = g.status === 'done'
          return {
            ...g,
            status: done ? 'active' : 'done',
            progress: done ? 0 : 100,
            updatedAt: nowIso(),
          }
        }),
      })),

    moveGoal: (id, newParentId, overId) =>
      mutate(s => {
        const isDescendant = (checkId: string, ancestorId: string): boolean => {
          if (checkId === ancestorId) return true
          const g = s.goals.find(x => x.id === checkId)
          if (!g?.parentId) return false
          return isDescendant(g.parentId, ancestorId)
        }
        if (newParentId !== null && isDescendant(newParentId, id)) return {}

        const newSiblings = s.goals
          .filter(g => (g.parentId ?? null) === newParentId && g.id !== id && g.status !== 'archived')
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

        const overIdx = overId ? newSiblings.findIndex(g => g.id === overId) : -1
        const insertIdx = overIdx >= 0 ? overIdx + 1 : newSiblings.length
        const reordered = [...newSiblings]
        reordered.splice(insertIdx, 0, { id } as GoalNode)
        const orderMap = new Map(reordered.map((g, i) => [g.id, i]))
        const ts = nowIso()

        return {
          goals: s.goals.map(g => {
            if (g.id === id) return { ...g, parentId: newParentId, order: orderMap.get(id) ?? 0, updatedAt: ts }
            if (orderMap.has(g.id)) return { ...g, order: orderMap.get(g.id)!, updatedAt: ts }
            return g
          }),
        }
      }),

    reorderGoal: (id, fromIdx, toIdx, parentId) =>
      mutate(s => {
        const siblings = s.goals
          .filter(g => (g.parentId ?? null) === parentId && g.status !== 'archived')
          .sort((a, b) => ((a.order ?? 0) - (b.order ?? 0)))
        if (fromIdx < 0 || toIdx < 0 || fromIdx >= siblings.length || toIdx >= siblings.length) return {}
        const reordered = [...siblings]
        const [moved] = reordered.splice(fromIdx, 1)
        reordered.splice(toIdx, 0, moved)
        const orderMap = new Map(reordered.map((g, i) => [g.id, i]))
        const ts = nowIso()
        return {
          goals: s.goals.map(g =>
            orderMap.has(g.id)
              ? { ...g, order: orderMap.get(g.id)!, updatedAt: ts }
              : g
          ),
        }
      }),

    createLink: (source, target, type) =>
      mutate(s => {
        if (source === target) return {}
        const exists = s.links.some(
          l => l.source === source && l.target === target && l.type === type,
        )
        if (exists) return {}
        return { links: [...s.links, { id: uid('l'), source, target, type }] }
      }),

    deleteLink: (id) => mutate(s => ({ links: s.links.filter(l => l.id !== id) })),

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
  }
})
