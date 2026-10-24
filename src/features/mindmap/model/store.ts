import { create, type StoreApi, type UseBoundStore } from 'zustand'
import { createInitialDocument } from '@contracts/mindmapDocument/initial'
import type { Edge, Node, Viewport } from '@xyflow/react'
import { type MindLaneFile, type DocumentRef, type MindLaneAsset } from '@contracts/fileFormat'
import type {
  MindmapDocument,
  MindmapDocumentEdge,
  MindmapDocumentNode,
  MindmapStructureType,
} from '@contracts/mindmapDocument/types'
import type { MindmapDocumentState, MindmapNodeSizeUpdate } from '@contracts/mindmapDocument/state'
import type { MindmapWireCommand } from '@contracts/mindmapDocument/wire'
import { canvasNodeRegistry } from '@/features/mindmap/nodes/registry'
import { DEFAULT_STYLE } from '@/features/mindmap/theme/presets'
import type { MindmapStyleState } from '@/features/mindmap/theme/types'
import { MindmapDocumentClient, resolveDocumentTransport } from './documentClient'

/** View-only flags attached to one node; never part of the document. */
interface NodeViewState {
  flags: Record<string, unknown>
  /** Drag preview position (the document only learns the final position). */
  position?: { x: number; y: number }
}

interface EdgeViewState {
  className?: string
}

export interface OpenFileState {
  /** Projection of the authoritative document (positions included, computed by the main process). */
  nodes: Node[]
  edges: Edge[]
  dirty: boolean
  localDirty: boolean
  documentDirty: boolean
  /** Version of the document state currently projected. */
  documentVersion: number
  hasDocumentOpen: boolean
  filePath: string | null
  fileUuid: string
  fileTitle: string
  fileCreatedAt: string
  workspacePath: string | null
  viewport: Viewport
  /** Embedded image assets (the assets section), deduplicated by sha256 content */
  assets: MindLaneAsset[]
  documentRefs: DocumentRef[]
  style: MindmapStyleState
  canUndo: boolean
  canRedo: boolean

  /** @internal Authoritative document value last received (view state is composed on top). */
  documentNodes: MindmapDocumentNode[]
  documentEdges: MindmapDocumentEdge[]
  /** @internal Transient node view state, keyed by node id. */
  nodeViews: Record<string, NodeViewState>
  /** @internal Transient edge view state, keyed by edge id. */
  edgeViews: Record<string, EdgeViewState>
  /** @internal Selected node ids (selection is view state). */
  selectedIds: string[]
  /** @internal Selected edge ids (selection is view state). */
  selectedEdges: string[]

  /**
   * Apply a versioned state pushed by the document service. Returns false (and
   * warns) for a stale version: a state older than what is already shown is
   * never allowed to roll the view back.
   */
  applyDocumentState: (state: MindmapDocumentState) => boolean

  /** @internal One command channel into the document. */
  applyCommands: (commands: MindmapWireCommand[]) => void
  undo: () => void
  redo: () => void
  /** @internal Ask the document to recompute layout (style switch, measured sizes). */
  relayout: (input: {
    structureType?: MindmapStructureType
    sizes?: MindmapNodeSizeUpdate[]
  }) => void
  resetDocument: () => void
  /** @internal Resolves when every command sent so far has been observed. */
  whenSettled: () => Promise<void>
  /** @internal Drop the client subscription and release the main-process document. */
  dispose: () => void

  setNodeFlag: (nodeId: string, flag: string, value: unknown) => void
  clearNodeFlag: (nodeId: string, flag: string) => void
  setNodeViewFlags: (nodeId: string, flags: Record<string, unknown>) => void
  setNodeEditing: (nodeId: string, editing: boolean) => void
  setNodeSelected: (nodeId: string | string[], selected: boolean) => void
  /** @internal Selection delta coming from the canvas (keeps multi-selection intact). */
  setNodeSelection: (nodeId: string, selected: boolean) => void
  /** @internal Edge selection delta coming from the canvas. */
  setEdgeSelection: (edgeId: string, selected: boolean) => void
  clearNodeSelection: () => void
  previewNodePosition: (nodeId: string, position: { x: number; y: number }) => void
  setEdgeClassName: (edgeId: string, className: string | undefined) => void

