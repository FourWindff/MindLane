import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react'
import { toPng } from 'html-to-image'
import { useShortcut } from '@/shared/shortcuts/useRegisterShortcut'
import {
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useOnSelectionChange,
  useReactFlow,
  useStoreApi,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MindMapHeader } from '@/features/mindmap/components/MindMapHeader'
import { PalaceModal } from '@/features/mindmap/components/PalaceModal'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { useActiveMindmapInstance } from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useAiStore } from '@/features/chat/model/aiStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import { isDefaultViewport } from '@/shared/lib/fileFormat'
import {
  collectSubtreeIds,
  findParentId,
  findRootNode,
  getChildIdsOrdered,
  newId,
  CHILD_OFFSET_X,
} from '@/shared/lib/mindmapTree'
import type { PalaceNodeData } from '../nodes/palace/types'
import type { MindmapCommand } from '@/features/mindmap/model/types'
import { MindmapEdge } from '@/features/mindmap/edges/MindmapEdge'
import { MindMapContextMenu, type ContextMenuState } from './MindMapContextMenu'
import { AiProgressOverlay } from './AiProgressOverlay'
import { SelectionActionBar } from './SelectionActionBar'
import { HiddenThumbnailFlow } from './HiddenThumbnailFlow'
import { StyleProvider } from '@/features/mindmap/style/StyleContext'
import { useStyleStore } from '@/features/mindmap/style/styleStore'
import { StylePanel } from './StylePanel'

type FlowContextEvent = ReactMouseEvent | globalThis.MouseEvent

