import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { AlertCircle, Landmark } from 'lucide-react'
import { toPng } from 'html-to-image'
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
  useStoreApi,
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
  findParentId,
  getChildIdsOrdered,
  newId,
  reflowChildren,
  withNewChild,
  withNewSibling,
  CHILD_OFFSET_X,
  CHILD_GAP_Y,
} from '@/shared/lib/mindmapTree'
import { PalaceNodeData } from '../nodes/palace'

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
  palaceEnabled: boolean
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
  palaceEnabled,
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
            disabled={!onGeneratePalace || aiBusy || !palaceEnabled}
            title={palaceEnabled ? undefined : '当前模型不支持记忆宫殿功能'}
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
          <AlertCircle size={16} strokeWidth={1.6} />
          <span className="ai-progress-overlay__text">{errorMessage}</span>
          <span className="ai-progress-overlay__dismiss">点击关闭</span>
        </div>
      </div>
    )
  }

  if (!busy || step === 'idle' || step === 'chatting') return null

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
  palaceEnabled,
}: {
  selectedTopicCount: number
  onGeneratePalace: () => void
  aiBusy: boolean
  palaceEnabled: boolean
}) {
  if (selectedTopicCount < 1 || aiBusy) return null

  return (
    <div className="selection-bar">
      <span className="selection-bar__count">已选 {selectedTopicCount} 个主题</span>
      <button
        type="button"
        className="selection-bar__btn"
        onClick={onGeneratePalace}
        disabled={!palaceEnabled}
        title={palaceEnabled ? undefined : '当前模型不支持记忆宫殿功能'}
      >
        <Landmark size={14} strokeWidth={1.6} />
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
  const rfStore = useStoreApi()

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
  const capabilities = useSettingsStore((s) => s.capabilities)
  const palaceEnabled = capabilities.includes('imageGen') && capabilities.includes('vision')
  const autoSaveIntervalMs = useSettingsStore((s) => s.autoSaveIntervalMs)
  const dirty = useMindmapStore((s) => s.dirty)
  const filePath = useMindmapStore((s) => s.filePath)
  const hasDocumentOpen = useMindmapStore((s) => s.hasDocumentOpen)
  const syncAfterFileSaved = useWorkspaceStore((s) => s.syncAfterFileSaved)
  const updateFilePreviewUrl = useWorkspaceStore((s) => s.updateFilePreviewUrl)

  const [selectedId, setSelectedId] = useState<string | null>('root')
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([])
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [palaceModal, setPalaceModal] = useState<PalaceNodeData | null>(null)
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

      if (layoutTimerRef.current) window.clearTimeout(layoutTimerRef.current)
      layoutTimerRef.current = window.setTimeout(() => {
        layoutTimerRef.current = null
        const { nodes: latestNodes, edges: curEdges } = useMindmapStore.getState()
        isLayoutingRef.current = true

        const targetIds = new Set(curEdges.map((e) => e.target))
        const roots = latestNodes.filter((n) => !targetIds.has(n.id))

        let result = latestNodes
        for (const root of roots) {
          result = reflowChildren(root.id, result, curEdges, CHILD_OFFSET_X, CHILD_GAP_Y)
        }

        setNodes(result)
        requestAnimationFrame(() => { isLayoutingRef.current = false })
      }, 80)
    },
    [onNodesChange, setNodes],
  )

  const startEditing = useCallback(
    (nodeId: string) => {
      if (aiBusy) return
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId && n.type === 'text'
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
        const pd = node.data as PalaceNodeData
        if (pd.generating) return
        if (pd.expanded) {
          setPalaceModal(pd)
        } else {
          setNodes((nds) =>
            nds.map((n) =>
              n.id === node.id
                ? { ...n, data: { ...n.data, expanded: true } }
                : n,
            ),
          )
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
    [startEditing, setNodes],
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
      setSelectedTopicIds(sel.filter((n) => n.type === 'text').map((n) => n.id))
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

  const selectNode = useCallback(
    (targetId: string) => {
      setSelectedId(targetId)
      setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === targetId })))
      rfStore.setState({ nodesSelectionActive: false })
    },
    [setNodes, rfStore],
  )

  const removeSelected = useCallback(() => {
    if (aiBusy) return

    const targets = nodes.filter(
      (n) => n.selected && n.id !== 'root' && !n.data?.exiting,
    )
    if (targets.length === 0) return

    const allIds = new Set<string>()
    for (const t of targets) {
      for (const id of collectSubtreeIds(edges, t.id)) allIds.add(id)
    }

    setNodes((nds) =>
      nds.map((n) =>
        allIds.has(n.id) ? { ...n, data: { ...n.data, exiting: true } } : n,
      ),
    )
    setEdges((eds) =>
      eds.map((e) => {
        const touch = allIds.has(e.source) || allIds.has(e.target)
        if (!touch) return e
        const parts = new Set(
          [e.className, 'mindmap-edge', 'mindmap-edge--exiting'].join(' ').split(/\s+/).filter(Boolean),
        )
        return { ...e, className: [...parts].join(' ') }
      }),
    )

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

    let timeoutId = 0
    timeoutId = window.setTimeout(() => {
      exitTimeoutsRef.current = exitTimeoutsRef.current.filter((tid) => tid !== timeoutId)
      const { nodes: n, edges: e } = graphRef.current
      const nextNodes = n.filter((node) => !allIds.has(node.id))
      const nextEdges = e.filter((edge) => !allIds.has(edge.source) && !allIds.has(edge.target))
      const laidOut = reflowChildren('root', nextNodes, nextEdges, CHILD_OFFSET_X, CHILD_GAP_Y)
      setNodes(laidOut)
      setEdges(nextEdges)
    }, NODE_EXIT_MS)
    exitTimeoutsRef.current.push(timeoutId)
  }, [aiBusy, edges, nodes, selectNode, setEdges, setNodes])

  const reset = useCallback(() => {
    if (aiBusy) return
    setNodes(createInitialNodes() as Node[])
    setEdges(createInitialEdges())
    setSelectedId('root')
  }, [aiBusy, setEdges, setNodes])

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

  const canAddSibling = useMemo(() => {
    if (!selectedId) return false
    return findParentId(edges, selectedId) != null
  }, [edges, selectedId])

  useShortcut(
    { id: 'mindmap.addChild', combo: 'mod+enter', description: '添加子主题', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { addChild() } },
  )
  useShortcut(
    { id: 'mindmap.addSibling', combo: 'mod+shift+enter', description: '添加同级主题', group: 'mindmap', preventWhenTyping: true, enabled: () => mindmapShortcutsEnabled() && canAddSibling, handler: () => { addSibling() } },
  )
  useShortcut(
    { id: 'mindmap.delete', combo: 'delete', description: '删除选中节点（含子树）', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { removeSelected() } },
  )
  useShortcut(
    { id: 'mindmap.backspace', combo: 'backspace', description: '删除选中节点（含子树）', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { removeSelected() } },
  )
  useShortcut(
    { id: 'mindmap.edit', combo: 'f2', description: '编辑选中节点', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { if (selectedId) startEditing(selectedId) } },
  )
  useShortcut(
    { id: 'mindmap.reset', combo: 'mod+shift+r', description: '重置为示例导图', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { reset() } },
  )
  useShortcut(
    { id: 'mindmap.navLeft', combo: 'arrowleft', description: '选中父节点', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { navigateLeft() } },
  )
  useShortcut(
    { id: 'mindmap.navRight', combo: 'arrowright', description: '选中第一个子节点', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { navigateRight() } },
  )
  useShortcut(
    { id: 'mindmap.navUp', combo: 'arrowup', description: '选中上方兄弟节点', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { navigateUp() } },
  )
  useShortcut(
    { id: 'mindmap.navDown', combo: 'arrowdown', description: '选中下方兄弟节点', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { navigateDown() } },
  )

  const doAutoLayout = useCallback(() => {
    if (aiBusy) return
    const laid = autoLayout(nodes, edges)
    setNodes(laid)
  }, [aiBusy, nodes, edges, setNodes])

  useShortcut(
    { id: 'mindmap.autoLayout', combo: 'mod+shift+l', description: '自动布局', group: 'mindmap', preventWhenTyping: true, enabled: mindmapShortcutsEnabled, handler: () => { doAutoLayout() } },
  )

  const generateThumbnail = useCallback(async (filePath: string): Promise<string | null> => {
    try {
      const flowElement = document.querySelector('.mindmap-canvas-wrap .react-flow') as HTMLElement | null
      if (!flowElement) return null

      const dataUrl = await toPng(flowElement, {
        pixelRatio: 2,
        backgroundColor: '#ffffff',
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
    try {
      const store = useMindmapStore.getState()
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
      useAiStore.getState().setError(`保存失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }, [syncAfterFileSaved, generateThumbnail, updateFilePreviewUrl])

  const [generationBusy, setGenerationBusy] = useState(false)
  const [generationProgress, setGenerationProgress] = useState<string | null>(null)

  useEffect(() => {
    const mindlane = typeof window !== 'undefined' ? window.mindlane : undefined
    if (!mindlane?.mindmap) return
    const off = mindlane.mindmap.onGenerationProgress((progress) => {
      if (progress.phase === 'error') {
        setGenerationProgress(null)
        return
      }
      if (progress.phase === 'done') {
        setGenerationProgress(null)
        return
      }
      const phaseLabel: Record<string, string> = {
        preparing: '准备文件',
        extracting: 'AI 提取大纲',
        merging: '合并子树',
        finalizing: '生成 YAML',
        done: '完成',
        error: '错误',
      }
      const label = phaseLabel[progress.phase] ?? progress.phase
      setGenerationProgress(progress.message ? `${label} · ${progress.message}` : label)
    })
    return off
  }, [])

  const generateFromFile = useCallback(async () => {
    if (aiBusy || generationBusy) return

    const mindlane = typeof window !== 'undefined' ? window.mindlane : undefined
    if (!mindlane?.mindmap) {
      useAiStore.getState().setError('IPC 通道不可用，请确认 Electron 环境')
      return
    }

    const backendSettings = await mindlane.settings.load()
    const currentKey = backendSettings?.apiKey || apiKey || useSettingsStore.getState().apiKey
    if (!currentKey?.trim()) {
      useAiStore.getState().setError('请先在右侧「设置」面板中填写 API Key')
      return
    }

    setGenerationBusy(true)
    setGenerationProgress('选择文件…')

    try {
      const result = await mindlane.mindmap.generateFromFile({})
      if (!result.ok) {
        if (!result.canceled) {
          useAiStore.getState().setError(`生成失败：${result.error}`)
        }
        return
      }

      try {
        useMindmapStore.getState().loadFromYaml(result.data.yamlContent, {
          fileTitle: result.data.documentTitle,
        })
      } catch (e) {
        useAiStore.getState().setError(
          `YAML 解析失败：${e instanceof Error ? e.message : String(e)}`,
        )
      }
    } catch (e) {
      useAiStore.getState().setError(
        `生成异常：${e instanceof Error ? e.message : String(e)}`,
      )
    } finally {
      setGenerationBusy(false)
      setGenerationProgress(null)
    }
  }, [aiBusy, apiKey, generationBusy])

  useShortcut(
    { id: 'mindmap.save', combo: 'mod+s', description: '保存文件', group: 'mindmap', preventWhenTyping: false, enabled: mindmapShortcutsEnabled, handler: () => { doSave() } },
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
      .filter((n) => n.selected && n.type === 'text')
      .map((n) => ({ id: n.id, label: String(n.data?.label ?? '') }))

    if (selectedNodes.length === 0 && selectedId) {
      const target = nodes.find((n) => n.id === selectedId)
      if (target && target.type === 'text') {
        selectedNodes = [{ id: target.id, label: String(target.data?.label ?? '') }]
      }
    }
    if (selectedNodes.length === 0) {
      useAiStore.getState().setError('未选中任何主题节点')
      return
    }

    const rollbackNodes = nodes
    const rollbackEdges = edges

    const palaceId = newId()
    const parentId = findParentId(edges, selectedNodes[0]?.id ?? '') ?? 'root'
    const parentNode = nodes.find((n) => n.id === parentId)
    const firstSelected = nodes.find((n) => n.id === selectedNodes[0]?.id)

    const placeholderNode: Node = {
      id: palaceId,
      type: 'palace',
      position: {
        x: (firstSelected?.position.x ?? (parentNode?.position.x ?? 0) + CHILD_OFFSET_X),
        y: (firstSelected?.position.y ?? parentNode?.position.y ?? 0),
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

    const processingIds = new Set(selectedNodes.map((n) => n.id))
    const nextNodes = [...nodes, placeholderNode].map((n) =>
      processingIds.has(n.id) ? { ...n, data: { ...n.data, processing: true } } : n,
    )
    const nextEdges = [...cleanedEdges, treeEdge, ...childEdges]

    const laidOut = reflowChildren(palaceId, nextNodes, nextEdges, CHILD_OFFSET_X, CHILD_GAP_Y)
    setNodes(laidOut)
    setEdges(nextEdges)

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
        setNodes(rollbackNodes)
        setEdges(rollbackEdges)
        useAiStore.getState().setError('生成超时（超过 2 分钟），请检查网络后重试')
        return
      }

      if (!result.ok) {
        setNodes(rollbackNodes)
        setEdges(rollbackEdges)
        const errMsg = (result as { ok: false; error: string }).error || '生成失败（未知错误）'
        useAiStore.getState().setError(`AI 返回错误：${errMsg}`)
        return
      }

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === palaceId) {
            return {
              ...n,
              data: {
                label: result.label,
                imageUrl: result.imageUrl,
                stations: result.stations,
                sourceNodeIds: result.sourceNodeIds,
              },
            }
          }
          if (n.data.processing) {
            return { ...n, data: { ...n.data, processing: undefined } }
          }
          return n
        }),
      )
      useAiStore.getState().reset()
    } catch (e) {
      setNodes(rollbackNodes)
      setEdges(rollbackEdges)
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
        onGenerateFromFile={generateFromFile}
        generateFromFileBusy={generationBusy}
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
          palaceEnabled={palaceEnabled}
        />
        <AiProgressOverlay />
        {generationProgress && (
          <div className="ai-progress-overlay">
            <div className="ai-progress-overlay__card">
              <div className="ai-progress-overlay__spinner" />
              <span className="ai-progress-overlay__text">{generationProgress}</span>
            </div>
          </div>
        )}
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
            palaceEnabled={palaceEnabled}
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
