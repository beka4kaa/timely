import type { GoalNode, GoalLink, GoalStatus } from '@/types/goals'

/**
 * Recursively compute a goal's progress (0–100).
 *  - task:           done → 100, else 0
 *  - financial_goal: currentAmount / targetAmount
 *  - has children:   average of children's progress
 *  - leaf w/ manual: use stored progress
 *
 * Architected to be extended (weighting, milestone gating) later.
 */
export function calculateGoalProgress(
  goalId: string,
  goals: GoalNode[],
  cache: Map<string, number> = new Map(),
): number {
  if (cache.has(goalId)) return cache.get(goalId)!

  const goal = goals.find(g => g.id === goalId)
  if (!goal) return 0

  let result: number

  if (goal.type === 'task') {
    result = goal.status === 'done' ? 100 : (goal.progress ?? 0)
  } else if (goal.type === 'financial_goal') {
    const target = goal.targetAmount ?? 0
    result = target > 0 ? Math.min(100, ((goal.currentAmount ?? 0) / target) * 100) : 0
  } else {
    const children = goals.filter(g => g.parentId === goalId)
    if (children.length > 0) {
      const sum = children.reduce(
        (acc, c) => acc + calculateGoalProgress(c.id, goals, cache),
        0,
      )
      result = sum / children.length
    } else {
      result = goal.progress ?? 0
    }
  }

  result = Math.round(result)
  cache.set(goalId, result)
  return result
}

/** Goals that block the given goal and are not yet done. */
export function getActiveBlockers(
  goalId: string,
  goals: GoalNode[],
  links: GoalLink[],
): GoalNode[] {
  // A "blocks" link source→target means source blocks target.
  const blockerIds = links
    .filter(l => l.type === 'blocks' && l.target === goalId)
    .map(l => l.source)
  // "depends_on" source→target means source depends on target → target must finish first.
  const depIds = links
    .filter(l => l.type === 'depends_on' && l.source === goalId)
    .map(l => l.target)

  const ids = new Set([...blockerIds, ...depIds])
  return goals.filter(g => ids.has(g.id) && g.status !== 'done')
}

/**
 * Derive status from progress + blockers + deadline proximity.
 * Manual non-derivable statuses (archived) are preserved.
 */
export function deriveStatus(
  goal: GoalNode,
  progress: number,
  goals: GoalNode[],
  links: GoalLink[],
): GoalStatus {
  if (goal.status === 'archived') return 'archived'
  if (progress >= 100) return 'done'

  if (getActiveBlockers(goal.id, goals, links).length > 0) return 'blocked'

  if (goal.deadline) {
    const daysLeft = (new Date(goal.deadline).getTime() - Date.now()) / 86_400_000
    if (daysLeft >= 0 && daysLeft < 30 && progress < 50) return 'at_risk'
  }

  if (progress === 0) return goal.status === 'active' ? 'active' : 'not_started'
  return progress >= 60 ? 'on_track' : 'active'
}
