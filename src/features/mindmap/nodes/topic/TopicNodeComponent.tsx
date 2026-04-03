import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import type { TopicNodeData } from '@/shared/lib/fileFormat'
import { useAiStore } from '@/features/chat/model/aiStore'

function TopicNodeInner({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as TopicNodeData
  const { setNodes } = useReactFlow()
  const [label, setLabel] = useState(data.label)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const aiBusy = useAiStore((s) => s.busy)

  const editing = !!data.editing

  const clearEditing = useCallback(() => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, editing: undefined } } : n,
      ),
    )
  }, [id, setNodes])

  const commit = useCallback(() => {
    const next = label.trim() || '未命名'
    setLabel(next)
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? { ...n, data: { ...n.data, label: next, editing: undefined } }
          : n,
      ),
    )
  }, [id, label, setNodes])

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
      if (!e.animationName.includes('topic-node-enter')) return
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id && n.data.justAdded
            ? { ...n, data: { ...n.data, justAdded: undefined } }
            : n,
        ),
      )
    },
    [id, setNodes],
  )

  const className = [
    'topic-node',
    selected && 'topic-node--selected',
    data.justAdded && 'topic-node--enter',
    data.exiting && 'topic-node--exiting',
    data.processing && 'topic-node--processing',
    aiBusy && selected && !data.processing && 'topic-node--locked',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} onAnimationEnd={onAnimationEnd}>
      <Handle type="target" position={Position.Left} />
      {editing && !aiBusy ? (
        <textarea
          ref={textareaRef}
          className="topic-node__textarea"
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
        <span className="topic-node__label">{label}</span>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const TopicNodeComponent = memo(TopicNodeInner)
