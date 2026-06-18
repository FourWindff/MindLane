import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { useAiStore } from '@/features/chat/model/aiStore'
import type { TextNodeData } from './types'

function TextNodeInner({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as TextNodeData
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
      if (!e.animationName.includes('text-node-enter')) return
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
    'text-node',
    selected && 'text-node--selected',
    data.justAdded && 'text-node--enter',
    data.exiting && 'text-node--exiting',
    data.processing && 'text-node--processing',
    aiBusy && selected && !data.processing && 'text-node--locked',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={className} onAnimationEnd={onAnimationEnd}>
      <Handle type="target" position={Position.Left} />
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
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const TextNodeComponent = memo(TextNodeInner)
