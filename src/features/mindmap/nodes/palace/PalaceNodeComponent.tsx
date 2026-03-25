import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { PalaceNodeData } from '@/shared/lib/fileFormat'

function PalaceNodeInner({ data: rawData, selected }: NodeProps) {
  const data = rawData as PalaceNodeData
  const stations = data.stations ?? []

  return (
    <div className={`palace-node${selected ? ' palace-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
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
            <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
              <path
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6"
              />
            </svg>
          </div>
        )}
      </div>
      <div className="palace-node__info">
        <span className="palace-node__label">{data.label || '记忆宫殿'}</span>
        <span className="palace-node__badge">{stations.length} 站</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const PalaceNodeComponent = memo(PalaceNodeInner)