  markClean: () => void
  setFilePath: (filePath: string) => void
  /** Rename the document title (metadata.title); marking dirty lets autosave persist it. */
  setFileTitle: (title: string) => void
  setViewport: (viewport: Viewport) => void
  /** Add an embedded image asset; an identical sha256 reuses the existing asset. Returns the asset id actually used. */
  addAsset: (asset: MindLaneAsset) => string
  /** Update the current document style (merge) and mark the document dirty. */
  setStyle: (partial: Partial<MindmapStyleState>) => void

  loadFile: (filePath: string, data: MindLaneFile, workspacePath: string | null) => void
  toMindLaneFile: () => MindLaneFile
  addDocumentRef: (ref: DocumentRef) => void
}

export type MindmapStore = UseBoundStore<StoreApi<OpenFileState>>

function composeNodes(
  documentNodes: MindmapDocumentNode[],
  nodeViews: Record<string, NodeViewState>,
  selectedIds: string[],
): Node[] {
  const selected = new Set(selectedIds)
  return documentNodes.map((node) => {
    const view = nodeViews[node.id]
    const data = view?.flags ? { ...node.data, ...view.flags } : node.data
    return {
      ...node,
      position: view?.position ?? node.position,
      data,
      selected: selected.has(node.id),
    } as Node
  })
}

function composeEdges(
  documentEdges: MindmapDocumentEdge[],
  edgeViews: Record<string, EdgeViewState>,
  selectedIds: string[],
): Edge[] {
  const selected = new Set(selectedIds)
  return documentEdges.map((edge) => {
    const view = edgeViews[edge.id]
    return {
      ...edge,
      ...(view?.className !== undefined ? { className: view.className } : {}),
      selected: selected.has(edge.id),
    } as Edge
  })
}

/** Merge assets pushed by the document into the local cache (append-only, deduplicated). */
function mergeAssets(current: MindLaneAsset[], added: MindLaneAsset[]): MindLaneAsset[] {
  const merged = [...current]
  for (const asset of added) {
    if (merged.some((candidate) => candidate.id === asset.id || candidate.sha256 === asset.sha256))
      continue
    merged.push(asset)
  }
  return merged
}

const PALACE_RUN_FLAGS = ['generating', 'runStage', 'runStopped'] as const

/**
 * A palace that carries stations is a landed palace. Landing runs in the main
 * process, so the run's view flags retire here: the placeholder stops showing
 * progress, a freshly landed palace opens itself, and the selection it collected
 * stops showing the processing marker.
 */
function projectLandedPalaces(
  nodes: MindmapDocumentNode[],
  nodeViews: Record<string, NodeViewState>,
  previousIds: Set<string>,
): void {
  for (const node of nodes) {
    if (node.type !== 'palace') continue
    const stations = Array.isArray(node.data.stations) ? node.data.stations : []
    if (stations.length === 0) continue

    const view = nodeViews[node.id] ?? { flags: {} }
    const flags = { ...view.flags }
    let landed = !previousIds.has(node.id)
    for (const flag of PALACE_RUN_FLAGS) {
      if (flags[flag] === undefined) continue
      flags[flag] = undefined
      landed = true
    }
    if (landed && flags.expanded !== true) flags.expanded = true
    nodeViews[node.id] = { ...view, flags }
    // Only the landing itself retires the selection marker: a later run that
    // collects the same nodes must be free to show its own progress.
    if (!landed) continue
    const sourceNodeIds = Array.isArray(node.data.sourceNodeIds) ? node.data.sourceNodeIds : []
    for (const id of sourceNodeIds) {
      if (typeof id !== 'string' || id === 'root') continue
      const source = nodeViews[id]
      if (source?.flags.processing === undefined) continue
      nodeViews[id] = { ...source, flags: { ...source.flags, processing: undefined } }
    }
  }
}

