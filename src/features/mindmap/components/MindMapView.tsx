import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { useShortcut } from '@/shared/shortcuts'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useOnSelectionChange,
  type Edge,
  type Node,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MindMapHeader } from '@/features/mindmap/components/MindMapHeader'
import { PalaceModal } from '@/features/mindmap/components/PalaceModal'
import { nodeRegistry } from '@/features/mindmap/nodes'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { useAiStore, type AiPipelineStep } from '@/features/chat/model/aiStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import { autoLayout } from '@/shared/lib/autoLayout'
import {
  collectSubtreeIds,
  createInitialEdges,
  createInitialNodes,
  deleteSubtree,
  findParentId,
  newId,
  reflowChildren,
  withNewChild,
  withNewSibling,
} from '@/shared/lib/mindmapTree'

const CHILD_OFFSET_X = 260
const CHILD_GAP_Y = 24
const NODE_EXIT_MS = 300

type FlowContextEvent = ReactMouseEvent | globalThis.MouseEvent

type ContextMenuState =
  | { clientX: number; clientY: number; scope: 'pane' }
  | { clientX: number; clientY: number; scope: 'node'; nodeId: string }

type ContextMenuProps = {
  menu: ContextMenuState
  menuRef: RefObject<HTMLDivElement>
  onClose: () => void
  onAddChild: () => void
  onAddSibling: () => void
  onRemove: () => void
  onReset: () => void
  onGeneratePalace?: () => void
  canAddSibling: boolean
  canRemove: boolean
  aiBusy: boolean
  selectedCount: number
}

function MindMapContextMenu({
  menu,
  menuRef,
  onClose,
  onAddChild,
  onAddSibling,
  onRemove,
  onReset,
  onGeneratePalace,
  canAddSibling,
  canRemove,
  aiBusy,
  selectedCount,
}: ContextMenuProps) {
  const run = (fn: () => void) => {
    fn()
    onClose()
  }

  const vw = typeof window !== 'undefined' ? window.innerWidth : 0
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0
  const menuW = 200
  const menuH = 280
  const left = Math.min(menu.clientX, Math.max(8, vw - menuW - 8))
  const top = Math.min(menu.clientY, Math.max(8, vh - menuH - 8))

  return (
    <div
      ref={menuRef}
      className="mindmap-ctx"
      style={{ left, top }}
      role="menu"
      aria-label="导图菜单"
    >
      <button type="button" className="mindmap-ctx__item" role="menuitem" onClick={() => run(onAddChild)} disabled={aiBusy}>
        子主题
      </button>
      <button
        type="button"
        className="mindmap-ctx__item"
        role="menuitem"
        onClick={() => run(onAddSibling)}
        disabled={!canAddSibling || aiBusy}
      >
        同级
      </button>
      <button
        type="button"
        className="mindmap-ctx__item mindmap-ctx__item--danger"
        role="menuitem"
        onClick={() => run(onRemove)}
        disabled={!canRemove || aiBusy}
      >
        删除
      </button>
      {menu.scope === 'node' && (
        <>
          <div className="mindmap-ctx__sep" role="separator" />
          <button
            type="button"
            className="mindmap-ctx__item mindmap-ctx__item--accent"
            role="menuitem"
            onClick={() => run(() => onGeneratePalace?.())}
            disabled={!onGeneratePalace || aiBusy}
          >
            生成记忆宫殿{selectedCount > 1 ? ` (${selectedCount} 节点)` : ''}
          </button>
        </>
      )}
      <div className="mindmap-ctx__sep" role="separator" />
      <button type="button" className="mindmap-ctx__item mindmap-ctx__item--muted" role="menuitem" onClick={() => run(onReset)} disabled={aiBusy}>
        重置
      </button>
    </div>
  )
}