function MindMapCanvas({
  onSwitchWorkspace,
  onOpenSettings,
}: {
  onSwitchWorkspace?: () => void
  onOpenSettings?: () => void
}) {
  const nodeTypes = useMemo(() => nodeRegistry.toReactFlowNodeTypes(), [])
  const edgeTypes = useMemo(() => ({ mindmap: MindmapEdge }), [])
  const rfStore = useStoreApi()
  const rf = useReactFlow()

  const structureType = useStyleStore((s) => s.mapStyle).startsWith('mindmap')
    ? ('mindmap' as const)
    : ('logic' as const)
  // ref 始终指向最新的 structureType，避免 useCallback 闭包读到过期值
  const structureTypeRef = useRef(structureType)
  useEffect(() => {
    structureTypeRef.current = structureType
  }, [structureType])
  const [stylePanelOpen, setStylePanelOpen] = useState(false)

  const nodes = useActiveMindmapStore((s) => s.nodes)
  const edges = useActiveMindmapStore((s) => s.edges)
  const canUndo = useActiveMindmapStore((s) => s.canUndo)
  const canRedo = useActiveMindmapStore((s) => s.canRedo)
  const editor = useActiveMindmapEditor()
  const activeInstance = useActiveMindmapInstance()
  const aiBusy = useAiStore((s) => s.busy)
  const apiKey = useSettingsStore((s) => s.apiKey)
  const chatModel = useSettingsStore((s) => s.chatModel)
  const capabilities = useSettingsStore((s) => s.capabilities)
  const palaceEnabled = capabilities.includes('imageGen') && capabilities.includes('vision')
  const autoSaveIntervalMs = useSettingsStore((s) => s.autoSaveIntervalMs)
  const dirty = useActiveMindmapStore((s) => s.dirty)
  const filePath = useActiveMindmapStore((s) => s.filePath)
  const hasDocumentOpen = useActiveMindmapStore((s) => s.hasDocumentOpen)
  const syncAfterFileSaved = useWorkspaceStore((s) => s.syncAfterFileSaved)
  const updateFilePreviewUrl = useWorkspaceStore((s) => s.updateFilePreviewUrl)

  const [selectedId, setSelectedId] = useState<string | null>('root')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [hasSelection, setHasSelection] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({ scope: 'closed' })
  const [palaceModal, setPalaceModal] = useState<PalaceNodeData | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const graphRef = useRef({ nodes, edges })
  const lastRestoredFileRef = useRef<string | null>(null)
  const viewportDebounceRef = useRef<number | null>(null)

  useEffect(() => {
    graphRef.current = { nodes, edges }
  }, [nodes, edges])

  useEffect(() => {
    if (!hasDocumentOpen || nodes.length === 0) return
    if (lastRestoredFileRef.current === filePath) return
    lastRestoredFileRef.current = filePath

    const vp = activeInstance.store.getState().viewport
    if (isDefaultViewport(vp)) {
      rf.fitView({ padding: 0.2, duration: 300 })
    } else {
      rf.setViewport(vp)
    }
  }, [filePath, hasDocumentOpen, nodes.length, rf, activeInstance.store])

  const handleInit = useCallback(
    (instance: ReactFlowInstance) => {
      const vp = activeInstance.store.getState().viewport
      if (!isDefaultViewport(vp)) {
        instance.setViewport(vp)
      }
    },
    [activeInstance.store],
  )

  const handleMoveEnd = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      if (viewportDebounceRef.current) {
        window.clearTimeout(viewportDebounceRef.current)
      }
      viewportDebounceRef.current = window.setTimeout(() => {
        viewportDebounceRef.current = null
        activeInstance.store.getState().setViewport(viewport)
      }, 200)
    },
    [activeInstance.store],
  )

  const handleNodesChange = useCallback(
    (changes: import('@xyflow/react').NodeChange[]) => {
      editor.applyNativeNodeChanges(changes, structureTypeRef.current)
    },
    [editor],
  )

  const handleEdgesChange = useCallback(
    (changes: import('@xyflow/react').EdgeChange[]) => {
      editor.applyNativeEdgeChanges(changes)
    },
    [editor],
  )

  const handleConnect = useCallback(
    (connection: import('@xyflow/react').Connection) => {
      editor.applyNativeConnect(connection)
    },
    [editor],
  )

  const startEditing = useCallback(
    (nodeId: string) => {
      if (aiBusy) return
      editor.setNodeEditing(nodeId, true)
    },
    [aiBusy, editor],
  )

  const lastClickRef = useRef<{ id: string; time: number } | null>(null)

  const onNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      if (node.type === 'palace') {
        const pd = node.data as PalaceNodeData
        if (pd.generating) return
        if (pd.expanded) {
          setPalaceModal(pd)
        } else {
          editor.setNodeExpanded(node.id, true)
        }
        return
      }
      const now = Date.now()
      const last = lastClickRef.current
      if (last && last.id === node.id && now - last.time < 400) {
        lastClickRef.current = null
        startEditing(node.id)
      } else {
        lastClickRef.current = { id: node.id, time: now }
      }
    },
    [startEditing, editor],
  )

  useEffect(() => {
    return () => {
      if (viewportDebounceRef.current) {
        window.clearTimeout(viewportDebounceRef.current)
        viewportDebounceRef.current = null
      }
    }
  }, [filePath])

  useEffect(() => {
    if (contextMenu.scope === 'closed') return
    const onDismiss = (e: Event) => {
      const t = e.target
      if (t instanceof window.Node && contextMenuRef.current?.contains(t)) return
      setContextMenu({ scope: 'closed' })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu({ scope: 'closed' })
    }
    window.addEventListener('mousedown', onDismiss, true)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDismiss, true)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [contextMenu])

  const openContextMenu = useCallback((next: ContextMenuState) => {
    setContextMenu(next)
  }, [])

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
      if (!node.selected) {
        editor.setNodeSelected(node.id, true)
      }
      openContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        scope: 'node',
        nodeId: node.id,
      })
    },
    [openContextMenu, editor],
  )

  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent, selectedNodes: Node[]) => {
      event.preventDefault()
      if (selectedNodes.length === 0) return
      const prime = selectedNodes[0]!
      setSelectedId(prime.id)
      openContextMenu({
        clientX: event.clientX,
        clientY: event.clientY,
        scope: 'node',
        nodeId: prime.id,
      })
    },
    [openContextMenu],
  )

  const onEdgeContextMenu = useCallback((_event: ReactMouseEvent) => {
    _event.preventDefault()
  }, [])

  const mindmapShortcutsEnabled = useCallback(() => !aiBusy, [aiBusy])

  const handleSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    setSelectedId(sel[0]?.id ?? null)
    setSelectedTopicIds(sel.filter((n) => n.type === 'text').map((n) => n.id))
    setHasSelection(sel.length > 0)
  }, [])

  useOnSelectionChange({ onChange: handleSelectionChange })

  const addChild = useCallback(() => {
    if (aiBusy) return
    editor.addChild(selectedId ?? 'root')
  }, [aiBusy, editor, selectedId])

  const addSibling = useCallback(() => {
    if (aiBusy || !selectedId) return
    editor.addSibling(selectedId)
  }, [aiBusy, editor, selectedId])

  const selectNode = useCallback(
    (targetId: string) => {
      setSelectedId(targetId)
      editor.setNodeSelected(targetId, true)
      rfStore.setState({ nodesSelectionActive: false })
    },
    [editor, rfStore],
  )

  const removeSelected = useCallback(() => {
    if (aiBusy) return

    const targets = nodes.filter((n) => n.selected && n.id !== 'root' && !n.data?.exiting)
    if (targets.length === 0) return

    const allIds = new Set<string>()
    for (const t of targets) {
      for (const id of collectSubtreeIds(edges, t.id)) allIds.add(id)
    }

    const primaryId = targets[0]!.id
    const parentId = findParentId(edges, primaryId)
    let nextSelectedId = parentId ?? 'root'
    if (parentId) {
      const siblings = getChildIdsOrdered(nodes, edges, parentId)
      const surviving = siblings.find((id) => !allIds.has(id))
      if (surviving) nextSelectedId = surviving
    }
    if (allIds.has(nextSelectedId)) nextSelectedId = 'root'
    selectNode(nextSelectedId)

    editor.deleteSubtrees(targets.map((t) => t.id))
  }, [aiBusy, editor, edges, nodes, selectNode])

  const reset = useCallback(() => {
    if (aiBusy) return
    editor.reset()
    setSelectedId('root')
  }, [aiBusy, editor])

  const navigateLeft = useCallback(() => {
    if (!selectedId) return
    const parentId = findParentId(edges, selectedId)
    if (parentId) selectNode(parentId)
  }, [edges, selectedId, selectNode])

  const navigateRight = useCallback(() => {
    if (!selectedId) return
    const children = getChildIdsOrdered(nodes, edges, selectedId)
    if (children.length > 0) selectNode(children[0]!)
  }, [nodes, edges, selectedId, selectNode])

  const navigateUp = useCallback(() => {
    if (!selectedId) return
    const parentId = findParentId(edges, selectedId)
    if (!parentId) return
    const siblings = getChildIdsOrdered(nodes, edges, parentId)
    const idx = siblings.indexOf(selectedId)
    if (idx > 0) selectNode(siblings[idx - 1]!)
  }, [nodes, edges, selectedId, selectNode])

  const navigateDown = useCallback(() => {
    if (!selectedId) return
    const parentId = findParentId(edges, selectedId)
    if (!parentId) return
    const siblings = getChildIdsOrdered(nodes, edges, parentId)
    const idx = siblings.indexOf(selectedId)
    if (idx >= 0 && idx < siblings.length - 1) selectNode(siblings[idx + 1]!)
  }, [nodes, edges, selectedId, selectNode])

  const centerRoot = useCallback(async () => {
    const rootNode =
      rf.getNode('root') ??
      (() => {
        const r = findRootNode(nodes, edges)
        return r ? rf.getNode(r.id) : undefined
      })()

    if (!rootNode) return

    const width = rootNode.measured?.width ?? 160
    const height = rootNode.measured?.height ?? 40
    const centerX = rootNode.position.x + width / 2
    const centerY = rootNode.position.y + height / 2

    await rf.setCenter(centerX, centerY, { zoom: 1, duration: 300 })
    activeInstance.store.getState().setViewport(rf.getViewport())
  }, [rf, nodes, edges, activeInstance.store])

  const handleUndo = useCallback(() => {
    if (aiBusy) return
    editor.undo()
  }, [aiBusy, editor])

  const handleRedo = useCallback(() => {
    if (aiBusy) return
    editor.redo()
  }, [aiBusy, editor])

  const canAddChild = hasSelection

  const canAddSibling = useMemo(() => {
    if (!selectedId) return false
    return findParentId(edges, selectedId) != null
  }, [edges, selectedId])

  useShortcut({
    id: 'mindmap.addChild',
    combo: 'mod+enter',
    description: '添加子主题',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      addChild()
    },
  })
  useShortcut({
    id: 'mindmap.addSibling',
    combo: 'mod+shift+enter',
    description: '添加同级主题',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: () => mindmapShortcutsEnabled() && canAddSibling,
    handler: () => {
      addSibling()
    },
  })
  useShortcut({
    id: 'mindmap.delete',
    combo: 'delete',
    description: '删除选中节点（含子树）',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      removeSelected()
    },
  })
  useShortcut({
    id: 'mindmap.backspace',
    combo: 'backspace',
    description: '删除选中节点（含子树）',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      removeSelected()
    },
  })
  useShortcut({
    id: 'mindmap.edit',
    combo: 'f2',
    description: '编辑选中节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      if (selectedId) startEditing(selectedId)
    },
  })
  useShortcut({
    id: 'mindmap.reset',
    combo: 'mod+shift+r',
    description: '重置为示例导图',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      reset()
    },
  })
  useShortcut({
    id: 'mindmap.navLeft',
    combo: 'arrowleft',
    description: '选中父节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      navigateLeft()
    },
  })
  useShortcut({
    id: 'mindmap.navRight',
    combo: 'arrowright',
    description: '选中第一个子节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      navigateRight()
    },
  })
  useShortcut({
    id: 'mindmap.navUp',
    combo: 'arrowup',
    description: '选中上方兄弟节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      navigateUp()
    },
  })
  useShortcut({
    id: 'mindmap.navDown',
    combo: 'arrowdown',
    description: '选中下方兄弟节点',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      navigateDown()
    },
  })
  useShortcut({
    id: 'mindmap.centerRoot',
    combo: 'mod+0',
    description: '回到中心主题',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      centerRoot()
    },
  })
  useShortcut({
    id: 'mindmap.undo',
    combo: 'mod+z',
    description: '撤销',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      handleUndo()
    },
  })
  useShortcut({
    id: 'mindmap.redo',
    combo: 'mod+shift+z',
    description: '重做',
    group: 'mindmap',
    preventWhenTyping: true,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      handleRedo()
    },
  })

  const hiddenFlowRef = useRef<HTMLDivElement>(null)
  const hiddenRfInstanceRef = useRef<ReactFlowInstance | null>(null)

  const generateThumbnail = useCallback(async (filePath: string): Promise<string | null> => {
    try {
      const hiddenWrap = hiddenFlowRef.current
      if (!hiddenWrap) return null

      const hiddenFlow = hiddenWrap.querySelector('.react-flow') as HTMLElement | null
      if (!hiddenFlow) return null

      const rf = hiddenRfInstanceRef.current
      if (rf) {
        rf.fitView({ padding: 0.2, duration: 0 })
      }

      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

      const dataUrl = await toPng(hiddenFlow, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        style: { backgroundImage: 'none' },
        filter: (node) => {
          const cls = node.classList
          if (!cls) return true
          return !cls.contains('react-flow__background') && !cls.contains('mindmap-minimap')
        },
      })

      const result = await window.mindlane?.file.saveThumbnail({ filePath, imageData: dataUrl })
      if (result?.ok) {
        return result.data.previewUrl
      }
      return null
    } catch (e) {
      // 预览图生成失败静默忽略，不影响保存流程
      console.warn('[MindLane] 预览图生成失败：', e)
      return null
    }
  }, [])

  const doSave = useCallback(async () => {
    const store = activeInstance.store.getState()
    const ai = useAiStore.getState()
    try {
      const data = store.toMindLaneFile()
      const result = await window.mindlane?.file.save({ filePath: store.filePath, data })
      if (result?.ok) {
        store.setFilePath(result.data.filePath)
        store.markClean()
        await syncAfterFileSaved(result.data.filePath)

        // 预览图生成不阻塞保存流程
        void generateThumbnail(result.data.filePath).then((previewUrl) => {
          if (previewUrl) {
            updateFilePreviewUrl(result.data.filePath, previewUrl)
          }
        })
      }
    } catch (e) {
      console.error('[MindLane] 保存失败：', e)
      ai.setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [syncAfterFileSaved, generateThumbnail, updateFilePreviewUrl, activeInstance.store])

  void aiBusy

  useShortcut({
    id: 'mindmap.save',
    combo: 'mod+s',
    description: '保存文件',
    group: 'mindmap',
    preventWhenTyping: false,
    enabled: mindmapShortcutsEnabled,
    handler: () => {
      doSave()
    },
  })

  useEffect(() => {
    if (!hasDocumentOpen || !dirty || !filePath || aiBusy) return
    if (autoSaveIntervalMs <= 0) return

    const timer = window.setTimeout(() => {
      void doSave()
    }, autoSaveIntervalMs)

    return () => window.clearTimeout(timer)
  }, [aiBusy, autoSaveIntervalMs, dirty, doSave, filePath, hasDocumentOpen])

  const canRemove = Boolean(selectedId && selectedId !== 'root')

  const generatePalace = useCallback(async () => {
    if (aiBusy) return

    const ai = useAiStore.getState()
    const settings = useSettingsStore.getState()

    const mindlane = typeof window !== 'undefined' ? window.mindlane : undefined
    if (!mindlane) {
      ai.setError('IPC 通道不可用，请确认 Electron 环境')
      return
    }

    const backendSettings = await mindlane.settings.load()
    const currentKey = backendSettings?.apiKey || apiKey || settings.apiKey
    const currentModel =
      backendSettings?.chatModel || chatModel || settings.chatModel || 'qwen-turbo'

    if (!currentKey) {
      ai.setError('请先在右侧「设置」面板中填写 API Key')
      return
    }

    let selectedNodes = nodes
      .filter((n) => n.selected && n.type === 'text')
      .map((n) => ({ id: n.id, label: String(n.data?.label ?? '') }))

    if (selectedNodes.length === 0 && selectedId) {
      const target = nodes.find((n) => n.id === selectedId)
      if (target && target.type === 'text') {
        selectedNodes = [{ id: target.id, label: String(target.data?.label ?? '') }]
      }
    }
    if (selectedNodes.length === 0) {
      ai.setError('未选中任何主题节点')
      return
    }

    const palaceId = newId()
    const parentId = findParentId(edges, selectedNodes[0]?.id ?? '') ?? 'root'
    const parentNode = nodes.find((n) => n.id === parentId)
    const firstSelected = nodes.find((n) => n.id === selectedNodes[0]?.id)

    const placeholderNode: Node = {
      id: palaceId,
      type: 'palace',
      position: {
        x: firstSelected?.position.x ?? (parentNode?.position.x ?? 0) + CHILD_OFFSET_X,
        y: firstSelected?.position.y ?? parentNode?.position.y ?? 0,
      },
      data: {
        label: '生成中…',
        imageUrl: '',
        stations: [],
        sourceNodeIds: selectedNodes.map((n) => n.id),
        generating: true,
      },
    }

    const treeEdge: Edge = {
      id: `e-${parentId}-${palaceId}`,
      source: parentId,
      target: palaceId,
      type: 'mindmap',
      className: 'mindmap-edge',
    }

    const selectedIdSet = new Set(selectedNodes.map((n) => n.id))
    const rollbackPalaceGeneration = () => {
      editor.undo()
      for (const id of selectedIdSet) {
        editor.clearNodeFlag(id, 'processing')
      }
    }

    const childEdges: Edge[] = selectedNodes.map((n) => ({
      id: `e-${palaceId}-${n.id}`,
      source: palaceId,
      target: n.id,
      type: 'mindmap',
      className: 'mindmap-edge',
    }))

    const edgesToRemove = edges.filter((e) => e.source === parentId && selectedIdSet.has(e.target))

    for (const id of selectedIdSet) {
      editor.setNodeFlag(id, 'processing', true)
    }

    const commands: MindmapCommand[] = [
      { type: 'addNode', node: placeholderNode, edge: treeEdge },
      ...childEdges.map((edge) => ({ type: 'addEdge' as const, edge })),
      ...edgesToRemove.map((edge) => ({ type: 'removeEdge' as const, edgeId: edge.id })),
    ]
    editor.batch(commands)

    ai.setBusy(true)
    ai.setStep('analyzing')

    try {
      const OVERALL_TIMEOUT = 120_000
      const result = await Promise.race([
        mindlane.ai.nodesToPalace({
          apiKey: currentKey,
          model: currentModel,
          selectedNodes,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), OVERALL_TIMEOUT)),
      ])

      if (!result) {
        rollbackPalaceGeneration()
        ai.setError('生成超时（超过 2 分钟），请检查网络后重试')
        return
      }

      if (!result.ok) {
        rollbackPalaceGeneration()
        const errMsg = (result as { ok: false; error: string }).error || '生成失败（未知错误）'
        ai.setError(`AI 返回错误：${errMsg}`)
        return
      }

      editor.batch([
        {
          type: 'updateNode',
          nodeId: palaceId,
          patch: (n) => ({
            ...n,
            data: {
              label: result.label,
              imageUrl: result.imageUrl,
              stations: result.stations,
              sourceNodeIds: result.sourceNodeIds,
              expanded: true,
              generating: undefined,
            },
          }),
        },
        ...[...selectedIdSet].map((nodeId) => ({
          type: 'updateNode' as const,
          nodeId,
          patch: (n: Node) => ({ ...n, data: { ...n.data, processing: undefined } }),
        })),
      ])
      ai.reset()
    } catch (e) {
      rollbackPalaceGeneration()
      ai.setError(`生成异常：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [aiBusy, apiKey, chatModel, selectedId, nodes, edges, editor])

  // 布局类型切换时重新排布整棵树
  const prevStructureTypeRef = useRef(structureType)
  useEffect(() => {
    if (prevStructureTypeRef.current === structureType) return
    prevStructureTypeRef.current = structureType

    editor.setStructureType(structureType)
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50)
  }, [structureType, editor, rf])

  return (
    <div className="mindmap-shell">
      <MindMapHeader
        onAddChild={addChild}
        onAddSibling={addSibling}
        onRemove={removeSelected}
        onReset={reset}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenSettings={onOpenSettings}
        onSwitchWorkspace={onSwitchWorkspace}
        onSave={doSave}
        onCenterRoot={centerRoot}
        onToggleStylePanel={() => setStylePanelOpen((v) => !v)}
        canAddChild={canAddChild}
        canAddSibling={canAddSibling}
        canRemove={canRemove}
        canUndo={canUndo}
        canRedo={canRedo}
        stylePanelOpen={stylePanelOpen}
        stylePanel={stylePanelOpen ? <StylePanel onClose={() => setStylePanelOpen(false)} /> : null}
      />
      <div className="mindmap-canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={aiBusy ? undefined : handleNodesChange}
          onEdgesChange={aiBusy ? undefined : handleEdgesChange}
          onConnect={aiBusy ? undefined : handleConnect}
          onNodeClick={onNodeClick}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onSelectionContextMenu={onSelectionContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          selectionOnDrag
          panOnDrag={[1]}
          selectionMode={SelectionMode.Partial}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          nodesDraggable={!aiBusy}
          nodesConnectable={!aiBusy}
          elementsSelectable={!aiBusy}
          onMoveEnd={handleMoveEnd}
          onInit={handleInit}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Controls showInteractive={false} />
          <MiniMap nodeStrokeWidth={3} zoomable pannable className="mindmap-minimap" />
        </ReactFlow>
        <SelectionActionBar
          selectedTopicCount={selectedTopicIds.length}
          onGeneratePalace={generatePalace}
          aiBusy={aiBusy}
          palaceEnabled={palaceEnabled}
        />
        <AiProgressOverlay />
        {contextMenu ? (
          <MindMapContextMenu
            menu={contextMenu}
            menuRef={contextMenuRef}
            onClose={() => setContextMenu({ scope: 'closed' })}
            onAddChild={addChild}
            onAddSibling={addSibling}
            onRemove={removeSelected}
            onReset={reset}
            onGeneratePalace={generatePalace}
            canAddSibling={canAddSibling}
            canRemove={canRemove}
            aiBusy={aiBusy}
            selectedCount={selectedTopicIds.length || 1}
            palaceEnabled={palaceEnabled}
          />
        ) : null}
        {palaceModal && <PalaceModal data={palaceModal} onClose={() => setPalaceModal(null)} />}
      </div>
      <div
        ref={hiddenFlowRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: '1200px',
          height: '800px',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: -1,
        }}
      >
        <ReactFlowProvider>
          <HiddenThumbnailFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onInit={hiddenRfInstanceRef}
          />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

export function MindMapView({
  onSwitchWorkspace,
  onOpenSettings,
}: {
  onSwitchWorkspace?: () => void
  onOpenSettings?: () => void
}) {
  return (
    <StyleProvider>
      <ReactFlowProvider>
        <MindMapCanvas onSwitchWorkspace={onSwitchWorkspace} onOpenSettings={onOpenSettings} />
      </ReactFlowProvider>
    </StyleProvider>
  )
}
