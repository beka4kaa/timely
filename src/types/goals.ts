/**
 * goals.ts — data model for the "Карта целей" (Goal Operating System).
 *
 * Two independent relationship layers:
 *   • parentId       → hierarchy (Tree view)
 *   • GoalLink[]     → dependencies (Graph view)
 * A goal has at most one parent, but may depend on / be blocked by many goals.
 */

export type GoalType =
  | 'global_goal'
  | 'goal'
  | 'subgoal'
  | 'milestone'
  | 'task'
  | 'habit'
  | 'financial_goal'

export type GoalStatus =
  | 'not_started'
  | 'active'
  | 'on_track'
  | 'at_risk'
  | 'blocked'
  | 'done'
  | 'archived'

export type GoalPriority = 'low' | 'medium' | 'high' | 'critical'

export type Currency = 'USD' | 'EUR' | 'RUB' | 'KZT'

export interface GoalNode {
  id: string
  title: string
  description?: string

  type: GoalType
  status: GoalStatus

  /** Hierarchy: id of the parent goal (null/undefined = top level). */
  parentId?: string | null

  /** Temporal scope of this goal (determines which view level it belongs to). */
  planningScale?: TimeScale

  /** Planning period. month example: "2026-07". */
  month?: string
  quarter?: string
  year?: number

  /** Calendar scheduling (all "YYYY-MM-DD"). `time` is optional "HH:mm". */
  startDate?: string
  endDate?: string
  dueDate?: string
  time?: string

  /** 0–100. For goals with children this is auto-derived; otherwise manual. */
  progress?: number
  priority?: GoalPriority

  /** Manual sort order within siblings (ascending). */
  order?: number

  /** Financial goals only. */
  targetAmount?: number
  currentAmount?: number
  currency?: Currency

  deadline?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

export type GoalLinkType =
  | 'parent_child'
  | 'depends_on'
  | 'blocks'
  | 'supports'
  | 'related_to'

export interface GoalLink {
  id: string
  source: string
  target: string
  type: GoalLinkType
  strength?: number
}

export type GoalView = 'plan' | 'graph'

export type TimeScale = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'multi_year'
/** @deprecated use TimeScale */
export type TimeRange = TimeScale

export interface DateRange {
  start: string | null
  end: string | null
}

export interface GoalFilters {
  status: GoalStatus[]
  type: GoalType[]
  month: string | null
  priority: GoalPriority[]
}

/** Shape the force-graph consumes (derived from goals + links). */
export interface GraphDataNode {
  id: string
  title: string
  type: GoalType
  status: GoalStatus
  progress: number
  /** rendered circle radius, by type */
  val: number
}

export interface GraphDataLink {
  source: string
  target: string
  type: GoalLinkType
}

export interface GraphData {
  nodes: GraphDataNode[]
  links: GraphDataLink[]
}