function stepDisplayName(step: AiPipelineStep): string {
  switch (step) {
    case 'analyzing': return '分析节点内容…'
    case 'planning': return '规划记忆路线…'
    case 'generating-image': return '生成宫殿图片…'
    case 'building': return '构建宫殿节点…'
    case 'reading-doc': return '读取文档…'
    case 'extracting': return 'AI 提取结构…'
    case 'generating-map': return '生成思维导图…'
    case 'chatting': return 'AI 对话中…'
    default: return '处理中…'
  }
}

function AiProgressOverlay() {
  const busy = useAiStore((s) => s.busy)
  const step = useAiStore((s) => s.step)
  const errorMessage = useAiStore((s) => s.errorMessage)
  const clearError = useAiStore((s) => s.clearError)

  if (errorMessage) {
    return (
      <div className="ai-progress-overlay">
        <div className="ai-progress-overlay__card ai-progress-overlay__card--error" onClick={clearError}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden>
            <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10 6v5M10 13v1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <span className="ai-progress-overlay__text">{errorMessage}</span>
          <span className="ai-progress-overlay__dismiss">点击关闭</span>
        </div>
      </div>
    )
  }

  if (!busy || step === 'idle') return null

  return (
    <div className="ai-progress-overlay">
      <div className="ai-progress-overlay__card">
        <div className="ai-progress-overlay__spinner" />
        <span className="ai-progress-overlay__text">{stepDisplayName(step)}</span>
      </div>
    </div>
  )
}

function SelectionActionBar({
  selectedTopicCount,
  onGeneratePalace,
  aiBusy,
}: {
  selectedTopicCount: number
  onGeneratePalace: () => void
  aiBusy: boolean
}) {
  if (selectedTopicCount < 1 || aiBusy) return null

  return (
    <div className="selection-bar">
      <span className="selection-bar__count">已选 {selectedTopicCount} 个主题</span>
      <button
        type="button"
        className="selection-bar__btn"
        onClick={onGeneratePalace}
      >
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden>
          <path fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            d="M2 16h16M4 16V6l6-3.5L16 6v10M8 16v-5h4v5" />
        </svg>
        生成记忆宫殿
      </button>
    </div>
  )
}

