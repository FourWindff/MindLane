import { describe, expect, it } from 'vitest'
import { getChildIdsOrdered } from './tree.js'
import { layoutInitial, layoutReflow } from './layout.js'
import type { MindmapDocumentEdge, MindmapDocumentNode } from './types.js'

function node(id: string, x = 0, y = 0): MindmapDocumentNode {
  return { id, type: 'text', position: { x, y }, data: { label: id } }
}

describe('document layout', () => {
  it('lays out imported nodes through the initial layout', () => {
    const nodes: MindmapDocumentNode[] = [node('root', 99, 99), node('child', 99, 99)]
    const edges: MindmapDocumentEdge[] = [{ id: 'root-child', source: 'root', target: 'child' }]

    const result = layoutInitial(nodes, edges)
    const root = result.find((entry) => entry.id === 'root')!
    const child = result.find((entry) => entry.id === 'child')!

    expect(root.position).toEqual({ x: 0, y: 0 })
    expect(child.position.x).toBeGreaterThan(root.position.x)
    expect(child.position.y).toBe(root.position.y)
  })

  it('reflows a forest through the incremental tree layout', () => {
    const nodes: MindmapDocumentNode[] = [node('root'), node('a'), node('b')]
    const edges: MindmapDocumentEdge[] = [
      { id: 'root-a', source: 'root', target: 'a' },
      { id: 'root-b', source: 'root', target: 'b' },
    ]

    const result = layoutReflow(nodes, edges, 'logic')

    expect(result.find((entry) => entry.id === 'a')?.position).toEqual({ x: 200, y: -26 })
    expect(result.find((entry) => entry.id === 'b')?.position).toEqual({ x: 200, y: 26 })
  })

  it('orders siblings by y ascending, so above/below insertions land in the visual slot', () => {
    const nodes: MindmapDocumentNode[] = [
      node('root'),
      node('a', 200, 0),
      node('above-b', 200, 88),
      node('b', 200, 100),
      node('below-b', 200, 152),
    ]
    const edges: MindmapDocumentEdge[] = nodes
      .slice(1)
      .map((entry) => ({ id: `root-${entry.id}`, source: 'root', target: entry.id }))

    const result = layoutReflow(nodes, edges, 'logic')

    // The layout's sibling order is the visual order (y ascending), and the
    // same order survives the reflow that assigns the final coordinates.
    expect(getChildIdsOrdered(nodes, edges, 'root')).toEqual(['a', 'above-b', 'b', 'below-b'])
    expect(getChildIdsOrdered(result, edges, 'root')).toEqual(['a', 'above-b', 'b', 'below-b'])
    const ys = getChildIdsOrdered(result, edges, 'root').map(
      (id) => result.find((entry) => entry.id === id)!.position.y,
    )
    expect([...ys].sort((left, right) => left - right)).toEqual(ys)
  })

  it('uses measured sizes when the renderer reports them', () => {
    const nodes: MindmapDocumentNode[] = [
      { ...node('root'), measured: { width: 400, height: 80 } },
      node('a'),
    ]
    const edges: MindmapDocumentEdge[] = [{ id: 'root-a', source: 'root', target: 'a' }]

    const result = layoutReflow(nodes, edges, 'logic')

    // childX = root.x + measured width + (CHILD_OFFSET_X - default width)
    expect(result.find((entry) => entry.id === 'a')?.position.x).toBe(440)
  })
})
