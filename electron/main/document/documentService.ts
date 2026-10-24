/**
 * The mindmap document service: the main process' one writable owner of a
 * mindmap document.
 *
 * It owns the document value, the per-file undo/redo stack, the version counter
 * and the dirty flag; it runs the deterministic layout after structural
 * changes. Human edits and AI write tools call the same `apply` path, so the
 * origin of a change cannot be told apart afterwards.
 *
 * No DOM, no Electron: every rule in here is unit-testable as a plain value
 * transformation over a versioned state.
 */

import { applyDocumentCommands } from '../../../contracts/mindmapDocument/commands.js'
import { createInitialDocument } from '../../../contracts/mindmapDocument/initial.js'
import { layoutReflow } from '../../../contracts/mindmapDocument/layout.js'
import { stripTransientNodeDataFrom } from '../../../contracts/mindmapDocument/types.js'
import type {
  MindmapDocument,
  MindmapDocumentEdge,
  MindmapDocumentNode,
  MindmapSnapshot,
  MindmapStructureType,
} from '../../../contracts/mindmapDocument/types.js'
import { toMindmapCommands } from '../../../contracts/mindmapDocument/wire.js'
import type {
  MindmapDocumentCommandResult,
  MindmapDocumentIntent,
  MindmapDocumentState,
  MindmapNodeSizeUpdate,
} from '../../../contracts/mindmapDocument/state.js'
import { DocumentHistory } from './history.js'

interface DocumentInstance {
  fileUuid: string
  document: MindmapDocument
  history: DocumentHistory
  version: number
  dirty: boolean
  structureType: MindmapStructureType
}

type StateListener = (state: MindmapDocumentState) => void

/** Strip enter/exit animation classes from edges (history snapshots must not carry them). */
function stripEdgeAnimationClasses(edges: MindmapDocumentEdge[]): MindmapDocumentEdge[] {
  return edges.map((edge) => {
    if (!edge.className?.includes('mindmap-edge--')) return edge
    const classes = edge.className
      .split(/\s+/)
      .filter((name) => name !== 'mindmap-edge--exiting' && name !== 'mindmap-edge--enter')
      .join(' ')
    return { ...edge, className: classes || undefined }
  })
}

function snapshotOf(document: MindmapDocument): MindmapSnapshot {
  return {
    nodes: stripTransientNodeDataFrom(document.nodes),
    edges: stripEdgeAnimationClasses(document.edges),
  }
}

function sameSize(node: MindmapDocumentNode, size: MindmapNodeSizeUpdate): boolean {
  return node.measured?.width === size.width && node.measured?.height === size.height
}

export class MindmapDocumentService {
  private instances = new Map<string, DocumentInstance>()
  private listeners = new Set<StateListener>()

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Current state of one open document (null when the file is not open). */
  getState(fileUuid: string): MindmapDocumentState | null {
    const instance = this.instances.get(fileUuid)
    return instance ? this.toState(instance) : null
  }

  /** The authoritative document value of one open file (AI tools read from here later). */
  getDocument(fileUuid: string): MindmapDocument | null {
    return this.instances.get(fileUuid)?.document ?? null
  }

  /**
   * Handle one intent. Every intent that changes the document bumps the
   * version and emits a new state; read-only or no-op intents emit nothing.
   */
  handle(intent: MindmapDocumentIntent): MindmapDocumentCommandResult {
    switch (intent.type) {
      case 'open':
        return this.open(intent)
      case 'apply':
        return this.apply(intent.fileUuid, intent.commands)
      case 'undo':
        return this.undo(intent.fileUuid)
      case 'redo':
        return this.redo(intent.fileUuid)
      case 'layout':
        return this.layout(intent.fileUuid, intent.structureType, intent.sizes)
      case 'markSaved':
        return this.markSaved(intent.fileUuid, intent.version)
      case 'reset':
        return this.reset(intent.fileUuid)
      case 'close':
        this.instances.delete(intent.fileUuid)
        return { ok: true, state: null }
      default: {
        const unknown = intent as { type?: unknown }
        return {
          ok: false,
          code: 'invalid_type',
          message: `Unknown mindmap document intent "${String(unknown.type)}"`,
        }
      }
    }
  }

  private open(
    intent: Extract<MindmapDocumentIntent, { type: 'open' }>,
  ): MindmapDocumentCommandResult {
    const existing = this.instances.get(intent.fileUuid)
    // Staying open keeps the instance (and its history) alive: switching files
    // never rebuilds a document that is already open. The current state is
    // re-emitted so a reopened view can project it without a round trip.
    if (existing) return { ok: true, state: this.emit(existing) }

    const nodes = layoutReflow(intent.document.nodes, intent.document.edges, intent.structureType)
    const instance: DocumentInstance = {
      fileUuid: intent.fileUuid,
      document: { nodes, edges: intent.document.edges },
      history: new DocumentHistory(),
      version: 0,
      dirty: false,
      structureType: intent.structureType,
    }
    this.instances.set(intent.fileUuid, instance)
    return { ok: true, state: this.emit(instance) }
  }

