import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText } from 'lucide-react'
import { DocumentNodeData } from '.'

function DocumentNodeInner({ data: rawData, selected }: NodeProps) {
  const data = rawData as DocumentNodeData

  return (
    <div className={`document-node${selected ? ' document-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="document-node__icon">
        <FileText size={18} strokeWidth={1.5} />
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
