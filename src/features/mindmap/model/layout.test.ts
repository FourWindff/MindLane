import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { getChildIdsOrdered } from '@contracts/mindmapDocument/tree'
import { layoutInitial, layoutReflow } from './layout'

describe('layout', () => {
  it('lays out imported nodes through the initial layout', () => {
    const nodes: Node[] = [
      { id: 'root', position: { x: 99, y: 99 }, data: {} },
      { id: 'child', position: { x: 99, y: 99 }, data: {} },
    ]
    const edges: Edge[] = [{ id: 'root-child', source: 'root', target: 'child' }]

    const result = layoutInitial(nodes, edges)
    const root = result.find((node) => node.id === 'root')!
    const child = result.find((node) => node.id === 'child')!

    expect(root.position).toEqual({ x: 0, y: 0 })
    expect(child.position.x).toBeGreaterThan(root.position.x)
    expect(child.position.y).toBe(root.position.y)
  })

  it('reflows a forest through the incremental tree layout', () => {
    const nodes: Node[] = [
      { id: 'root', position: { x: 0, y: 0 }, data: {} },
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'root-a', source: 'root', target: 'a' },
      { id: 'root-b', source: 'root', target: 'b' },
    ]

    const result = layoutReflow(nodes, edges, 'logic')

    expect(result.find((node) => node.id === 'a')?.position).toEqual({ x: 200, y: -26 })
    expect(result.find((node) => node.id === 'b')?.position).toEqual({ x: 200, y: 26 })
  })

  it('orders siblings by y ascending, so above/below insertions land in the visual slot', () => {
    const nodes: Node[] = [
      { id: 'root', position: { x: 0, y: 0 }, data: {} },
      { id: 'a', position: { x: 200, y: 0 }, data: {} },
      { id: 'above-b', position: { x: 200, y: 88 }, data: {} },
      { id: 'b', position: { x: 200, y: 100 }, data: {} },
      { id: 'below-b', position: { x: 200, y: 152 }, data: {} },
    ]
    const edges: Edge[] = nodes
      .slice(1)
      .map((node) => ({ id: `root-${node.id}`, source: 'root', target: node.id }))

    const result = layoutReflow(nodes, edges, 'logic')

    // The layout's sibling order is the visual order (y ascending), and the
    // same order survives the reflow that assigns the final coordinates.
    expect(getChildIdsOrdered(nodes, edges, 'root')).toEqual(['a', 'above-b', 'b', 'below-b'])
    expect(getChildIdsOrdered(result, edges, 'root')).toEqual(['a', 'above-b', 'b', 'below-b'])
    const ys = getChildIdsOrdered(result, edges, 'root').map(
      (id) => result.find((node) => node.id === id)!.position.y,
    )
    expect([...ys].sort((left, right) => left - right)).toEqual(ys)
  })
})