function MindMapCanvas({
  onSwitchWorkspace,
  onOpenSettings,
}: {
  onSwitchWorkspace?: () => void
  onOpenSettings?: () => void
}) {
  const nodeTypes = useMemo(() => nodeRegistry.toReactFlowNodeTypes(), [])

  const nodes = useMindmapStore((s) => s.nodes)
  const edges = useMindmapStore((s) => s.edges)
  const setNodes = useMindmapStore((s) => s.setNodes)
  const setEdges = useMindmapStore((s) => s.setEdges)
  const onNodesChange = useMindmapStore((s) => s.onNodesChange)
  const onEdgesChange = useMindmapStore((s) => s.onEdgesChange)
  const onConnect = useMindmapStore((s) => s.onConnect)
  const aiBusy = useAiStore((s) => s.busy)
  const apiKey = useSettingsStore((s) => s.apiKey)
  const chatModel = useSettingsStore((s) => s.chatModel)
  const autoSaveIntervalMs = useSettingsStore((s) => s.autoSaveIntervalMs)
  const dirty = useMindmapStore((s) => s.dirty)
  const filePath = useMindmapStore((s) => s.filePath)
  const hasDocumentOpen = useMindmapStore((s) => s.hasDocumentOpen)
  const syncAfterFileSaved = useWorkspaceStore((s) => s.syncAfterFileSaved)

  const [selectedId, setSelectedId] = useState<string | null>('root')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [palaceModal, setPalaceModal] = useState<import('@/shared/lib/fileFormat').PalaceNodeData | null>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)

  const graphRef = useRef({ nodes, edges })
  const exitTimeoutsRef = useRef<number[]>([])
  const layoutTimerRef = useRef<number | null>(null)
  const isLayoutingRef = useRef(false)

  useEffect(() => {
    graphRef.current = { nodes, edges }
  }, [nodes, edges])

  const handleNodesChange = useCallback(
    (changes: import('@xyflow/react').NodeChange[]) => {
      onNodesChange(changes)

      if (isLayoutingRef.current) return

      const hasDimensionChange = changes.some(
        (c) => c.type === 'dimensions' && c.dimensions,
      )
      if (!hasDimensionChange) return

      const { nodes: curNodes } = useMindmapStore.getState()
      const anyEditing = curNodes.some((n) => n.data.editing)
      if (anyEditing) return

      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current)
      layoutTimerRef.current = window.setTimeout(() => {
        layoutTimerRef.current = null
        const { nodes: latestNodes, edges: curEdges } = useMindmapStore.getState()
        isLayoutingRef.current = true
        const laidOut = reflowChildren('root', latestNodes, curEdges, CHILD_OFFSET_X, CHILD_GAP_Y)
        setNodes(laidOut)
        requestAnimationFrame(() => { isLayoutingRef.current = false })
      }, 60)
    },
    [onNodesChange, setNodes],
  )

  const startEditing = useCallback(
    (nodeId: string) => {
      if (aiBusy) return
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId && n.type === 'topic'
            ? { ...n, data: { ...n.data, editing: true } }
            : n.data.editing
              ? { ...n, data: { ...n.data, editing: undefined } }
              : n,
        ),
      )
    },
    [aiBusy, setNodes],
  )

  const lastClickRef = useRef<{ id: string; time: number } | null>(null)

  const onNodeClick = useCallback(
    (_event: ReactMouseEvent, node: Node) => {
      if (node.type === 'palace') {
        setPalaceModal(node.data as import('@/shared/lib/fileFormat').PalaceNodeData)
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
    [startEditing],
  )

  useEffect(() => {
    return () => {
      exitTimeoutsRef.current.forEach((id) => window.clearTimeout(id))
      exitTimeoutsRef.current = []
    }
  }, [])

  useEffect(() => {
    if (!contextMenu) return
    const onDismiss = (e: Event) => {
      const t = e.target
      if (t instanceof window.Node && contextMenuRef.current?.contains(t)) return
      setContextMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu(null)
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

  const onPaneContextMenu = useCallback((event: FlowContextEvent) => {
    event.preventDefault()
    openContextMenu({ clientX: event.clientX, clientY: event.clientY, scope: 'pane' })
  }, [openContextMenu])

  const onNodeContextMenu = useCallback(
    (event: ReactMouseEvent, node: Node) => {
      event.preventDefault()
      setSelectedId(node.id)
      if (!node.selected) {
        setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === node.id })))
      }
      openContextMenu({ clientX: event.clientX, clientY: event.clientY, scope: 'node', nodeId: node.id })
    },
    [openContextMenu, setNodes],
  )

  const onSelectionContextMenu = useCallback(
    (event: ReactMouseEvent, selectedNodes: Node[]) => {
      event.preventDefault()
      if (selectedNodes.length === 0) return
      const prime = selectedNodes[0]!
      setSelectedId(prime.id)
      openContextMenu({ clientX: event.clientX, clientY: event.clientY, scope: 'node', nodeId: prime.id })
    },
    [openContextMenu],
  )

  const onEdgeContextMenu = useCallback((_event: ReactMouseEvent) => {
    _event.preventDefault()
  }, [])

  const mindmapShortcutsEnabled = useCallback(() => !aiBusy, [aiBusy])

  useOnSelectionChange({
    onChange: ({ nodes: sel }) => {
      setSelectedId(sel[0]?.id ?? null)
      setSelectedTopicIds(sel.filter((n) => n.type === 'topic').map((n) => n.id))
    },
  })

  const addChild = useCallback(() => {
    if (aiBusy) return
    const parentId = selectedId ?? 'root'
    const { nodes: nextNodes, edges: nextEdges } = withNewChild(
      nodes, edges, parentId, { label: '新主题' }, CHILD_OFFSET_X, CHILD_GAP_Y,
    )
    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [aiBusy, edges, nodes, selectedId, setEdges, setNodes])

  const addSibling = useCallback(() => {
    if (aiBusy || !selectedId) return
    const { nodes: nextNodes, edges: nextEdges } = withNewSibling(
      nodes, edges, selectedId, { label: '新主题' }, CHILD_OFFSET_X, CHILD_GAP_Y,
    )
    if (nextNodes === nodes && nextEdges === edges) return
    setNodes(nextNodes)
    setEdges(nextEdges)
  }, [aiBusy, edges, nodes, selectedId, setEdges, setNodes])

  const removeSelected = useCallback(() => {
    if (aiBusy) return
    if (!selectedId || selectedId === 'root') return
    const target = nodes.find((n) => n.id === selectedId)
    if (target?.data?.exiting) return
    const ids = collectSubtreeIds(edges, selectedId)

    setNodes((nds) =>
      nds.map((n) =>
        ids.has(n.id) ? { ...n, data: { ...n.data, exiting: true } } : n,
      ),
    )
    setEdges((eds) =>
      eds.map((e) => {
        const touch = ids.has(e.source) || ids.has(e.target)
        if (!touch) return e
        const parts = new Set(
          [e.className, 'mindmap-edge', 'mindmap-edge--exiting'].join(' ').split(/\s+/).filter(Boolean),
        )
        return { ...e, className: [...parts].join(' ') }
      }),
    )
    setSelectedId('root')

    const removeRoot = selectedId
    let timeoutId = 0
    timeoutId = window.setTimeout(() => {
      exitTimeoutsRef.current = exitTimeoutsRef.current.filter((tid) => tid !== timeoutId)
      const { nodes: n, edges: e } = graphRef.current
      const { nodes: n2, edges: e2 } = deleteSubtree(n, e, removeRoot)
      const laidOut = reflowChildren('root', n2, e2, CHILD_OFFSET_X, CHILD_GAP_Y)
      setNodes(laidOut)
      setEdges(e2)
    }, NODE_EXIT_MS)
    exitTimeoutsRef.current.push(timeoutId)
  }, [aiBusy, edges, nodes, selectedId, setEdges, setNodes])

  const reset = useCallback(() => {
    if (aiBusy) return
    setNodes(createInitialNodes() as Node[])
    setEdges(createInitialEdges())
    setSelectedId('root')
  }, [aiBusy, setEdges, setNodes])

  const canAddSibling = useMemo(() => {
    if (!selectedId) return false
    return findParentId(edges, selectedId) != null
  }, [edges, selectedId])

  useShortcut(
    { id: 'mindmap.addChild', combo: 'mod+enter', description: '添加子主题', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { addChild() } },
    [addChild, mindmapShortcutsEnabled],
  )
  useShortcut(
    { id: 'mindmap.addSibling', combo: 'mod+shift+enter', description: '添加同级主题', group: 'mindmap', preventWhenTyping: true, enabled: () => mindmapShortcutsEnabled() && canAddSibling, handler: () => { addSibling() } },
    [addSibling, canAddSibling, mindmapShortcutsEnabled],
  )
  useShortcut(
    { id: 'mindmap.delete', combo: 'delete', description: '删除选中节点（含子树）', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { removeSelected() } },
    [removeSelected, mindmapShortcutsEnabled],
  )
  useShortcut(
    { id: 'mindmap.backspace', combo: 'backspace', description: '删除选中节点（含子树）', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { removeSelected() } },
    [removeSelected, mindmapShortcutsEnabled],
  )
  useShortcut(
    { id: 'mindmap.edit', combo: 'f2', description: '编辑选中节点', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { if (selectedId) startEditing(selectedId) } },
    [selectedId, startEditing, mindmapShortcutsEnabled],
  )
  useShortcut(
    { id: 'mindmap.reset', combo: 'mod+shift+r', description: '重置为示例导图', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { reset() } },
    [reset, mindmapShortcutsEnabled],
  )

  const doAutoLayout = useCallback(() => {
    if (aiBusy) return
    const laid = autoLayout(nodes, edges)
    setNodes(laid)
  }, [aiBusy, nodes, edges, setNodes])

  useShortcut(
    { id: 'mindmap.autoLayout', combo: 'mod+shift+l', description: '自动布局', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { doAutoLayout() } },
    [doAutoLayout, mindmapShortcutsEnabled],
  )

  const doSave = useCallback(async () => {
    const store = useMindmapStore.getState()
    const data = store.toMindLaneFile()
    const result = await window.mindlane?.file.save({ filePath: store.filePath, data })
    if (result?.ok) {
      store.setFilePath(result.data.filePath)
      store.markClean()
      await syncAfterFileSaved(result.data.filePath)
    }
  }, [syncAfterFileSaved])

  useShortcut(
    { id: 'mindmap.save', combo: 'mod+s', description: '保存文件', group: 'mindmap', preventWhenTyping: false, enabled: mindmapShortcutsEnabled, handler: () => { doSave() } },
    [doSave, mindmapShortcutsEnabled],
  )

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

    const mindlane = typeof window !== 'undefined' ? window.mindlane : undefined
    if (!mindlane) {
      useAiStore.getState().setError('IPC 通道不可用，请确认 Electron 环境')
      return
    }

    const backendSettings = await mindlane.settings.load()
    const currentKey = backendSettings?.apiKey || apiKey || useSettingsStore.getState().apiKey
    const currentModel = backendSettings?.chatModel || chatModel || useSettingsStore.getState().chatModel || 'qwen-turbo'

    if (!currentKey) {
      useAiStore.getState().setError('请先在右侧「设置」面板中填写 API Key')
      return
    }

    let selectedNodes = nodes
      .filter((n) => n.selected && n.type === 'topic')
      .map((n) => ({ id: n.id, label: String(n.data?.label ?? '') }))

    if (selectedNodes.length === 0 && selectedId) {
      const target = nodes.find((n) => n.id === selectedId)
      if (target && target.type === 'topic') {
        selectedNodes = [{ id: target.id, label: String(target.data?.label ?? '') }]
      }
    }
    if (selectedNodes.length === 0) {
      useAiStore.getState().setError('未选中任何主题节点')
      return
    }

    const processingIds = new Set(selectedNodes.map((n) => n.id))
    setNodes((nds) =>
      nds.map((n) =>
        processingIds.has(n.id) ? { ...n, data: { ...n.data, processing: true } } : n,
      ),
    )

    useAiStore.getState().setBusy(true)
    useAiStore.getState().setStep('analyzing')

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
        setNodes((nds) => nds.map((n) => (n.data.processing ? { ...n, data: { ...n.data, processing: undefined } } : n)))
        useAiStore.getState().setError('生成超时（超过 2 分钟），请检查网络后重试')
        return
      }

      if (!result.ok) {
        setNodes((nds) => nds.map((n) => (n.data.processing ? { ...n, data: { ...n.data, processing: undefined } } : n)))
        const errMsg = (result as { ok: false; error: string }).error || '生成失败（未知错误）'
        useAiStore.getState().setError(`AI 返回错误：${errMsg}`)
        return
      }

      const palaceId = newId()

      const parentId = findParentId(edges, selectedNodes[0]?.id ?? '') ?? 'root'
      const parentNode = nodes.find((n) => n.id === parentId)
      const firstSelected = nodes.find((n) => n.id === selectedNodes[0]?.id)

      const palaceNode: Node = {
        id: palaceId,
        type: 'palace',
        position: {
          x: (firstSelected?.position.x ?? (parentNode?.position.x ?? 0) + CHILD_OFFSET_X),
          y: (firstSelected?.position.y ?? parentNode?.position.y ?? 0),
        },
        data: {
          label: result.label,
          imageUrl: result.imageUrl,
          stations: result.stations,
          sourceNodeIds: result.sourceNodeIds,
        },
      }

      const treeEdge: Edge = {
        id: `e-${parentId}-${palaceId}`,
        source: parentId,
        target: palaceId,
        type: 'smoothstep',
        className: 'mindmap-edge',
      }

      const selectedIdSet = new Set(selectedNodes.map((n) => n.id))
      const childEdges: Edge[] = selectedNodes.map((n) => ({
        id: `e-${palaceId}-${n.id}`,
        source: palaceId,
        target: n.id,
        type: 'smoothstep',
        className: 'mindmap-edge',
      }))

      const cleanedEdges = edges.filter(
        (e) => !(e.source === parentId && selectedIdSet.has(e.target)),
      )

      const clearProcessing = (nds: Node[]) =>
        nds.map((n) => (n.data.processing ? { ...n, data: { ...n.data, processing: undefined } } : n))

      const nextNodes = clearProcessing([...nodes, palaceNode])
      const nextEdges = [...cleanedEdges, treeEdge, ...childEdges]

      const laidOut = reflowChildren(palaceId, nextNodes, nextEdges, CHILD_OFFSET_X, CHILD_GAP_Y)
      setNodes(laidOut)
      setEdges(nextEdges)
      useAiStore.getState().reset()
    } catch (e) {
      setNodes((nds) =>
        nds.map((n) => (n.data.processing ? { ...n, data: { ...n.data, processing: undefined } } : n)),
      )
      useAiStore.getState().setError(
        `生成异常：${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }, [aiBusy, apiKey, chatModel, selectedId, nodes, edges, setNodes, setEdges])

  return (
    <div className="mindmap-shell">
      <MindMapHeader
        onAddChild={addChild}
        onAddSibling={addSibling}
        onRemove={removeSelected}
        onReset={reset}
        onOpenSettings={onOpenSettings}
        onSwitchWorkspace={onSwitchWorkspace}
        onAutoLayout={doAutoLayout}
        onSave={doSave}
        canAddSibling={canAddSibling}
        canRemove={canRemove}
      />
      <div className="mindmap-canvas-wrap">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={aiBusy ? undefined : handleNodesChange}
          onEdgesChange={aiBusy ? undefined : onEdgesChange}
          onConnect={aiBusy ? undefined : onConnect}
          onNodeClick={onNodeClick}
          onPaneContextMenu={onPaneContextMenu}
          onNodeContextMenu={onNodeContextMenu}
          onSelectionContextMenu={onSelectionContextMenu}
          onEdgeContextMenu={onEdgeContextMenu}
          selectionOnDrag
          panOnDrag={[1]}
          selectionMode={SelectionMode.Partial}
          nodeTypes={nodeTypes}
          nodesDraggable={false}
          nodesConnectable={!aiBusy}
          elementsSelectable={!aiBusy}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          minZoom={0.2}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.5} color="rgba(0, 0, 0, 0.15)" />
          <Controls showInteractive={false} />
          <MiniMap nodeStrokeWidth={3} zoomable pannable className="mindmap-minimap" />
        </ReactFlow>
        <SelectionActionBar
          selectedTopicCount={selectedTopicIds.length}
          onGeneratePalace={generatePalace}
          aiBusy={aiBusy}
        />
        <AiProgressOverlay />
        {contextMenu ? (
          <MindMapContextMenu
            menu={contextMenu}
            menuRef={contextMenuRef}
            onClose={() => setContextMenu(null)}
            onAddChild={addChild}
            onAddSibling={addSibling}
            onRemove={removeSelected}
            onReset={reset}
            onGeneratePalace={generatePalace}
            canAddSibling={canAddSibling}
            canRemove={canRemove}
            aiBusy={aiBusy}
            selectedCount={selectedTopicIds.length || 1}
          />
        ) : null}
        {palaceModal && (
          <PalaceModal data={palaceModal} onClose={() => setPalaceModal(null)} />
        )}
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
    <ReactFlowProvider>
      <MindMapCanvas
        onSwitchWorkspace={onSwitchWorkspace}
        onOpenSettings={onOpenSettings}
      />
    </ReactFlowProvider>
  )
}
