import { describe, expect, it } from 'vitest'
import {
  applyDocumentCommand,
  applyDocumentCommands,
  requiresLayoutAfter,
  shouldRecordHistory,
} from './commands'
import type { CommandFailure, MindmapCommand, MindmapDocument } from './types'

/**
 * Boundary tests for the pure command layer: old document + command → new
 * document + result envelope, plus the history/layout gates. No editor, no
 * store and no Electron involved.
 */
function baseDocument(): MindmapDocument {
  return {
    nodes: [
      { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: { label: 'Central' } },
      { id: 'a', type: 'text', position: { x: 200, y: 0 }, data: { label: 'A' } },
      { id: 'a1', type: 'text', position: { x: 400, y: 0 }, data: { label: 'A1' } },
      { id: 'b', type: 'text', position: { x: 200, y: 80 }, data: { label: 'B' } },
    ],
    edges: [
      { id: 'e-root-a', source: 'root', target: 'a', type: 'mindmap' },
      { id: 'e-a-a1', source: 'a', target: 'a1', type: 'mindmap' },
      { id: 'e-root-b', source: 'root', target: 'b', type: 'mindmap' },
    ],
  }
}

function failureOf(result: ReturnType<typeof applyDocumentCommand>): CommandFailure {
  expect(result.ok).toBe(false)
  return result as CommandFailure
}

