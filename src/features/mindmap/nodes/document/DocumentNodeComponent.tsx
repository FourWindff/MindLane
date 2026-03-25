import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { DocumentNodeData } from '@/shared/lib/fileFormat'

function DocumentNodeInner({ data: rawData, selected }: NodeProps) {
  const data = rawData as DocumentNodeData

  return (
    <div className={`document-node${selected ? ' document-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="document-node__icon">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zM14 2v6h6M16 13H8M16 17H8M10 9H8"
          />
        </svg>
      </div>
      <div className="document-node__text">
        <span className="document-node__name">{data.filename || '文档'}</span>
        {data.excerpt && (
          <span className="document-node__excerpt">{data.excerpt}</span>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const DocumentNodeComponent = memo(DocumentNodeInner)
