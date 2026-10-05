import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Edge, Node, Viewport } from '@xyflow/react'
import {
  createEmptyFile,
  type MindLaneFile,
  type DocumentRef,
  type MindLaneAsset,
  migrateDocumentRef,
} from '@contracts/fileFormat'
import { canvasNodeRegistry } from '@/features/mindmap/nodes/registry'
import { DEFAULT_STYLE } from '@/features/mindmap/theme/presets'
import type { MindmapStyleState } from '@/features/mindmap/theme/types'
import { layoutReflow } from './layout'

export interface OpenFileState {
  nodes: Node[]
  edges: Edge[]
  dirty: boolean
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

  /** @internal Written only by MindmapEditor; outside code should change the structure through the Editor. */
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  /** @internal Written only by MindmapEditor; outside code should change the structure through the Editor. */
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void

  /** @internal Called only by MindmapEditor; transient UI updates that must not set the dirty flag. */
  setNodesTransient: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  /** @internal Called only by MindmapEditor; transient UI updates that must not set the dirty flag. */
  setEdgesTransient: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void

  markClean: () => void
  setFilePath: (filePath: string) => void
  /** Rename the document title (metadata.title); marking dirty lets autosave persist it. */
  setFileTitle: (title: string) => void
  setViewport: (viewport: Viewport) => void
  /** Add an embedded image asset; an identical sha256 reuses the existing asset. Returns the asset id actually used. */
  addAsset: (asset: MindLaneAsset) => string
  /** Update the current document style (merge) and mark the document dirty. */
  setStyle: (partial: Partial<MindmapStyleState>) => void
  /** @internal Called by MindmapEditor to sync undo/redo availability. */
  setHistoryAvailability: (canUndo: boolean, canRedo: boolean) => void

  loadFile: (filePath: string, data: MindLaneFile, workspacePath: string | null) => void
  toMindLaneFile: () => MindLaneFile
  addDocumentRef: (ref: DocumentRef) => void
}

export type MindmapStore = UseBoundStore<StoreApi<OpenFileState>>

const initialFile = createEmptyFile()

export function createMindmapStore(): MindmapStore {
  return create<OpenFileState>((set, get) => ({
    nodes: initialFile.mindmap.nodes as Node[],
    edges: initialFile.mindmap.edges as Edge[],
    dirty: false,
    hasDocumentOpen: false,
    filePath: null,
    fileUuid: initialFile.metadata.fileUuid,
    fileTitle: initialFile.metadata.title,
    fileCreatedAt: initialFile.metadata.createdAt,
    workspacePath: null,
    viewport: initialFile.mindmap.viewport,
    assets: [],
    documentRefs: [],
    style: { ...DEFAULT_STYLE },
    canUndo: false,
    canRedo: false,

    setFilePath: (filePath) => set({ filePath }),

    setFileTitle: (fileTitle) =>
      set((s) => (s.fileTitle === fileTitle ? {} : { fileTitle, dirty: true })),

    setViewport: (viewport) => set({ viewport }),

    addAsset: (asset) => {
      const existing = get().assets.find((a) => a.sha256 === asset.sha256)
      if (existing) return existing.id
      set((s) => ({ assets: [...s.assets, asset], dirty: true }))
      return asset.id
    },

    setStyle: (partial) =>
      set((s) => {
        const style = { ...s.style, ...partial }
        const unchanged =
          style.structureType === s.style.structureType &&
          style.visualVariant === s.style.visualVariant &&
          style.colorScheme === s.style.colorScheme
        return unchanged ? {} : { style, dirty: true }
      }),

    setHistoryAvailability: (canUndo, canRedo) => set({ canUndo, canRedo }),

    setNodes: (updater) => {
      set((s) => ({
        nodes: typeof updater === 'function' ? updater(s.nodes) : updater,
        dirty: true,
      }))
    },

    setEdges: (updater) => {
      set((s) => ({
        edges: typeof updater === 'function' ? updater(s.edges) : updater,
        dirty: true,
      }))
    },

    setNodesTransient: (updater) => {
      set((s) => ({
        nodes: typeof updater === 'function' ? updater(s.nodes) : updater,
      }))
    },

    setEdgesTransient: (updater) => {
      set((s) => ({
        edges: typeof updater === 'function' ? updater(s.edges) : updater,
      }))
    },

    markClean: () => set({ dirty: false }),

    loadFile: (filePath, data, workspacePath) => {
      const hydratedNodes = data.mindmap.nodes.map((n) => ({
        ...n,
        data: n.data,
      }))
      // Discard position on open (files do not store positions); the deterministic layout
      // recomputes it and caches it in the in-memory instance
      const style = data.mindmap.style
        ? { ...DEFAULT_STYLE, ...data.mindmap.style }
        : { ...DEFAULT_STYLE }
      const laidOut = layoutReflow(
        hydratedNodes as Node[],
        data.mindmap.edges as Edge[],
        style.structureType,
      )
      set({
        nodes: laidOut,
        edges: data.mindmap.edges as Edge[],
        assets: data.assets ?? [],
        documentRefs: (data.documents || []).map(migrateDocumentRef),
        hasDocumentOpen: true,
        filePath,
        fileUuid: data.metadata.fileUuid,
        fileTitle: data.metadata.title,
        fileCreatedAt: data.metadata.createdAt,
        workspacePath,
        dirty: false,
        viewport: data.mindmap.viewport,
        style,
        canUndo: false,
        canRedo: false,
      })
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
      set((s) => ({
        documentRefs: [...s.documentRefs.filter((doc) => doc.id !== ref.id), ref],
        dirty: true,
      }))
    },
  }))
}