describe('applyDocumentCommand', () => {
  it('appends a node and its parent edge without mutating the old document', () => {
    const before = baseDocument()
    const command: MindmapCommand = {
      type: 'addNode',
      node: { id: 'c', type: 'text', position: { x: 200, y: 160 }, data: { label: 'C' } },
      edge: { id: 'e-root-c', source: 'root', target: 'c', type: 'mindmap' },
    }

    const result = applyDocumentCommand(before, command)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.nodes.map((node) => node.id)).toEqual(['root', 'a', 'a1', 'b', 'c'])
    expect(result.document.edges.map((edge) => edge.id)).toContain('e-root-c')
    // Value semantics: the input document is untouched.
    expect(before.nodes).toHaveLength(4)
    expect(before.edges).toHaveLength(3)
  })

  it('rejects a duplicate node id with the existing tree_invalid code', () => {
    const result = failureOf(
      applyDocumentCommand(baseDocument(), {
        type: 'addNode',
        node: { id: 'a', type: 'text', position: { x: 0, y: 0 }, data: {} },
      }),
    )

    expect(result.code).toBe('tree_invalid')
    expect(result.message).toContain('a')
  })

  it('rejects an edge whose endpoint does not exist with block_not_found', () => {
    const result = failureOf(
      applyDocumentCommand(baseDocument(), {
        type: 'addNode',
        node: { id: 'c', type: 'text', position: { x: 0, y: 0 }, data: {} },
        edge: { id: 'e-ghost-c', source: 'ghost', target: 'c' },
      }),
    )

    expect(result.code).toBe('block_not_found')
    expect(result.message).toContain('ghost')
  })

  it('updates node data (including collapse) as a new value', () => {
    const before = baseDocument()
    const result = applyDocumentCommand(before, {
      type: 'updateNode',
      nodeId: 'a',
      patch: (node) => ({ ...node, data: { ...node.data, collapsed: true } }),
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const updated = result.document.nodes.find((node) => node.id === 'a')!
    expect(updated.data.collapsed).toBe(true)
    expect(before.nodes.find((node) => node.id === 'a')!.data.collapsed).toBeUndefined()
    expect(result.document.nodes.find((node) => node.id === 'b')).toBe(
      before.nodes.find((node) => node.id === 'b'),
    )
  })

  it('keeps an unknown update/move/remove target a no-op (historical editor semantics)', () => {
    const before = baseDocument()
    expect(
      applyDocumentCommand(before, { type: 'updateNode', nodeId: 'ghost', patch: (n) => n }),
    ).toMatchObject({ ok: true, document: before })
    expect(
      applyDocumentCommand(before, { type: 'moveNode', nodeId: 'ghost', position: { x: 1, y: 2 } }),
    ).toMatchObject({ ok: true, document: before })
    expect(applyDocumentCommand(before, { type: 'removeEdge', edgeId: 'ghost' })).toMatchObject({
      ok: true,
      document: before,
    })
  })

  it('moves a node and leaves its subtree and the old document intact', () => {
    const before = baseDocument()
    const result = applyDocumentCommand(before, {
      type: 'moveNode',
      nodeId: 'a',
      position: { x: 20, y: 30 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.nodes.find((node) => node.id === 'a')!.position).toEqual({
      x: 20,
      y: 30,
    })
    expect(result.document.nodes.find((node) => node.id === 'a1')!.position).toEqual({
      x: 400,
      y: 0,
    })
    expect(before.nodes.find((node) => node.id === 'a')!.position).toEqual({ x: 200, y: 0 })
  })

  it('deletes a subtree (nodes and every touching edge) and keeps siblings', () => {
    const result = applyDocumentCommand(baseDocument(), { type: 'deleteSubtree', rootId: 'a' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.document.nodes.map((node) => node.id)).toEqual(['root', 'b'])
    expect(result.document.edges.map((edge) => edge.id)).toEqual(['e-root-b'])
  })

  it('refuses to delete the root with tree_invalid and treats an unknown id as a no-op', () => {
    expect(
      failureOf(applyDocumentCommand(baseDocument(), { type: 'deleteSubtree', rootId: 'root' }))
        .code,
    ).toBe('tree_invalid')

    const before = baseDocument()
    const unknown = applyDocumentCommand(before, { type: 'deleteSubtree', rootId: 'ghost' })
    expect(unknown).toMatchObject({ ok: true, document: before })
  })

  it('adds an edge at the end or at an explicit index', () => {
    const edge = { id: 'e-a-b', source: 'a', target: 'b', type: 'mindmap' }
    const appended = applyDocumentCommand(baseDocument(), { type: 'addEdge', edge })
    expect(appended.ok).toBe(true)
    if (appended.ok) expect(appended.document.edges.at(-1)!.id).toBe('e-a-b')

    const inserted = applyDocumentCommand(baseDocument(), { type: 'addEdge', edge, index: 1 })
    expect(inserted.ok).toBe(true)
    if (inserted.ok) expect(inserted.document.edges.map((e) => e.id)[1]).toBe('e-a-b')
  })

  it('rejects a duplicate edge id (tree_invalid) and a dangling edge (block_not_found)', () => {
    expect(
      failureOf(
        applyDocumentCommand(baseDocument(), {
          type: 'addEdge',
          edge: { id: 'e-root-a', source: 'root', target: 'b' },
        }),
      ).code,
    ).toBe('tree_invalid')
    expect(
      failureOf(
        applyDocumentCommand(baseDocument(), {
          type: 'addEdge',
          edge: { id: 'e-x-y', source: 'x', target: 'y' },
        }),
      ).code,
    ).toBe('block_not_found')
  })

  it('applies nested batches in order and stops at the first failure', () => {
    const applied = applyDocumentCommand(baseDocument(), {
      type: 'batch',
      commands: [
        {
          type: 'addNode',
          node: { id: 'c', type: 'text', position: { x: 0, y: 0 }, data: {} },
        },
        { type: 'moveNode', nodeId: 'c', position: { x: 10, y: 10 } },
      ],
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return
    expect(applied.document.nodes.find((node) => node.id === 'c')!.position).toEqual({
      x: 10,
      y: 10,
    })

    const rejected = applyDocumentCommand(baseDocument(), {
      type: 'batch',
      commands: [
        { type: 'moveNode', nodeId: 'a', position: { x: 1, y: 1 } },
        { type: 'addEdge', edge: { id: 'e-ghost', source: 'ghost', target: 'a' } },
      ],
    })
    expect(rejected.ok).toBe(false)
  })

  it('returns invalid_type for an unknown runtime command', () => {
    const unknown = { type: 'explode' } as unknown as MindmapCommand
    expect(failureOf(applyDocumentCommand(baseDocument(), unknown)).code).toBe('invalid_type')
  })
})

describe('applyDocumentCommands', () => {
  it('carries the pure history and layout gates in the success envelope', () => {
    const addCommand: MindmapCommand = {
      type: 'addNode',
      node: { id: 'c', type: 'text', position: { x: 0, y: 0 }, data: {} },
    }
    const moveCommand: MindmapCommand = {
      type: 'moveNode',
      nodeId: 'a',
      position: { x: 1, y: 1 },
    }

    expect(applyDocumentCommands(baseDocument(), [])).toMatchObject({
      ok: true,
      recordHistory: false,
      reflow: false,
    })
    expect(applyDocumentCommands(baseDocument(), [addCommand])).toMatchObject({
      ok: true,
      recordHistory: true,
      reflow: true,
    })
    expect(applyDocumentCommands(baseDocument(), [moveCommand])).toMatchObject({
      ok: true,
      recordHistory: true,
      reflow: false,
    })
    expect(
      applyDocumentCommands(baseDocument(), [{ type: 'removeEdge', edgeId: 'e-root-b' }]),
    ).toMatchObject({ ok: true, reflow: true })
  })

  it('is atomic on failure: the old document is returned untouched', () => {
    const before = baseDocument()
    const result = applyDocumentCommands(before, [
      { type: 'moveNode', nodeId: 'a', position: { x: 1, y: 1 } },
      { type: 'addEdge', edge: { id: 'e-ghost', source: 'ghost', target: 'a' } },
    ])

    expect(result.ok).toBe(false)
    expect(before.nodes.find((node) => node.id === 'a')!.position).toEqual({ x: 200, y: 0 })
  })
})

describe('command gates', () => {
  it('records every non-empty batch and skips the empty one', () => {
    expect(shouldRecordHistory([])).toBe(false)
    expect(shouldRecordHistory([{ type: 'moveNode', nodeId: 'a', position: { x: 0, y: 0 } }])).toBe(
      true,
    )
  })

  it('requires layout for structural/data changes but not for pure moves, including nested batches', () => {
    const move: MindmapCommand = { type: 'moveNode', nodeId: 'a', position: { x: 0, y: 0 } }
    expect(requiresLayoutAfter([move])).toBe(false)
    expect(requiresLayoutAfter([{ type: 'batch', commands: [move] }])).toBe(false)
    expect(
      requiresLayoutAfter([
        { type: 'batch', commands: [move, { type: 'removeEdge', edgeId: 'e-root-b' }] },
      ]),
    ).toBe(true)
    expect(requiresLayoutAfter([{ type: 'updateNode', nodeId: 'a', patch: (node) => node }])).toBe(
      true,
    )
  })
})
