import { describe, expect, it } from 'vitest'
import { MindmapDocumentService } from './documentService.js'
import { createInitialDocument } from '../../../contracts/mindmapDocument/initial.js'
import type { MindmapDocumentState } from '../../../contracts/mindmapDocument/state.js'
import type { MindmapWireCommand } from '../../../contracts/mindmapDocument/wire.js'
import type { MindmapDocumentCommandResult } from '../../../contracts/mindmapDocument/state.js'

const FILE = 'file-1'

function open(service: MindmapDocumentService, fileUuid = FILE): MindmapDocumentState {
  const result = service.handle({
    type: 'open',
    fileUuid,
    document: createInitialDocument(),
    structureType: 'logic',
  })
  return stateOf(result)
}

function stateOf(result: MindmapDocumentCommandResult): MindmapDocumentState {
  if (!result.ok || !result.state) {
    throw new Error(`expected a state, got ${JSON.stringify(result)}`)
  }
  return result.state
}

function addChild(id: string, data: Record<string, unknown> = {}): MindmapWireCommand {
  return {
    type: 'addNode',
    node: { id, type: 'text', position: { x: 0, y: 0 }, data: { label: id, ...data } },
    edge: { id: `e-root-${id}`, source: 'root', target: id, type: 'mindmap' },
  }
}

function apply(service: MindmapDocumentService, commands: MindmapWireCommand[], uuid = FILE) {
  return service.handle({ type: 'apply', fileUuid: uuid, commands })
}

