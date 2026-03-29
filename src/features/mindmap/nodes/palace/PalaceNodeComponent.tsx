import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Landmark } from 'lucide-react'
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
            <Landmark size={24} strokeWidth={1.5} />
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
