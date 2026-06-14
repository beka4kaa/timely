import type { GoalNode, GoalLink, GraphData } from '@/types/goals'
import { calculateGoalProgress } from './calculateProgress'

// Obsidian-like sizing: every node is essentially the same size, with only a
// gentle bump for well-connected nodes (hubs). Colour — not size — carries type.
const BASE_RADIUS = 4
const DEGREE_BOOST = 0.9     // px per sqrt(connections)
const MAX_RADIUS = 8

/**
 * Build force-graph data from the store. Hierarchy (parentId) becomes
 * implicit parent_child links so the tree structure is visible in the graph,
 * then explicit GoalLinks are layered on top.
 */
export function buildGraphData(goals: GoalNode[], links: GoalLink[]): GraphData {
  const progressCache = new Map<string, number>()

  const active = goals.filter(g => g.status !== 'archived')
  const nodeIds = new Set(active.map(g => g.id))

  // Implicit hierarchy edges.
  const hierarchyLinks = goals
    .filter(g => g.parentId && nodeIds.has(g.parentId) && nodeIds.has(g.id))
    .map(g => ({
      source: g.parentId as string,
      target: g.id,
      type: 'parent_child' as const,
    }))

  // Explicit dependency edges (skip any pointing at archived/missing nodes).
  const explicitLinks = links
    .filter(l => nodeIds.has(l.source) && nodeIds.has(l.target))
    .map(l => ({ source: l.source, target: l.target, type: l.type }))

  // Connection degree per node (hierarchy + explicit) → Obsidian-like sizing.
  const degree = new Map<string, number>()
  for (const l of [...hierarchyLinks, ...explicitLinks]) {
    degree.set(l.source, (degree.get(l.source) ?? 0) + 1)
    degree.set(l.target, (degree.get(l.target) ?? 0) + 1)
  }

  const nodes = active.map(g => ({
    id: g.id,
    title: g.title,
    type: g.type,
    status: g.status,
    progress: calculateGoalProgress(g.id, goals, progressCache),
    val: Math.min(MAX_RADIUS, BASE_RADIUS + DEGREE_BOOST * Math.sqrt(degree.get(g.id) ?? 0)),
  }))

  return { nodes, links: [...hierarchyLinks, ...explicitLinks] }
}

/**
 * Set of node ids within `depth` hops of `rootId` across hierarchy + links
 * (undirected). Used for Focus Mode and selection highlighting.
 */
export function getNeighborhood(
  rootId: string,
  goals: GoalNode[],
  links: GoalLink[],
  depth = 1,
): Set<string> {
  // Build undirected adjacency from hierarchy + explicit links.
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    if (!adj.has(a)) adj.set(a, new Set())
    adj.get(a)!.add(b)
  }
  for (const g of goals) {
    if (g.parentId) { add(g.id, g.parentId); add(g.parentId, g.id) }
  }
  for (const l of links) { add(l.source, l.target); add(l.target, l.source) }

  const visited = new Set<string>([rootId])
  let frontier = [rootId]
  for (let d = 0; d < depth; d++) {
    const next: string[] = []
    for (const id of frontier) {
      const neighbors = adj.get(id)
      if (neighbors) neighbors.forEach(nb => {
        if (!visited.has(nb)) { visited.add(nb); next.push(nb) }
      })
    }
    frontier = next
  }
  return visited
}