describe('MindmapDocumentService', () => {
  it('opens with a laid-out document, version 0 and clean', () => {
    const service = new MindmapDocumentService()
    const opened = open(service)

    expect(opened.version).toBe(0)
    expect(opened.dirty).toBe(false)
    expect(opened.canUndo).toBe(false)
    expect(opened.nodes.map((node) => node.id)).toEqual(['root'])
  })

  it('runs the deterministic layout in the main process and ships positions with the state', () => {
    const service = new MindmapDocumentService()
    const opened = open(service)
    const root = opened.nodes[0]!

    const state = stateOf(apply(service, [addChild('a')]))
    const child = state.nodes.find((node) => node.id === 'a')!

    expect(child.position.x).toBeGreaterThan(root.position.x)
    expect(state.version).toBe(1)
    expect(state.dirty).toBe(true)
    expect(state.canUndo).toBe(true)
  })

  it('uses one apply path for every caller: the state carries no origin', () => {
    const service = new MindmapDocumentService()
    open(service)
    const state = stateOf(apply(service, [addChild('a')]))

    // Nothing in the versioned state records who issued the command.
    expect(Object.keys(state).sort()).toEqual([
      'canRedo',
      'canUndo',
      'dirty',
      'edges',
      'fileUuid',
      'nodes',
      'structureType',
      'version',
    ])
  })

  it('keeps the per-file history capped at 10 and undoes/redoes through the same state channel', () => {
    const service = new MindmapDocumentService()
    open(service)
    for (let i = 0; i < 12; i += 1) {
      expect(apply(service, [addChild(`n${i}`)]).ok).toBe(true)
    }

    for (let i = 0; i < 10; i += 1) {
      expect(service.handle({ type: 'undo', fileUuid: FILE }).ok).toBe(true)
    }
    const afterUndo = stateOf(service.handle({ type: 'undo', fileUuid: FILE }))
    expect(afterUndo.nodes).toHaveLength(3)
    expect(afterUndo.canUndo).toBe(false)
    expect(afterUndo.canRedo).toBe(true)

    const redone = stateOf(service.handle({ type: 'redo', fileUuid: FILE }))
    expect(redone.nodes).toHaveLength(4)
    expect(redone.canRedo).toBe(true)
  })

  it('undo covers commands issued by any writer (the AI write path shares apply)', () => {
    const service = new MindmapDocumentService()
    open(service)
    // Simulated AI tool landing: same apply intent, no special channel.
    apply(service, [addChild('ai-node')])
    expect(stateOf(service.handle({ type: 'undo', fileUuid: FILE })).nodes).toHaveLength(1)
    expect(stateOf(service.handle({ type: 'redo', fileUuid: FILE })).nodes).toHaveLength(2)
  })

  it('returns the existing failure envelope and leaves the document untouched', () => {
    const service = new MindmapDocumentService()
    const opened = open(service)
    const failure = apply(service, [
      {
        type: 'addNode',
        node: { id: 'root', type: 'text', position: { x: 0, y: 0 }, data: {} },
      },
    ])

    expect(failure.ok).toBe(false)
    if (failure.ok) throw new Error('expected failure')
    expect(failure.code).toBe('tree_invalid')
    expect(service.getState(FILE)?.version).toBe(opened.version)
  })

  it('keeps the instance (and its history) alive when the same file is opened again', () => {
    const service = new MindmapDocumentService()
    open(service)
    apply(service, [addChild('a')])

    // Switching away and back must not rebuild the document.
    open(service, 'other-file')
    const reopened = open(service)

    expect(reopened.version).toBe(1)
    expect(reopened.canUndo).toBe(true)
    expect(reopened.nodes.some((node) => node.id === 'a')).toBe(true)
  })

  it('strips view-only node flags from history snapshots', () => {
    const service = new MindmapDocumentService()
    open(service)
    apply(service, [addChild('a', { justAdded: true, cascadeDelay: 120 })])
    apply(service, [{ type: 'moveNode', nodeId: 'a', position: { x: 200, y: 40 } }])

    const undone = stateOf(service.handle({ type: 'undo', fileUuid: FILE }))
    const restored = undone.nodes.find((node) => node.id === 'a')!
    expect(restored.data.justAdded).toBeUndefined()
    expect(restored.data.cascadeDelay).toBeUndefined()
  })

  it('recomputes layout from measured sizes without touching history or the dirty flag', () => {
    const service = new MindmapDocumentService()
    open(service)
    apply(service, [addChild('a')])

    const resized = stateOf(
      service.handle({
        type: 'layout',
        fileUuid: FILE,
        sizes: [{ id: 'root', width: 400, height: 80 }],
      }),
    )
    const child = resized.nodes.find((node) => node.id === 'a')!
    expect(child.position.x).toBeGreaterThan(200)

    const undone = stateOf(service.handle({ type: 'undo', fileUuid: FILE }))
    expect(undone.nodes).toHaveLength(1)
    expect(resized.canUndo).toBe(true)
  })

  it('markSaved only clears a matching version (save guard)', () => {
    const service = new MindmapDocumentService()
    open(service)
    const saved = stateOf(apply(service, [addChild('a')]))
    expect(saved.dirty).toBe(true)

    const changedWhileSaving = stateOf(apply(service, [addChild('b')]))
    const guarded = stateOf(
      service.handle({ type: 'markSaved', fileUuid: FILE, version: saved.version }),
    )
    expect(changedWhileSaving.dirty).toBe(true)
    expect(guarded.dirty).toBe(true)

    const clean = stateOf(
      service.handle({ type: 'markSaved', fileUuid: FILE, version: guarded.version }),
    )
    expect(clean.dirty).toBe(false)
  })

  it('resets to the blank document and clears history', () => {
    const service = new MindmapDocumentService()
    open(service)
    apply(service, [addChild('a')])

    const reset = stateOf(service.handle({ type: 'reset', fileUuid: FILE }))
    expect(reset.nodes.map((node) => node.id)).toEqual(['root'])
    expect(reset.canUndo).toBe(false)
    expect(reset.dirty).toBe(true)
  })

  it('reports an unknown document instead of silently applying', () => {
    const service = new MindmapDocumentService()
    const result = service.handle({ type: 'apply', fileUuid: 'missing', commands: [] })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.code).toBe('document_not_found')
  })
})