function withNodeView(
  nodeViews: Record<string, NodeViewState>,
  nodeId: string,
  next: NodeViewState,
): Record<string, NodeViewState> {
  return { ...nodeViews, [nodeId]: next }
}

export function createMindmapStore(): MindmapStore {
  let client: MindmapDocumentClient | null = null
  let detach: (() => void) | null = null
  // A store always starts from the blank document anchor, the same value the
  // main process uses for a reset; loading a file replaces it with the
  // versioned state pushed by the document service.
  const initialDocument = createInitialDocument()

  return create<OpenFileState>((set, get) => {
    const ensureClient = (): MindmapDocumentClient => {
      if (client) return client
      client = new MindmapDocumentClient(resolveDocumentTransport())
      detach = client.subscribe((state) => {
        get().applyDocumentState(state)
      })
      return client
    }

    const recompose = (): Partial<OpenFileState> => {
      const { documentNodes, documentEdges, nodeViews, edgeViews, selectedIds } = get()
      return {
        nodes: composeNodes(documentNodes, nodeViews, selectedIds),
        edges: composeEdges(documentEdges, edgeViews, get().selectedEdges),
      }
    }

    const markLocalDirty = () => set({ localDirty: true, dirty: true })

    return {
      nodes: initialDocument.nodes as Node[],
      edges: [],
      dirty: false,
      localDirty: false,
      documentDirty: false,
      documentVersion: -1,
      hasDocumentOpen: false,
      filePath: null,
      fileUuid: '',
      fileTitle: '',
      fileCreatedAt: '',
      workspacePath: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      assets: [],
      documentRefs: [],
      style: { ...DEFAULT_STYLE },
      canUndo: false,
      canRedo: false,
      documentNodes: initialDocument.nodes,
      documentEdges: [],
      nodeViews: {},
      edgeViews: {},
      selectedIds: [],
      selectedEdges: [],

      applyDocumentState: (state) => {
        if (state.fileUuid !== get().fileUuid) return false
        const current = get().documentVersion
        if (state.version <= current) {
          // "Clicked, nothing happened" anchor: the version never advanced, so
          // no state is applied and the view keeps showing the newer truth.
          console.warn(
            `[MindLane] mindmap document version stalled for ${state.fileUuid}: incoming ${state.version} <= current ${current}; stale state discarded`,
          )
          return false
        }
        const liveIds = new Set(state.nodes.map((node) => node.id))
        const positions = new Map(state.nodes.map((node) => [node.id, node.position]))
        const nodeViews: Record<string, NodeViewState> = {}
        for (const [id, view] of Object.entries(get().nodeViews)) {
          if (!liveIds.has(id)) continue
          // A drag preview retires itself once the document shows the same
          // position, so the view never keeps overriding a later layout.
          const preview = view.position
          const landed = positions.get(id)
          const keepPreview =
            preview !== undefined && !(landed && landed.x === preview.x && landed.y === preview.y)
          nodeViews[id] = keepPreview
            ? { flags: view.flags, position: preview }
            : { flags: view.flags }
        }
        const edgeIds = new Set(state.edges.map((edge) => edge.id))
        const edgeViews = Object.fromEntries(
          Object.entries(get().edgeViews).filter(([id]) => edgeIds.has(id)),
        )
        const selectedIds = get().selectedIds.filter((id) => liveIds.has(id))
        const selectedEdges = get().selectedEdges.filter((id) => edgeIds.has(id))
        projectLandedPalaces(state.nodes, nodeViews, new Set(get().documentNodes.map((n) => n.id)))
        set({
          documentNodes: state.nodes,
          documentEdges: state.edges,
          nodeViews,
          edgeViews,
          selectedIds,
          selectedEdges,
          documentVersion: state.version,
          canUndo: state.canUndo,
          canRedo: state.canRedo,
          assets: state.addedAssets?.length
            ? mergeAssets(get().assets, state.addedAssets)
            : get().assets,
          documentDirty: state.dirty,
          dirty: state.dirty || get().localDirty,
          nodes: composeNodes(state.nodes, nodeViews, selectedIds),
          edges: composeEdges(state.edges, edgeViews, selectedEdges),
        })
        return true
      },

      applyCommands: (commands) => {
        if (commands.length === 0) return
        ensureClient().apply(get().fileUuid, commands)
      },

      undo: () => {
        ensureClient().undo(get().fileUuid)
      },

      redo: () => {
        ensureClient().redo(get().fileUuid)
      },

      relayout: ({ structureType, sizes }) => {
        ensureClient().layout(get().fileUuid, structureType, sizes)
      },

      resetDocument: () => {
        ensureClient().reset(get().fileUuid)
      },

      whenSettled: () => ensureClient().whenSettled(get().fileUuid),

      dispose: () => {
        detach?.()
        detach = null
        client?.close(get().fileUuid)
        client = null
      },

      setNodeFlag: (nodeId, flag, value) => {
        const current = get().nodeViews[nodeId] ?? { flags: {} }
        set({
          nodeViews: withNodeView(get().nodeViews, nodeId, {
            ...current,
            flags: { ...current.flags, [flag]: value },
          }),
        })
        set(recompose())
      },

      clearNodeFlag: (nodeId, flag) => {
        const current = get().nodeViews[nodeId] ?? { flags: {} }
        set({
          nodeViews: withNodeView(get().nodeViews, nodeId, {
            ...current,
            flags: { ...current.flags, [flag]: undefined },
          }),
        })
        set(recompose())
      },

      setNodeViewFlags: (nodeId, flags) => {
        const current = get().nodeViews[nodeId] ?? { flags: {} }
        set({
          nodeViews: withNodeView(get().nodeViews, nodeId, {
            ...current,
            flags: { ...current.flags, ...flags },
          }),
        })
        set(recompose())
      },

      setNodeEditing: (nodeId, editing) => {
        const nodeViews = { ...get().nodeViews }
        if (editing) {
          // Starting to edit a node clears the editing flag on the others
          for (const [id, view] of Object.entries(nodeViews)) {
            if (id !== nodeId && view.flags.editing) {
              nodeViews[id] = { ...view, flags: { ...view.flags, editing: undefined } }
            }
          }
        }
        const current = nodeViews[nodeId] ?? { flags: {} }
        nodeViews[nodeId] = {
          ...current,
          flags: { ...current.flags, editing: editing ? true : undefined },
        }
        set({ nodeViews })
        set(recompose())
      },

      setNodeSelected: (nodeId, selected) => {
        const ids = Array.isArray(nodeId) ? nodeId : [nodeId]
        if (selected) {
          // Single-select behaviour: selecting clears every other selection.
          set({ selectedIds: [...new Set(ids)] })
        } else {
          const remove = new Set(ids)
          set({ selectedIds: get().selectedIds.filter((id) => !remove.has(id)) })
        }
        set(recompose())
      },

      setNodeSelection: (nodeId, selected) => {
        const current = new Set(get().selectedIds)
        if (selected) current.add(nodeId)
        else current.delete(nodeId)
        set({ selectedIds: [...current] })
        set(recompose())
      },

      setEdgeSelection: (edgeId, selected) => {
        const current = new Set(get().selectedEdges)
        if (selected) current.add(edgeId)
        else current.delete(edgeId)
        set({ selectedEdges: [...current] })
        set(recompose())
      },

      clearNodeSelection: () => {
        set({ selectedIds: [] })
        set(recompose())
      },

      previewNodePosition: (nodeId, position) => {
        const current = get().nodeViews[nodeId] ?? { flags: {} }
        set({ nodeViews: withNodeView(get().nodeViews, nodeId, { ...current, position }) })
        set(recompose())
      },

      setEdgeClassName: (edgeId, className) => {
        set({ edgeViews: { ...get().edgeViews, [edgeId]: { className } } })
        set(recompose())
      },

      setFilePath: (filePath) => set({ filePath }),

      setFileTitle: (fileTitle) => {
        if (get().fileTitle === fileTitle) return
        set({ fileTitle })
        markLocalDirty()
      },

      setViewport: (viewport) => set({ viewport }),

      addAsset: (asset) => {
        const existing = get().assets.find((a) => a.sha256 === asset.sha256)
        if (existing) return existing.id
        set({ assets: [...get().assets, asset] })
        markLocalDirty()
        // The document owns the file's asset section: registering the image here
        // is what lets a later AI write reference it (and what makes it survive a
        // save driven by the document).
        if (get().fileUuid) ensureClient().addAssets(get().fileUuid, [asset])
        return asset.id
      },

      setStyle: (partial) => {
        const style = { ...get().style, ...partial }
        const unchanged =
          style.structureType === get().style.structureType &&
          style.visualVariant === get().style.visualVariant &&
          style.colorScheme === get().style.colorScheme
        if (unchanged) return
        set({ style })
        markLocalDirty()
      },

      markClean: () => {
        set({ localDirty: false, documentDirty: false, dirty: false })
        ensureClient().markSaved(get().fileUuid, get().documentVersion)
      },

      loadFile: (filePath, data, workspacePath) => {
        // Positions are not stored in the file: the main-process layout recomputes
        // them on open and ships them with the versioned state.
        const style = data.mindmap.style
          ? { ...DEFAULT_STYLE, ...data.mindmap.style }
          : { ...DEFAULT_STYLE }
        set({
          nodes: [],
          edges: [],
          documentNodes: [],
          documentEdges: [],
          documentVersion: -1,
          nodeViews: {},
          edgeViews: {},
          selectedIds: [],
          selectedEdges: [],
          assets: data.assets ?? [],
          documentRefs: data.documents ?? [],
          hasDocumentOpen: true,
          filePath,
          fileUuid: data.metadata.fileUuid,
          fileTitle: data.metadata.title,
          fileCreatedAt: data.metadata.createdAt,
          workspacePath,
          dirty: false,
          localDirty: false,
          documentDirty: false,
          viewport: data.mindmap.viewport,
          style,
          canUndo: false,
          canRedo: false,
        })
        const document: MindmapDocument = {
          nodes: data.mindmap.nodes as MindmapDocumentNode[],
          edges: data.mindmap.edges as MindmapDocumentEdge[],
        }
        ensureClient().open(data.metadata.fileUuid, document, style.structureType, data.assets)
      },

      toMindLaneFile: (): MindLaneFile => {
        const {
          nodes,
          edges,
          fileUuid,
          fileTitle,
          fileCreatedAt,
          viewport,
          assets,
          documentRefs,
          style,
        } = get()
        const now = new Date().toISOString()
        return {
          version: '1.0',
          metadata: { fileUuid, title: fileTitle, createdAt: fileCreatedAt, updatedAt: now },
          mindmap: {
            nodes: nodes.map((n) => ({
              id: n.id,
              type: n.type!,
              position: n.position,
              data: canvasNodeRegistry.get(n.type!)!.serialize(n.data),
            })) as MindLaneFile['mindmap']['nodes'],
            edges: edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              type: e.type,
              className: e.className,
            })),
            viewport,
            style: { ...style },
          },
          assets,
          documents: documentRefs,
        }
      },

      addDocumentRef: (ref) => {
        set({
          documentRefs: [...get().documentRefs.filter((doc) => doc.id !== ref.id), ref],
        })
        markLocalDirty()
      },
    }
  })
}
