import { memo, useCallback, useRef, useState, useEffect } from 'react'
import { Handle, Position, useReactFlow, type NodeProps } from '@xyflow/react'
import { Image, Landmark, Minimize2 } from 'lucide-react'
import type { PalaceNodeData } from './types'


type TransitionPhase = 'collapsed' | 'expanding' | 'expanded' | 'collapsing'

function PalaceNodeInner({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as PalaceNodeData
  const stations = data.stations ?? []
  const expanded = !!data.expanded
  const { setNodes } = useReactFlow()

  const prevExpanded = useRef(expanded)
  const [phase, setPhase] = useState<TransitionPhase>(expanded ? 'expanded' : 'collapsed')

  useEffect(() => {
    if (expanded === prevExpanded.current) return
    prevExpanded.current = expanded
    if (expanded) {
      setPhase('expanding')
      const t = setTimeout(() => setPhase('expanded'), 20)
      return () => clearTimeout(t)
    } else {
      setPhase('collapsing')
      const t = setTimeout(() => setPhase('collapsed'), 280)
      return () => clearTimeout(t)
    }
  }, [expanded])

  const collapse = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setNodes((nds) =>
        nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, expanded: false } } : n,
        ),
      )
    },
    [id, setNodes],
  )

  if (data.generating) {
    return (
      <div className="palace-node-generating">
        <Handle type="target" position={Position.Left} />
        <Landmark size={24} strokeWidth={1.5} className="palace-node-generating__icon" />
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  const showExpanded = phase === 'expanding' || phase === 'expanded' || phase === 'collapsing'

  return (
    <div className={`palace-node-shell palace-node-shell--${phase}${selected ? ' palace-node-shell--selected' : ''}`}>
      <Handle type="target" position={Position.Left} />

      {!showExpanded && (
        <div className="palace-node-collapsed-inner">
          <Image size={28} strokeWidth={1.5} />
        </div>
      )}

      {showExpanded && (
        <div className="palace-node-expanded-inner">
          <button className="palace-node__collapse-btn" onClick={collapse} aria-label="收起">
            <Minimize2 size={14} strokeWidth={2} />
          </button>
          <div className="palace-node__thumb">
            {data.imageUrl ? (
              <img
                src={data.imageUrl}
                alt="记忆宫殿"
                className="palace-node__img"
                draggable={false}
              />
            ) : (
              <div className="palace-node__placeholder">
                <Landmark size={24} strokeWidth={1.5} />
              </div>
            )}
          </div>
          <div className="palace-node__info">
            <span className="palace-node__label">{data.label || '记忆宫殿'}</span>
            <span className="palace-node__badge">{stations.length} 站</span>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const PalaceNodeComponent = memo(PalaceNodeInner)
