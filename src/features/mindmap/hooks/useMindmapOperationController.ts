import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import {
  useReactFlow,
  useStoreApi,
  type Node,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import { useShortcut } from '@/shared/shortcuts/useRegisterShortcut'
import { useAiStore } from '@/features/chat/model/aiStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useStyleStore } from '@/features/mindmap/style/styleStore'
import { useActiveMindmapEditor } from './useActiveMindmapEditor'
import { useActiveMindmapInstance } from './useActiveMindmapInstance'
import { useActiveMindmapStore } from './useActiveMindmapStore'
import { useMindmapPersistence } from './useMindmapPersistence'
import { usePalaceGeneration } from './usePalaceGeneration'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { MindmapEdge } from '@/features/mindmap/edges/MindmapEdge'
import { isDefaultViewport } from '@/shared/lib/fileFormat'
import { findParentId } from '@/shared/lib/mindmapTree'
import { createMindmapOperationController } from '@/features/mindmap/model/mindmapOperationController'
import type { ContextMenuState } from '@/features/mindmap/components/MindMapContextMenu'
import type { PalaceNodeData } from '@/features/mindmap/nodes/palace/types'

type FlowContextEvent = ReactMouseEvent | globalThis.MouseEvent

export function useMindmapOperationController() {
  const nodeTypes = useMemo(() => nodeRegistry.toReactFlowNodeTypes(), [])
  const edgeTypes = useMemo(() => ({ mindmap: MindmapEdge }), [])
  const reactFlowStore = useStoreApi()
  const reactFlow = useReactFlow()
  const editor = useActiveMindmapEditor()
  const activeInstance = useActiveMindmapInstance()
  const nodes = useActiveMindmapStore((state) => state.nodes)
  const edges = useActiveMindmapStore((state) => state.edges)
  const canUndo = useActiveMindmapStore((state) => state.canUndo)
  const canRedo = useActiveMindmapStore((state) => state.canRedo)
  const aiBusy = useAiStore((state) => state.busy)
  const capabilities = useSettingsStore((state) => state.capabilities)
  const palaceEnabled = capabilities.includes('imageGen') && capabilities.includes('vision')
  const structureType = useStyleStore((state) => state.mapStyle).startsWith('mindmap')
    ? ('mindmap' as const)
    : ('logic' as const)
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
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const lastClickRef = useRef<{ id: string; time: number } | null>(null)
  const lastRestoredFileRef = useRef<string | null>(null)
  const viewportDebounceRef = useRef<number | null>(null)
  const operationStateRef = useRef({ nodes, edges, selectedId, aiBusy, structureType })
  operationStateRef.current = { nodes, edges, selectedId, aiBusy, structureType }

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

  const { save, hiddenFlowRef, hiddenRfInstanceRef } = useMindmapPersistence()
  const generatePalace = usePalaceGeneration({ nodes, edges, selectedId, editor })

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

  useEffect(() => {
    if (contextMenu.scope === 'closed') return
    const dismiss = (event: Event) => {
      const target = event.target
      if (target instanceof window.Node && contextMenuRef.current?.contains(target)) return
      setContextMenu({ scope: 'closed' })
    }
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu({ scope: 'closed' })
    }
    window.addEventListener('mousedown', dismiss, true)
    window.addEventListener('scroll', dismiss, true)
    window.addEventListener('keydown', dismissWithEscape)
    return () => {
      window.removeEventListener('mousedown', dismiss, true)
      window.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('keydown', dismissWithEscape)
    }
  }, [contextMenu.scope])

  const openContextMenu = useCallback((menu: ContextMenuState) => setContextMenu(menu), [])
  const onPaneContextMenu = useCallback(
    (event: FlowContextEvent) => {
      event.preventDefault()
      openContextMenu({ clientX: event.clientX, clientY: event.clientY, scope: 'pane' })
    },
    [openContextMenu],
  )
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

  useShortcut({
    id: 'mindmap.addChild',
    combo: 'mod+enter',
    description: '添加子主题',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.addChild,
  })
  useShortcut({
    id: 'mindmap.addSibling',
    combo: 'mod+shift+enter',
    description: '添加同级主题',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: () => shortcutsEnabled() && canAddSibling,
    handler: controller.addSibling,
  })
  useShortcut({
    id: 'mindmap.delete',
    combo: 'delete',
    description: '删除选中节点（含子树）',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.removeSelected,
  })
  useShortcut({
    id: 'mindmap.backspace',
    combo: 'backspace',
    description: '删除选中节点（含子树）',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.removeSelected,
  })
  useShortcut({
    id: 'mindmap.edit',
    combo: 'f2',
    description: '编辑选中节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: () => {
      if (selectedId) controller.startEditing(selectedId)
    },
  })
  useShortcut({
    id: 'mindmap.reset',
    combo: 'mod+shift+r',
    description: '重置为示例导图',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.reset,
  })
  useShortcut({
    id: 'mindmap.navLeft',
    combo: 'arrowleft',
    description: '选中父节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.navigateLeft,
  })
  useShortcut({
    id: 'mindmap.navRight',
    combo: 'arrowright',
    description: '选中第一个子节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.navigateRight,
  })
  useShortcut({
    id: 'mindmap.navUp',
    combo: 'arrowup',
    description: '选中上方兄弟节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.navigateUp,
  })
  useShortcut({
    id: 'mindmap.navDown',
    combo: 'arrowdown',
    description: '选中下方兄弟节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.navigateDown,
  })
  useShortcut({
    id: 'mindmap.centerRoot',
    combo: 'mod+0',
    description: '回到中心主题',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: () => void controller.centerRoot(),
  })
  useShortcut({
    id: 'mindmap.undo',
    combo: 'mod+z',
    description: '撤销',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.undo,
  })
  useShortcut({
    id: 'mindmap.redo',
    combo: 'mod+shift+z',
    description: '重做',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: shortcutsEnabled,
    handler: controller.redo,
  })
  useShortcut({
    id: 'mindmap.save',
    combo: 'mod+s',
    description: '保存文件',
    group: 'mindmap',
    preventWhenTyping: false,
    enabled: shortcutsEnabled,
    handler: () => void save(),
  })

  const previousStructureTypeRef = useRef(structureType)
  useEffect(() => {
    if (previousStructureTypeRef.current === structureType) return
    previousStructureTypeRef.current = structureType
    editor.setStructureType(structureType)
    const timer = window.setTimeout(() => reactFlow.fitView({ padding: 0.2, duration: 300 }), 50)
    return () => window.clearTimeout(timer)
  }, [editor, reactFlow, structureType])

  return {
    nodes,
    edges,
    nodeTypes,
    edgeTypes,
    aiBusy,
    palaceEnabled,
    selectedTopicCount: selectedTopicIds.length,
    contextMenu,
    contextMenuRef,
    palaceModal,
    stylePanelOpen,
    documentRefsPanelOpen,
    hasDocumentRefs: documentRefs.length > 0,
    canAddChild: hasSelection,
    canAddSibling,
    canRemove,
    canUndo,
    canRedo,
    hiddenFlowRef,
    hiddenRfInstanceRef,
    canvas: {
      onNodesChange: controller.handleNodesChange,
      onEdgesChange: controller.handleEdgesChange,
      onConnect: controller.handleConnect,
      onNodeClick,
      onPaneContextMenu,
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
      removeSelected: controller.removeSelected,
      reset: controller.reset,
      undo: controller.undo,
      redo: controller.redo,
      save,
      centerRoot: controller.centerRoot,
      generatePalace,
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
