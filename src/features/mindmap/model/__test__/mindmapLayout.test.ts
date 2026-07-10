import { describe, expect, it } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { mindmapLayout } from '../mindmapLayout'

describe('mindmapLayout', () => {
  it('lays out imported nodes through the initial layout adapter', () => {
    const nodes: Node[] = [
      { id: 'root', position: { x: 99, y: 99 }, data: {} },
      { id: 'child', position: { x: 99, y: 99 }, data: {} },
    ]
    const edges: Edge[] = [{ id: 'root-child', source: 'root', target: 'child' }]

    const result = mindmapLayout.initial(nodes, edges, { rootX: 10, rootY: 20 })
    const root = result.find((node) => node.id === 'root')!
    const child = result.find((node) => node.id === 'child')!

    expect(root.position).toEqual({ x: 10, y: 20 })
    expect(child.position.x).toBeGreaterThan(root.position.x)
    expect(child.position.y).toBe(root.position.y)
  })

  it('reflows a forest through the incremental tree adapter', () => {
    const nodes: Node[] = [
      { id: 'root', position: { x: 0, y: 0 }, data: {} },
      { id: 'a', position: { x: 0, y: 0 }, data: {} },
      { id: 'b', position: { x: 0, y: 0 }, data: {} },
    ]
    const edges: Edge[] = [
      { id: 'root-a', source: 'root', target: 'a' },
      { id: 'root-b', source: 'root', target: 'b' },
    ]

    const result = mindmapLayout.reflow(nodes, edges, 'logic')

    expect(result.find((node) => node.id === 'a')?.position).toEqual({ x: 260, y: -32 })
    expect(result.find((node) => node.id === 'b')?.position).toEqual({ x: 260, y: 32 })
  })
})
