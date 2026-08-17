import { memo, useCallback } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { useActiveMindmapEditor } from '@/features/mindmap/hooks/useActiveMindmapEditor'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import type { ImageNodeData } from './types'

function ImageNodeInner({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as ImageNodeData
  const editor = useActiveMindmapEditor()
  const assets = useActiveMindmapStore((state) => state.assets)
  const asset = assets.find((a) => a.id === data.assetId)

  const onAnimationEnd = useCallback(
    (e: React.AnimationEvent<HTMLDivElement>) => {
      if (!e.animationName.includes('image-node-enter')) return
      editor.clearNodeFlag(id, 'justAdded')
    },
    [id, editor],
  )

  const width = data.width
  const height = data.height

  return (
    <div
      className={[
        'image-node',
        selected && 'image-node--selected',
        data.justAdded && 'image-node--enter',
        data.exiting && 'image-node--exiting',
      ]
        .filter(Boolean)
        .join(' ')}
      onAnimationEnd={onAnimationEnd}
    >
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <Handle type="source" position={Position.Bottom} />
      {asset ? (
        <img
          className="image-node__img"
          src={`data:${asset.mime};base64,${asset.data}`}
          alt={data.alt ?? ''}
          style={{
            ...(width ? { width } : {}),
            ...(height ? { height } : {}),
          }}
          draggable={false}
        />
      ) : (
        <div className="image-node__missing" title={`缺少图片资源（asset=${data.assetId}）`}>
          🖼 图片缺失
        </div>
      )}
    </div>
  )
}

export const ImageNodeComponent = memo(ImageNodeInner)
