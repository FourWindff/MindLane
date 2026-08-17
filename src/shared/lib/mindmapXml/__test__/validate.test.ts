import { describe, it, expect } from 'vitest'
import type { Edge, Node } from '@xyflow/react'
import { parseXmlFragment } from '../deserializer'
import { validateFragmentForInsert, validateMove, buildValidationContext } from '../validate'

function makeNode(id: string, label = id): Node {
  return { id, type: 'text', position: { x: 0, y: 0 }, data: { label } }
}

describe('validateFragmentForInsert', () => {
  it('rejects fragment ids that collide with existing nodes (tree_invalid)', async () => {
    const fragment = await parseXmlFragment(
      `<node id="n1" type="text" content="a" /><node type="text" content="b" />`,
    )
    const { ctx } = buildValidationContext([makeNode('root'), makeNode('n1')], [], [])
    expect(() => validateFragmentForInsert(fragment, ctx)).toThrowError(
      expect.objectContaining({ code: 'tree_invalid' }),
    )
  })

  it('accepts fresh ids and mints', async () => {
    const fragment = await parseXmlFragment(
      `<node type="text" content="a" /><node type="text" content="b" />`,
    )
    const { ctx } = buildValidationContext([makeNode('root')], [], [])
    expect(() => validateFragmentForInsert(fragment, ctx)).not.toThrow()
  })

  it('rejects missing asset references (asset_not_found)', async () => {
    const fragment = await parseXmlFragment(`<node type="image" asset="a1" />`)
    const { ctx } = buildValidationContext([makeNode('root')], [], [])
    expect(() => validateFragmentForInsert(fragment, ctx)).toThrowError(
      expect.objectContaining({ code: 'asset_not_found' }),
    )
  })

  it('accepts asset references present in editor', async () => {
    const fragment = await parseXmlFragment(`<node type="image" asset="a1" />`)
    const { ctx } = buildValidationContext([makeNode('root')], [], [{ id: 'a1' }])
    expect(() => validateFragmentForInsert(fragment, ctx)).not.toThrow()
  })

  it('allows excluded ids (updateMindmapNode replaces its own subtree)', async () => {
    const fragment = await parseXmlFragment(
      `<node id="n1" type="text" content="new"><node id="n2" type="text" content="child" /></node>`,
    )
    const { ctx } = buildValidationContext(
      [makeNode('root'), makeNode('n1'), makeNode('n2')],
      [],
      [],
    )
    expect(() => validateFragmentForInsert(fragment, ctx, new Set(['n1', 'n2']))).not.toThrow()
  })
})

describe('validateMove', () => {
  const nodes = [makeNode('root'), makeNode('a'), makeNode('b'), makeNode('c')]
  const edges: Edge[] = [
    { id: 'e1', source: 'root', target: 'a', type: 'mindmap' },
    { id: 'e2', source: 'a', target: 'b', type: 'mindmap' },
  ]
  const { ctx, childrenOf } = buildValidationContext(nodes, edges, [])

  it('rejects moving root (tree_invalid)', () => {
    expect(() => validateMove('root', 'a', { nodeIds: ctx.nodeIds, childrenOf })).toThrowError(
      expect.objectContaining({ code: 'tree_invalid' }),
    )
  })

  it('rejects unknown node/target (block_not_found)', () => {
    expect(() => validateMove('ghost', 'a', { nodeIds: ctx.nodeIds, childrenOf })).toThrowError(
      expect.objectContaining({ code: 'block_not_found' }),
    )
    expect(() => validateMove('a', 'ghost', { nodeIds: ctx.nodeIds, childrenOf })).toThrowError(
      expect.objectContaining({ code: 'block_not_found' }),
    )
  })

  it('rejects moving into own subtree (cycle → tree_invalid)', () => {
    expect(() => validateMove('a', 'b', { nodeIds: ctx.nodeIds, childrenOf })).toThrowError(
      expect.objectContaining({ code: 'tree_invalid' }),
    )
  })

  it('accepts valid moves', () => {
    expect(() => validateMove('b', 'root', { nodeIds: ctx.nodeIds, childrenOf })).not.toThrow()
    expect(() => validateMove('b', 'c', { nodeIds: ctx.nodeIds, childrenOf })).not.toThrow()
  })
})
