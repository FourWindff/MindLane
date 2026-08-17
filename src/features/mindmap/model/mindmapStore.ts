import { create, type StoreApi, type UseBoundStore } from 'zustand'
import type { Edge, Node, Viewport } from '@xyflow/react'
import {
  createEmptyFile,
  type MindLaneFile,
  type DocumentRef,
  type MindlaneAsset,
  migrateDocumentRef,
} from '@/shared/lib/fileFormat'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { DEFAULT_STYLE } from '@/features/mindmap/style/presets'
import type { MindmapStyleState } from '@/features/mindmap/style/types'
import { mindmapLayout } from './mindmapLayout'

export interface MindmapState {
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
  /** 内嵌图片资源（assets 节），sha256 内容去重 */
  assets: MindlaneAsset[]
  documentRefs: DocumentRef[]
  style: MindmapStyleState
  canUndo: boolean
  canRedo: boolean

  /** @internal 仅供 MindmapEditor 写入；外部代码应通过 Editor 修改结构。 */
  setNodes: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  /** @internal 仅供 MindmapEditor 写入；外部代码应通过 Editor 修改结构。 */
  setEdges: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void

  /** @internal 仅供 MindmapEditor 调用；用于无脏标记的临时 UI 更新。 */
  setNodesTransient: (nodes: Node[] | ((prev: Node[]) => Node[])) => void
  /** @internal 仅供 MindmapEditor 调用；用于无脏标记的临时 UI 更新。 */
  setEdgesTransient: (edges: Edge[] | ((prev: Edge[]) => Edge[])) => void

  markClean: () => void
  setFilePath: (filePath: string) => void
  setViewport: (viewport: Viewport) => void
  /** 添加内嵌图片资源；sha256 相同则复用已有 asset，返回实际使用的 asset id。 */
  addAsset: (asset: MindlaneAsset) => string
  /** 更新当前文档样式（合并），并标记文档为待保存。 */
  setStyle: (partial: Partial<MindmapStyleState>) => void
  /** @internal 由 MindmapEditor 调用以同步历史可用状态。 */
  setHistoryAvailability: (canUndo: boolean, canRedo: boolean) => void

  loadFile: (filePath: string, data: MindLaneFile, workspacePath: string | null) => void
  newFile: (title?: string) => void
  clearDocument: () => void
  toMindLaneFile: () => MindLaneFile
  addDocumentRef: (ref: DocumentRef) => void
}

export type MindmapStore = UseBoundStore<StoreApi<MindmapState>>

const initialFile = createEmptyFile()

export function createMindmapStore(): MindmapStore {
  return create<MindmapState>((set, get) => ({
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
      // 打开时丢弃 position（文件不存位置），由确定性布局算法重算并缓存于内存实例
      const style = data.mindmap.style
        ? { ...DEFAULT_STYLE, ...data.mindmap.style }
        : { ...DEFAULT_STYLE }
      const laidOut = mindmapLayout.reflow(
        hydratedNodes as Node[],
        data.mindmap.edges as Edge[],
        style.structureType,
        style.visualVariant,
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

    newFile: (title) => {
      const f = createEmptyFile(title)
      set({
        nodes: f.mindmap.nodes as Node[],
        edges: f.mindmap.edges as Edge[],
        documentRefs: [],
        hasDocumentOpen: true,
        filePath: null,
        fileUuid: f.metadata.fileUuid,
        fileTitle: f.metadata.title,
        fileCreatedAt: f.metadata.createdAt,
        workspacePath: null,
        dirty: false,
        viewport: f.mindmap.viewport,
        assets: [],
        style: { ...DEFAULT_STYLE },
        canUndo: false,
        canRedo: false,
      })
    },

    clearDocument: () => {
      const f = createEmptyFile()
      set({
        nodes: f.mindmap.nodes as Node[],
        edges: f.mindmap.edges as Edge[],
        hasDocumentOpen: false,
        filePath: null,
        fileUuid: f.metadata.fileUuid,
        fileTitle: f.metadata.title,
        fileCreatedAt: f.metadata.createdAt,
        workspacePath: null,
        dirty: false,
        viewport: f.mindmap.viewport,
        assets: [],
        style: { ...DEFAULT_STYLE },
        documentRefs: [],
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
            data: nodeRegistry.get(n.type!)!.serialize(n.data),
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
