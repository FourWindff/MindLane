import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useActiveMindmapEditor,
  useActiveOpenFile,
  useActiveMindmapStore,
} from '@/features/mindmap/hooks/useActiveOpenFile'
import { selectCurrentChatBusy, useAiStore } from '@/features/chat/model/aiStore'
import { useMapStyle } from '@/features/mindmap/theme/useMapStyle'
import { getNodeColor } from '@/features/mindmap/theme/colorPalettes'
import { useNodeGlide, usePrefersReducedMotion } from '@/features/mindmap/hooks/useNodeMotion'
import type { TextNodeData } from './types'

function TextNodeInner({
  id,
  data: rawData,
  selected,
  positionAbsoluteX,
  positionAbsoluteY,
}: NodeProps) {
  const data = rawData as TextNodeData
  const editor = useActiveMindmapEditor()
  const instance = useActiveOpenFile()
  const edges = useActiveMindmapStore((state) => state.edges)
  const nodes = useActiveMindmapStore((state) => state.nodes)
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

  // Root node in bilateral layout: one collapse button per side, folding/expanding each branch independently
  const isMindmapRoot = structureType === 'mindmap' && !edges.some((e) => e.target === id)
  const sideChildren = useMemo(() => {
    if (!isMindmapRoot) return null
    let left = 0
    let right = 0
    for (const edge of edges) {
      if (edge.source !== id) continue
      const child = nodes.find((n) => n.id === edge.target)
      const side = (child?.data as TextNodeData | undefined)?.side
      if (side === 'left') left++
      else if (side === 'right') right++
    }
    return { left, right }
  }, [edges, id, isMindmapRoot, nodes])
  const leftCollapsed = collapsed || data.leftCollapsed === true
  const rightCollapsed = collapsed || data.rightCollapsed === true

  const toggleCollapsed = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (aiBusy) return
      editor.setNodeCollapsed(id, !collapsed)
    },
    [aiBusy, collapsed, editor, id],
  )

  const toggleSideCollapsed = useCallback(
    (side: 'left' | 'right', e: React.MouseEvent) => {
      e.stopPropagation()
      if (aiBusy) return
      const effective = side === 'left' ? leftCollapsed : rightCollapsed
      editor.setNodeSideCollapsed(id, side, !effective)
    },
    [aiBusy, editor, id, leftCollapsed, rightCollapsed],
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
  const reduced = usePrefersReducedMotion()

  const colorStyle: React.CSSProperties = {
    '--node-bg': nodeColors.nodeBg,
    '--node-border': nodeColors.nodeBorder,
    '--node-text': nodeColors.nodeText,
  } as React.CSSProperties

  const glideStyle = useNodeGlide(data, positionAbsoluteX, positionAbsoluteY, reduced)
  const style: React.CSSProperties = {
    ...colorStyle,
    ...glideStyle,
    ...(data.cascadeDelay !== undefined ? { '--node-enter-delay': `${data.cascadeDelay}ms` } : {}),
    ...(data.exitingDelay ? { '--node-exit-delay': `${data.exitingDelay}ms` } : {}),
  }

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
    <div className={className} style={style} onAnimationEnd={onAnimationEnd}>
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
      {!editing &&
        (isMindmapRoot ? (
          <>
            {sideChildren && sideChildren.right > 0 && (
              <CollapseButton
                side="right"
                collapsed={rightCollapsed}
                onClick={(e) => toggleSideCollapsed('right', e)}
              />
            )}
            {sideChildren && sideChildren.left > 0 && (
              <CollapseButton
                side="left"
                mirrored
                collapsed={leftCollapsed}
                onClick={(e) => toggleSideCollapsed('left', e)}
              />
            )}
          </>
        ) : (
          hasChildren && (
            <CollapseButton
              side="subtree"
              mirrored={leftSide}
              collapsed={collapsed}
              onClick={toggleCollapsed}
            />
          )
        ))}
    </div>
  )
}

/** Which branches the control folds; also picks the wording and the chevron side. */
type CollapseSide = 'left' | 'right' | 'subtree'

const COLLAPSE_LABELS: Record<CollapseSide, { collapsed: string; expanded: string }> = {
  left: { collapsed: '展开左侧分支', expanded: '收起左侧分支' },
  right: { collapsed: '展开右侧分支', expanded: '收起右侧分支' },
  subtree: { collapsed: '展开子树', expanded: '折叠子树' },
}

/**
 * Collapse toggle: one per side on a bilateral root, one on an ordinary node.
 * The chevron mirrors on a left-hand button.
 */
function CollapseButton({
  side,
  mirrored,
  collapsed,
  onClick,
}: {
  side: CollapseSide
  mirrored?: boolean
  collapsed: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  const Chevron = collapsed ? (mirrored ? ChevronLeft : ChevronRight) : ChevronDown
  const label = COLLAPSE_LABELS[side][collapsed ? 'collapsed' : 'expanded']
  return (
    <button
      type="button"
      className={`text-node__collapse-btn${mirrored ? ' text-node__collapse-btn--left' : ''}${collapsed ? ' text-node__collapse-btn--collapsed' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <Chevron size={14} strokeWidth={2} />
    </button>
  )
}

export const TextNodeComponent = memo(TextNodeInner)
