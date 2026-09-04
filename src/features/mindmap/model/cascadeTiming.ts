import type { Edge, Node } from '@xyflow/react'
import { getChildIdsOrdered } from '@/shared/lib/mindmapTree'

/**
 * Pure cascade-timing math for agent write fragments (model layer, unit-testable
 * in node).
 *
 * - Enter: DFS pre-order (parent before child, siblings in layout order), each
 *   root subtree counting independently from 0.
 * - Exit: reverse pre-order (children before parent, leaves exit earliest).
 * - Tick = min(fixed tick, budget / node count): large trees compress to stay
 *   under the total budget, a single node always gets 0ms delay (identical
 *   entrance feel to a manual `addNode`).
 */

/** Fixed tick: the stagger step between consecutive nodes. */
export const CASCADE_BASE_TICK_MS = 100
/** Enter budget cap: the last node's delay of a large fragment never exceeds it. */
export const CASCADE_ENTER_BUDGET_MS = 2000
/** Exit budget cap (the reverse cascade is compressed the same way). */
export const CASCADE_EXIT_BUDGET_MS = 1000

/**
 * One DFS pre-order sequence per root subtree: parent before child, siblings in
 * layout (y) order. Ordering only depends on relative positions, never on the
 * global offset.
 */
function dfsPreOrderSequences(roots: string[], nodes: Node[], edges: Edge[]): string[][] {
  return roots.map((root) => {
    const seq: string[] = []
    const stack = [root]
    while (stack.length > 0) {
      const id = stack.pop()!
      seq.push(id)
      const children = getChildIdsOrdered(nodes, edges, id)
      // Push reversed so the topmost child pops first (ascending y traversal)
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
    }
    return seq
  })
}

function compressTick(count: number, budgetMs: number): number {
  return Math.min(CASCADE_BASE_TICK_MS, budgetMs / Math.max(1, count))
}

/**
 * Enter delays: the i-th DFS pre-order node gets i × tick (each root subtree
 * counts independently). Returns node id → delay ms; multi-root fragments do
 * not constrain each other.
 */
export function computeEnterDelays(
  roots: string[],
  nodes: Node[],
  edges: Edge[],
): Map<string, number> {
  const delays = new Map<string, number>()
  for (const seq of dfsPreOrderSequences(roots, nodes, edges)) {
    const tick = compressTick(seq.length, CASCADE_ENTER_BUDGET_MS)
    seq.forEach((id, i) => delays.set(id, Math.round(i * tick)))
  }
  return delays
}

/**
 * Exit delays: reverse of the pre-order (reverse cascade). The later a node
 * entered, the earlier it exits; leaves exit before their parent; each root
 * subtree counts independently.
 */
export function computeExitDelays(
  roots: string[],
  nodes: Node[],
  edges: Edge[],
): Map<string, number> {
  const delays = new Map<string, number>()
  for (const seq of dfsPreOrderSequences(roots, nodes, edges)) {
    const tick = compressTick(seq.length, CASCADE_EXIT_BUDGET_MS)
    const last = seq.length - 1
    seq.forEach((id, i) => delays.set(id, Math.round((last - i) * tick)))
  }
  return delays
}

/** Total exit cascade duration: delay of the last node to start exiting + one node's exit animation. */
export function totalExitDuration(delays: Map<string, number>, nodeExitMs: number): number {
  let maxDelay = 0
  for (const d of delays.values()) maxDelay = Math.max(maxDelay, d)
  return maxDelay + nodeExitMs
}
