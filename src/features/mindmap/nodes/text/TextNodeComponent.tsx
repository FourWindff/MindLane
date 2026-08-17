import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'
import { useActiveMindmapInstance } from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { useMapStyle } from '@/features/mindmap/style/useMapStyle'
import { getNodeColor } from '@/features/mindmap/style/colorPalettes'
import type { TextNodeData } from './types'

function TextNodeInner({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as TextNodeData
  const editor = useActiveMindmapEditor()
  const instance = useActiveMindmapInstance()
  const edges = useActiveMindmapStore((state) => state.edges)
  const [label, setLabel] = useState(data.label)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const aiBusy = useAiStore(selectCurrentChatBusy)
  const { visualVariant, colorScheme, structureType } = useMapStyle()

  const editing = !!data.editing
  const collapsed = data.collapsed === true
  // 双向布局中根节点左侧的分支：收起按钮与折叠箭头镜像到节点左侧
  const leftSide = structureType === 'mindmap' && data.side === 'left'
  // 折叠控件：节点有子节点时显示（子节点由边派生）
  const hasChildren = edges.some((e) => e.source === id)

  const toggleCollapsed = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (aiBusy) return
      editor.setNodeCollapsed(id, !collapsed)
    },
    [aiBusy, collapsed, editor, id],
  )

  const clearEditing = useCallback(() => {
    editor.setNodeEditing(id, false)
  }, [id, editor])

  const commit = useCallback(() => {
    const before = data.label
    const next = label.trim() || '未命名'
    setLabel(next)
    editor.updateNode(id, (n) => ({
      ...n,
      data: { ...n.data, label: next, editing: undefined },
    }))
    // Report manual text edits as memory evidence (fire-and-forget). AI edits
    // never pass through this commit point, so they are never reported. Only
    // documents owned by a workspace qualify: the instance records its
    // workspace at load time (workspace-external file.open stays null).
    if (next !== before) {
      const { fileUuid, workspacePath } = instance.store.getState()
      if (fileUuid && workspacePath) {
        window.mindlane?.editlog?.append({
          workspacePath,
          fileUuid,
          nodeId: id,
          before,
          after: next,
        })
      }
    }
  }, [id, label, editor, data.label, instance])

  useEffect(() => {
    setLabel(data.label)
  }, [data.label])

  useEffect(() => {
    if (aiBusy && editing) {
      clearEditing()
      setLabel(data.label)
    }
  }, [aiBusy, editing, data.label, clearEditing])

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.select()
    })
  }, [editing])

  const onAnimationEnd = useCallback(
    (e: React.AnimationEvent<HTMLDivElement>) => {
      if (!e.animationName.includes('text-node-enter')) return
      editor.clearNodeFlag(id, 'justAdded')
    },
    [id, editor],
  )

  // 按深度/分支计算节点颜色
  const depth = data.depth ?? 0
  const branchIndex = data.branchIndex ?? 0
  const nodeColors = getNodeColor(colorScheme, depth, branchIndex)

  const colorStyle: React.CSSProperties = {
    '--node-bg': nodeColors.nodeBg,
    '--node-border': nodeColors.nodeBorder,
    '--node-text': nodeColors.nodeText,
  } as React.CSSProperties

  const className = [
    'text-node',
    `text-node--style-${visualVariant}`,
    selected && 'text-node--selected',
    data.justAdded && 'text-node--enter',
    data.exiting && 'text-node--exiting',
    data.processing && 'text-node--processing',
    aiBusy && selected && !data.processing && 'text-node--locked',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} style={colorStyle} onAnimationEnd={onAnimationEnd}>
      {/* 所有方向 handle 均渲染，CSS 隐藏；xyflow 根据 sourcePosition/targetPosition 路由 */}
      <Handle type="target" position={Position.Left} />
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Right} />
      <Handle type="target" position={Position.Bottom} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Left} />
      <Handle type="source" position={Position.Top} />

      {editing && !aiBusy ? (
        <textarea
          ref={textareaRef}
          className="text-node__textarea"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') {
              setLabel(data.label)
              clearEditing()
            }
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="text-node__label">{label}</span>
      )}
      {!editing && hasChildren && (
        <button
          type="button"
          className={`text-node__collapse-btn${collapsed ? ' text-node__collapse-btn--collapsed' : ''}${leftSide ? ' text-node__collapse-btn--left' : ''}`}
          onClick={toggleCollapsed}
          aria-label={collapsed ? '展开子树' : '折叠子树'}
          title={collapsed ? '展开子树' : '折叠子树'}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {collapsed ? (
            leftSide ? (
              <ChevronLeft size={14} strokeWidth={2} />
            ) : (
              <ChevronRight size={14} strokeWidth={2} />
            )
          ) : (
            <ChevronDown size={14} strokeWidth={2} />
          )}
        </button>
      )}
    </div>
  )
}

export const TextNodeComponent = memo(TextNodeInner)
