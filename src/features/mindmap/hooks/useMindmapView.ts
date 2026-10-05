import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  useReactFlow,
  useStoreApi,
  type Node,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { useShortcuts } from '@/shared/shortcuts/useRegisterShortcut'
import { reportRendererError } from '@/shared/lib/reportRendererError'
import { selectChatReady, useSettingsStore } from '@/features/settings/model/settingsStore'
import { shortcutRows } from './shortcutRows'
import {
  useActiveFileAiWriting,
  useActiveMindmapEditor,
  useActiveOpenFile,
  useActiveMindmapStore,
} from './useActiveOpenFile'
import { useMindmapAutoSave } from './useMindmapAutoSave'
import { canvasNodeRegistry } from '@/features/mindmap/nodes/registry'
import { MindmapEdge } from '@/features/mindmap/edges/MindmapEdge'
import { isDefaultViewport } from '@contracts/fileFormat'
import {
  collectDescendantIds,
  collectSubtreeIds,
  findParentId,
} from '@/features/mindmap/model/mindmapTree'
import { assetFromDataUrl } from '@contracts/mindmapXml/asset'
import { createMindmapOperationController } from '@/features/mindmap/model/operationController'
import type { ContextMenuState } from '@/features/mindmap/components/ContextMenu'
import type { PalaceNodeData } from '@contracts/nodeData'

/** A selected topic node the view hands to the generate-palace intent. */
export interface MindmapSelectedTopic {
  id: string
  label: string
}

