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
import { useShortcut } from '@/shared/shortcuts/useRegisterShortcut'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useActiveMindmapEditor } from './useActiveMindmapEditor'
import { useActiveMindmapInstance } from './useActiveMindmapInstance'
import { useActiveMindmapStore } from './useActiveMindmapStore'
import { useMindmapPersistence } from './useMindmapPersistence'
import { usePalaceGeneration } from './usePalaceGeneration'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { MindmapEdge } from '@/features/mindmap/edges/MindmapEdge'
import { isDefaultViewport } from '@/shared/lib/fileFormat'
import { collectDescendantIds, collectSubtreeIds, findParentId } from '@/shared/lib/mindmapTree'
import { assetFromDataUrl } from '@/shared/lib/mindmapXml/asset'
import { createMindmapOperationController } from '@/features/mindmap/model/mindmapOperationController'
import type { ContextMenuState } from '@/features/mindmap/components/MindMapContextMenu'
import type { PalaceNodeData } from '@/features/mindmap/nodes/palace/types'

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
  const aiBusy = useAiStore(selectCurrentChatBusy)
  const capabilities = useSettingsStore((state) => state.capabilities)
  const palaceEnabled = capabilities.includes('imageGen') && capabilities.includes('vision')
  const structureType = useActiveMindmapStore((state) => state.style.structureType)
  const visualVariant = useActiveMindmapStore((state) => state.style.visualVariant)
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

  // 折叠节点的整棵子树在渲染层隐藏（数据完整保留，仅 CSS 隐藏）。
  // 折叠节点自身保持可见（展开按钮仍在）；xyflow 会为节点包装器写入内联
  // visibility: visible（节点测量完成即可见），类名规则压不过内联样式，
  // 因此对隐藏节点同时注入 style 覆盖（node.style 在 xyflow 内联样式之后展开）。
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
  // 隐藏子树内部的边一并从渲染层移除，避免悬挂边指向空位
  const canvasEdges = useMemo(
    () => edges.filter((e) => !hiddenNodeIds.has(e.source) && !hiddenNodeIds.has(e.target)),
    [edges, hiddenNodeIds],
  )

  const { save, hiddenFlowRef, hiddenRfInstanceRef } = useMindmapPersistence()
  const generatePalace = usePalaceGeneration({ nodes, edges, selectedId, editor, visualVariant })

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

  // 本地图片插入：读文件转 base64 → sha256 去重 → addAsset → image 节点
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
            useAiStore.getState().setError('图片读取失败')
            return
          }
          void (async () => {
            const asset = await assetFromDataUrl(dataUrl)
            if (!asset) {
              useAiStore.getState().setError('图片格式不支持')
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
        reader.onerror = () => useAiStore.getState().setError('图片读取失败')
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

  // 视觉变体切换（间距不同）需重新布局；结构未变时仅重排位置
  const previousVisualVariantRef = useRef(visualVariant)
  useEffect(() => {
    if (previousVisualVariantRef.current === visualVariant) return
    previousVisualVariantRef.current = visualVariant
    editor.reflow()
  }, [editor, visualVariant])

  return {
    nodes: canvasNodes,
    edges: canvasEdges,
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