  private apply(
    fileUuid: string,
    wireCommands: Extract<MindmapDocumentIntent, { type: 'apply' }>['commands'],
  ): MindmapDocumentCommandResult {
    const instance = this.requireInstance(fileUuid)
    if (!instance.ok) return instance.failure
    if (wireCommands.length === 0) return { ok: true, state: this.toState(instance.value) }

    const commands = toMindmapCommands(wireCommands)
    const before = snapshotOf(instance.value.document)
    const outcome = applyDocumentCommands(instance.value.document, commands)
    if (!outcome.ok) return outcome

    const nodes = outcome.reflow
      ? layoutReflow(outcome.document.nodes, outcome.document.edges, instance.value.structureType)
      : outcome.document.nodes
    instance.value.document = { nodes, edges: outcome.document.edges }
    if (outcome.recordHistory) {
      instance.value.history.record({
        id: crypto.randomUUID(),
        before,
        commands,
        timestamp: Date.now(),
      })
      instance.value.dirty = true
    }
    instance.value.version += 1
    return { ok: true, state: this.emit(instance.value) }
  }

  private undo(fileUuid: string): MindmapDocumentCommandResult {
    const instance = this.requireInstance(fileUuid)
    if (!instance.ok) return instance.failure
    const before = instance.value.history.undo()
    if (!before) return { ok: true, state: this.toState(instance.value) }
    instance.value.document = { nodes: before.nodes, edges: before.edges }
    instance.value.dirty = true
    instance.value.version += 1
    return { ok: true, state: this.emit(instance.value) }
  }

  private redo(fileUuid: string): MindmapDocumentCommandResult {
    const instance = this.requireInstance(fileUuid)
    if (!instance.ok) return instance.failure
    const transaction = instance.value.history.redo()
    if (!transaction) return { ok: true, state: this.toState(instance.value) }

    const outcome = applyDocumentCommands(instance.value.document, transaction.commands)
    if (!outcome.ok) return outcome
    const nodes = outcome.reflow
      ? layoutReflow(outcome.document.nodes, outcome.document.edges, instance.value.structureType)
      : outcome.document.nodes
    // Redo is time travel: entrance/exit/cascade markers baked into the
    // replayed commands must not replay an animation.
    instance.value.document = {
      nodes: stripTransientNodeDataFrom(nodes),
      edges: stripEdgeAnimationClasses(outcome.document.edges),
    }
    instance.value.dirty = true
    instance.value.version += 1
    return { ok: true, state: this.emit(instance.value) }
  }

  private layout(
    fileUuid: string,
    structureType: MindmapStructureType | undefined,
    sizes: MindmapNodeSizeUpdate[] | undefined,
  ): MindmapDocumentCommandResult {
    const instance = this.requireInstance(fileUuid)
    if (!instance.ok) return instance.failure

    let changed = false
    if (structureType !== undefined && structureType !== instance.value.structureType) {
      instance.value.structureType = structureType
      changed = true
    }
    if (sizes && sizes.length > 0) {
      const byId = new Map(sizes.map((size) => [size.id, size]))
      instance.value.document = {
        ...instance.value.document,
        nodes: instance.value.document.nodes.map((node) => {
          const size = byId.get(node.id)
          if (!size || sameSize(node, size)) return node
          changed = true
          return { ...node, measured: { width: size.width, height: size.height } }
        }),
      }
    }
    if (!changed) return { ok: true, state: this.toState(instance.value) }

    instance.value.document = {
      ...instance.value.document,
      nodes: layoutReflow(
        instance.value.document.nodes,
        instance.value.document.edges,
        instance.value.structureType,
      ),
    }
    instance.value.version += 1
    return { ok: true, state: this.emit(instance.value) }
  }

  private markSaved(fileUuid: string, version: number): MindmapDocumentCommandResult {
    const instance = this.requireInstance(fileUuid)
    if (!instance.ok) return instance.failure
    // Save guard: a change that landed after the save started keeps the
    // document dirty, and the next autosave persists it.
    if (instance.value.version !== version || !instance.value.dirty) {
      return { ok: true, state: this.toState(instance.value) }
    }
    instance.value.dirty = false
    instance.value.version += 1
    return { ok: true, state: this.emit(instance.value) }
  }

  private reset(fileUuid: string): MindmapDocumentCommandResult {
    const instance = this.requireInstance(fileUuid)
    if (!instance.ok) return instance.failure
    const document = createInitialDocument()
    instance.value.document = {
      nodes: layoutReflow(document.nodes, document.edges, instance.value.structureType),
      edges: document.edges,
    }
    instance.value.history.clear()
    instance.value.dirty = true
    instance.value.version += 1
    return { ok: true, state: this.emit(instance.value) }
  }

  private requireInstance(
    fileUuid: string,
  ): { ok: true; value: DocumentInstance } | { ok: false; failure: MindmapDocumentCommandResult } {
    const instance = this.instances.get(fileUuid)
    if (instance) return { ok: true, value: instance }
    return {
      ok: false,
      failure: {
        ok: false,
        code: 'document_not_found',
        message: `Mindmap document "${fileUuid}" is not open`,
      },
    }
  }

  private emit(instance: DocumentInstance): MindmapDocumentState {
    const state = this.toState(instance)
    for (const listener of this.listeners) listener(state)
    return state
  }

  private toState(instance: DocumentInstance): MindmapDocumentState {
    return {
      fileUuid: instance.fileUuid,
      version: instance.version,
      nodes: instance.document.nodes,
      edges: instance.document.edges,
      structureType: instance.structureType,
      canUndo: instance.history.canUndo,
      canRedo: instance.history.canRedo,
      dirty: instance.dirty,
    }
  }
}
