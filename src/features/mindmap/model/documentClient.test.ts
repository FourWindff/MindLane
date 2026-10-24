import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MindmapDocumentIntent } from '@contracts/mindmapDocument/state'
import type { MindmapDocumentState } from '@contracts/mindmapDocument/state'
import { createEmptyFile } from '@contracts/fileFormat'
import { createMindmapStore } from './store'
import { MindmapEditor } from './editor'
import { setDocumentTransport, type MindmapDocumentTransport } from './documentClient'
import {
  getDocumentLoopbackService,
  getDocumentLoopbackTransport,
  installDocumentLoopback,
} from './documentLoopback.testutil'

describe('renderer document seam', () => {
  let intents: MindmapDocumentIntent[]

  beforeEach(() => {
    installDocumentLoopback()
    intents = []
    const loopback = getDocumentLoopbackTransport()
    const recording: MindmapDocumentTransport = {
      send: (intent) => {
        intents.push(intent)
        return loopback.send(intent)
      },
      subscribe: (listener) => loopback.subscribe(listener),
    }
    setDocumentTransport(recording)
  })

  afterEach(() => {
    installDocumentLoopback()
  })

  function createStore() {
    const store = createMindmapStore()
    const editor = new MindmapEditor(store)
    editor.loadFile('/tmp/a.mindlane', createEmptyFile('Seam'), null)
    return { store, editor }
  }

  function applyIntents(): Array<Extract<MindmapDocumentIntent, { type: 'apply' }>> {
    return intents.filter(
      (intent): intent is Extract<MindmapDocumentIntent, { type: 'apply' }> =>
        intent.type === 'apply',
    )
  }

  it('commits text once per edit, not per keystroke, and keeps the editing flag out of the document', () => {
    const { store, editor } = createStore()
    const { nodeId } = editor.addChild('root', { label: 'Untitled' })
    intents.length = 0

    // Opening the editor and typing a draft are view-only actions: no command.
    editor.setNodeEditing(nodeId, true)
    expect(intents).toHaveLength(0)
    expect(store.getState().nodes.find((node) => node.id === nodeId)?.data.editing).toBe(true)

    // One commit = one command.
    editor.updateNodeData(nodeId, { label: 'Typed once' })

    const applies = applyIntents()
    expect(applies).toHaveLength(1)
    expect(applies[0]!.commands).toEqual([
      { type: 'updateNode', nodeId, data: { label: 'Typed once' } },
    ])
    expect(JSON.stringify(applies)).not.toContain('editing')

    const document = getDocumentLoopbackService().getDocument(store.getState().fileUuid)!
    const documentNode = document.nodes.find((node) => node.id === nodeId)!
    expect(documentNode.data.editing).toBeUndefined()
    expect(documentNode.data.label).toBe('Typed once')
    expect(store.getState().nodes.find((node) => node.id === nodeId)?.data.editing).toBe(true)
  })

  it('discards a stale version and warns, so the newer truth is never rolled back', () => {
    const { store } = createStore()
    const current = store.getState()
    const stale: MindmapDocumentState = {
      fileUuid: current.fileUuid,
      version: current.documentVersion,
      nodes: [],
      edges: [],
      structureType: 'logic',
      canUndo: false,
      canRedo: false,
      dirty: false,
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(store.getState().applyDocumentState(stale)).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('version stalled'))
    expect(store.getState().nodes.map((node) => node.id)).toEqual(['root'])
    expect(store.getState().documentVersion).toBe(current.documentVersion)

    warn.mockRestore()
  })

  it('applies a newer versioned state and projects its dirty/undo flags', () => {
    const { store } = createStore()
    const current = store.getState()
    const next: MindmapDocumentState = {
      fileUuid: current.fileUuid,
      version: current.documentVersion + 1,
      nodes: [{ id: 'x', type: 'text', position: { x: 10, y: 20 }, data: { label: 'X' } }],
      edges: [],
      structureType: 'logic',
      canUndo: true,
      canRedo: false,
      dirty: true,
    }

    expect(store.getState().applyDocumentState(next)).toBe(true)
    expect(store.getState().nodes).toHaveLength(1)
    expect(store.getState().nodes[0]!.position).toEqual({ x: 10, y: 20 })
    expect(store.getState().canUndo).toBe(true)
    expect(store.getState().dirty).toBe(true)
    expect(store.getState().documentVersion).toBe(next.version)
  })

  it('re-renders from the state while preserving transient view flags (editing stays visible)', () => {
    const { store, editor } = createStore()
    const { nodeId } = editor.addChild('root', { label: 'Old' })
    editor.setNodeEditing(nodeId, true)

    const current = store.getState()
    const renamed: MindmapDocumentState = {
      fileUuid: current.fileUuid,
      version: current.documentVersion + 1,
      nodes: current.documentNodes.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, label: 'New' } } : node,
      ),
      edges: current.documentEdges,
      structureType: 'logic',
      canUndo: current.canUndo,
      canRedo: current.canRedo,
      dirty: current.documentDirty,
    }
    expect(store.getState().applyDocumentState(renamed)).toBe(true)

    const projected = store.getState().nodes.find((node) => node.id === nodeId)!
    expect(projected.data.label).toBe('New')
    expect(projected.data.editing).toBe(true)
  })

  it('routes undo/redo through the document state instead of a renderer history', () => {
    const { store, editor } = createStore()
    const { nodeId } = editor.addChild('root', { label: 'Child' })
    intents.length = 0

    editor.undo()
    expect(store.getState().nodes.some((node) => node.id === nodeId)).toBe(false)

    editor.redo()
    expect(store.getState().nodes.some((node) => node.id === nodeId)).toBe(true)
    expect(intents.map((intent) => intent.type)).toEqual(['undo', 'redo'])
  })

  it('runs the whole round trip through the bridge: add → edit → collapse → undo/redo → serialize', () => {
    const { store, editor } = createStore()
    const { nodeId } = editor.addChild('root', { label: 'One' })
    editor.updateNodeData(nodeId, { label: 'Two' })
    editor.setNodeCollapsed(nodeId, true)

    const saved = store.getState().toMindLaneFile()
    expect(saved.mindmap.nodes.find((node) => node.id === nodeId)?.data).toMatchObject({
      label: 'Two',
      collapsed: true,
    })

    editor.undo()
    expect(
      store.getState().nodes.find((node) => node.id === nodeId)?.data.collapsed,
    ).toBeUndefined()
    editor.undo()
    expect(store.getState().nodes.find((node) => node.id === nodeId)?.data.label).toBe('One')

    editor.redo()
    editor.redo()
    const redone = store.getState().nodes.find((node) => node.id === nodeId)!
    expect(redone.data.label).toBe('Two')
    expect(redone.data.collapsed).toBe(true)
  })

  it('sends layout inputs (measured sizes) to the main process', () => {
    const { store, editor } = createStore()
    const { nodeId } = editor.addChild('root', { label: 'Child' })
    intents.length = 0

    editor.reflow({ sizes: [{ id: nodeId, width: 220, height: 60 }] })

    const layouts = intents.filter(
      (intent): intent is Extract<MindmapDocumentIntent, { type: 'layout' }> =>
        intent.type === 'layout',
    )
    expect(layouts).toHaveLength(1)
    expect(layouts[0]!.sizes).toEqual([{ id: nodeId, width: 220, height: 60 }])
    expect(layouts[0]!.structureType).toBe(store.getState().style.structureType)
  })

  it('resolves whenSettled once the command has been observed', async () => {
    const { editor } = createStore()
    editor.addChild('root', { label: 'Child' })
    await expect(editor.whenSettled()).resolves.toBeUndefined()
  })
})