export function useMindmapView({
  onGeneratePalace,
  syncAfterFileSaved,
  updateFilePreviewUrl,
}: {
  onGeneratePalace: (topics: MindmapSelectedTopic[]) => void
  syncAfterFileSaved: (filePath: string) => Promise<void>
  updateFilePreviewUrl: (filePath: string, previewUrl: string) => void
}) {
  const nodeTypes = useMemo(() => canvasNodeRegistry.toReactFlowNodeTypes(), [])
  const edgeTypes = useMemo(() => ({ mindmap: MindmapEdge }), [])
  const reactFlowStore = useStoreApi()
  const reactFlow = useReactFlow()
  const editor = useActiveMindmapEditor()
  const activeInstance = useActiveOpenFile()
  const nodes = useActiveMindmapStore((state) => state.nodes)
  const edges = useActiveMindmapStore((state) => state.edges)
  const canUndo = useActiveMindmapStore((state) => state.canUndo)
  const canRedo = useActiveMindmapStore((state) => state.canRedo)
  const aiBusy = useActiveFileAiWriting()
  const chatReady = useSettingsStore(selectChatReady)
  const palaceEnabled = chatReady
  const structureType = useActiveMindmapStore((state) => state.style.structureType)
  const filePath = useActiveMindmapStore((state) => state.filePath)
  const hasDocumentOpen = useActiveMindmapStore((state) => state.hasDocumentOpen)
  const documentRefs = useActiveMindmapStore((state) => state.documentRefs)

  const [selectedId, setSelectedId] = useState<string | null>('root')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [hasSelection, setHasSelection] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ scope: 'closed' })
  const [palaceModal, setPalaceModal] = useState<PalaceNodeData | null>(null)
  const [stylePanelOpen, setStylePanelOpen] = useState(false)
  const [documentRefsPanelOpen, setDocumentRefsPanelOpen] = useState(false)
  const lastClickRef = useRef<{ id: string; time: number } | null>(null)
  const lastRestoredFileRef = useRef<string | null>(null)
  const viewportDebounceRef = useRef<number | null>(null)
  const operationStateRef = useRef({ nodes, edges, selectedId, aiBusy })
  operationStateRef.current = { nodes, edges, selectedId, aiBusy }

  const controller = useMemo(
    () =>
      createMindmapOperationController({
        editor,
        getState: () => operationStateRef.current,
        selection: { setSelectedId, setSelectedTopicIds, setHasSelection },
        flow: {
          getNode: (id) => reactFlow.getNode(id),
          setCenter: (x, y, options) => reactFlow.setCenter(x, y, options),
          getViewport: () => reactFlow.getViewport(),
          persistViewport: (viewport) => activeInstance.store.getState().setViewport(viewport),
          clearSelectionMode: () => reactFlowStore.setState({ nodesSelectionActive: false }),
        },
      }),
    [activeInstance.store, editor, reactFlow, reactFlowStore],
  )

  // A collapsed node hides its whole subtree in the render layer (all data is kept, hidden by CSS
  // only). The collapsed node itself stays visible (its expand button is still there); xyflow writes
  // an inline visibility: visible on node wrappers (visible once the node is measured), and class
  // rules cannot beat inline styles, so hidden nodes also get a style override (node.style expands
  // after xyflow's inline style).
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set<string>()
    for (const node of nodes) {
      const data = node.data as {
        collapsed?: boolean
        leftCollapsed?: boolean
        rightCollapsed?: boolean
      }
      if (data.collapsed === true) {
        for (const id of collectDescendantIds(edges, node.id)) hidden.add(id)
      }
      // Root side collapse in bilateral layout: hide the whole side branch
      // (direct children and their subtrees). Only applies to the root node in
      // mindmap layout; logic layout is side-agnostic (all children take part in
      // layout), so the flags are kept but nothing is hidden to avoid gaps.
      const isRoot = !edges.some((e) => e.target === node.id)
      if (
        structureType === 'mindmap' &&
        isRoot &&
        (data.leftCollapsed === true || data.rightCollapsed === true)
      ) {
        for (const edge of edges) {
          if (edge.source !== node.id) continue
          const child = nodes.find((n) => n.id === edge.target)
          const childSide = (child?.data as { side?: 'left' | 'right' } | undefined)?.side
          const sideMatches =
            (data.leftCollapsed === true && childSide === 'left') ||
            (data.rightCollapsed === true && childSide === 'right')
          if (!sideMatches) continue
          for (const id of collectSubtreeIds(edges, edge.target)) hidden.add(id)
        }
      }
    }
    return hidden
  }, [edges, nodes, structureType])
  const canvasNodes = useMemo(
    () =>
      nodes.map((n) =>
        hiddenNodeIds.has(n.id)
          ? {
              ...n,
              className: 'mindmap-node--hidden',
              style: {
                ...n.style,
                visibility: 'hidden',
                pointerEvents: 'none',
              } as CSSProperties,
            }
          : n,
      ),
    [hiddenNodeIds, nodes],
  )
  // Edges inside hidden subtrees are dropped from the render layer too, so no dangling edge points at an empty spot
  const canvasEdges = useMemo(
    () => edges.filter((e) => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target)),
    [edges, hiddenNodeIds],
  )

  const { save, hiddenFlowRef, hiddenRfInstanceRef } = useMindmapAutoSave({
    syncAfterFileSaved,
    updateFilePreviewUrl,
  })
  // The view owns the selection, so it resolves the topic list and emits the
  // generate intent; the chat orchestration itself is wired in by the root.
  const generatePalace = useCallback(() => {
    let selectedNodes = nodes
      .filter((node) => node.selected && node.type === 'text')
      .map((node) => ({ id: node.id, label: String(node.data?.label ?? '') }))
    if (selectedNodes.length === 0 && selectedId) {
      const target = nodes.find((node) => node.id === selectedId)
      if (target?.type === 'text') {
        selectedNodes = [{ id: target.id, label: String(target.data?.label ?? '') }]
      }
    }
    if (selectedNodes.length === 0) {
      reportRendererError('No topic node is selected')
      return
    }
    onGeneratePalace(selectedNodes)
  }, [nodes, selectedId, onGeneratePalace])

  useEffect(() => {
    if (!hasDocumentOpen || nodes.length === 0) return
    if (lastRestoredFileRef.current === filePath) return
    lastRestoredFileRef.current = filePath

    const viewport = activeInstance.store.getState().viewport
    if (isDefaultViewport(viewport)) {
      reactFlow.fitView({ padding: 0.2, duration: 300 })
    } else {
      reactFlow.setViewport(viewport)
    }
  }, [activeInstance.store, filePath, hasDocumentOpen, nodes.length, reactFlow])

  const handleInit = useCallback(
    (instance: ReactFlowInstance) => {
      const viewport = activeInstance.store.getState().viewport
      if (!isDefaultViewport(viewport)) instance.setViewport(viewport)
    },
    [activeInstance.store],
  )

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (viewportDebounceRef.current) window.clearTimeout(viewportDebounceRef.current)
      viewportDebounceRef.current = window.setTimeout(() => {
        viewportDebounceRef.current = null
        activeInstance.store.getState().setViewport(viewport)
      }, 200)
    },
    [activeInstance.store],
  )

  useEffect(() => {
    return () => {
      if (viewportDebounceRef.current) {
        window.clearTimeout(viewportDebounceRef.current)
        viewportDebounceRef.current = null
      }
    }
  }, [filePath])

  const onNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      if (node.type === 'palace') {
        const data = node.data as PalaceNodeData
        if (data.generating) return
        if (data.expanded) setPalaceModal(data)
        else editor.setNodeExpanded(node.id, true)
        return
      }

      const now = Date.now()
      const previous = lastClickRef.current
      if (previous && previous.id === node.id && now - previous.time < 400) {
        lastClickRef.current = null
        controller.startEditing(node.id)
      } else {
        lastClickRef.current = { id: node.id, time: now }
      }
    },
    [controller, editor],
  )

  const openContextMenu = useCallback((menu: ContextMenuState) => setContextMenu(menu), [])

  // Local image insert: read the file into base64 -> sha256 dedupe -> addAsset -> image node
  const insertImageRef = useRef<HTMLInputElement | null>(null)
  const insertImage = useCallback(() => {
    if (!insertImageRef.current) {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.style.display = 'none'
      input.addEventListener('change', () => {
        const file = input.files?.[0]
        input.value = ''
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = typeof reader.result === 'string' ? reader.result : null
          if (!dataUrl) {
            reportRendererError('Image read failed')
            return
          }
          void (async () => {
            const asset = await assetFromDataUrl(dataUrl)
            if (!asset) {
              reportRendererError('Unsupported image format')
              return
            }
            const parentId = selectedId ?? 'root'
            const assetId = activeInstance.store.getState().addAsset(asset)
            editor.addNode({
              type: 'image',
              data: { assetId, alt: file.name },
              parentId,
            })
          })()
        }
        reader.onerror = () => reportRendererError('Image read failed')
        reader.readAsDataURL(file)
      })
      insertImageRef.current = input
      document.body.appendChild(input)
    }
    insertImageRef.current.click()
  }, [activeInstance.store, editor, selectedId])

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault()
      setSelectedId(node.id)
      if (!node.selected) editor.setNodeSelected(node.id, true)
      openContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        scope: 'node',
        nodeId: node.id,
      })
    },
    [editor, openContextMenu],
  )
  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent, selectedNodes: Node[]) => {
      event.preventDefault()
      if (selectedNodes.length === 0) return
      const primary = selectedNodes[0]!
      setSelectedId(primary.id)
      openContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        scope: 'node',
        nodeId: primary.id,
      })
    },
    [openContextMenu],
  )
  const onEdgeContextMenu = useCallback((event: ReactMouseEvent) => event.preventDefault(), [])

  const shortcutsEnabled = useCallback(() => !aiBusy, [aiBusy])
  const canAddSibling = useMemo(
    () => Boolean(selectedId && findParentId(edges, selectedId)),
    [edges, selectedId],
  )
  const canRemove = Boolean(selectedId && selectedId !== 'root')

  useShortcuts(
    shortcutRows({ controller, selectedId, canAddSibling, enabled: shortcutsEnabled, save }),
    { group: 'mindmap', preventWhenTyping: true },
  )

  const previousStructureTypeRef = useRef(structureType)
  useEffect(() => {
    if (previousStructureTypeRef.current === structureType) return
    previousStructureTypeRef.current = structureType
    editor.reflow()
    const timer = window.setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 300 }), 50)
    return () => window.clearTimeout(timer)
  }, [editor, reactFlow, structureType])

  return {
    nodes: canvasNodes,
    edges: canvasEdges,
    nodeTypes,
    edgeTypes,
    aiBusy,
    palaceEnabled,
    selectedTopicCount: selectedTopicIds.length,
    contextMenu,
    palaceModal,
    stylePanelOpen,
    documentRefsPanelOpen,
    hasDocumentRefs: documentRefs.length > 0,
    canAddChild: hasSelection,
    canAddSibling,
    canAddParent: canAddSibling,
    canRemove,
    canUndo,
    canRedo,
    hiddenFlowRef,
    hiddenRfInstanceRef,
    canvas: {
      onNodesChange: controller.handleNodesChange,
      onEdgesChange: controller.handleEdgesChange,
      onNodeClick,
      onNodeContextMenu,
      onSelectionContextMenu,
      onEdgeContextMenu,
      onMoveEnd: handleMoveEnd,
      onInit: handleInit,
      onSelectionChange: controller.handleSelectionChange,
    },
    actions: {
      addChild: controller.addChild,
      addSibling: controller.addSibling,
      addParent: controller.addParent,
      removeSelected: controller.removeSelected,
      reset: controller.reset,
      undo: controller.undo,
      redo: controller.redo,
      save,
      centerRoot: controller.centerRoot,
      generatePalace,
      insertImage,
      closeContextMenu: () => setContextMenu({ scope: 'closed' }),
      closePalaceModal: () => setPalaceModal(null),
      toggleStylePanel: () => {
        setStylePanelOpen((open) => !open)
        setDocumentRefsPanelOpen(false)
      },
      closeStylePanel: () => setStylePanelOpen(false),
      toggleDocumentRefsPanel: () => {
        setDocumentRefsPanelOpen((open) => !open)
        setStylePanelOpen(false)
      },
      closeDocumentRefsPanel: () => setDocumentRefsPanelOpen(false),
    },
  }
}
