import { memo, useCallback, useRef, useState, useEffect } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ChevronRight, Image, Landmark, Minimize2, X } from 'lucide-react'
import {
  useActiveMindmapEditor,
  useActiveMindmapStore,
} from '@/features/mindmap/hooks/useActiveOpenFile'
import { resumePalaceRun, stopPalaceRun } from '@/features/mindmap/model/palaceRun'
import { assetToDataUrl } from '@contracts/mindmapXml/asset'
import type { PalaceNodeData } from '@contracts/nodeData'

type TransitionPhase = 'collapsed' | 'expanding' | 'expanded' | 'collapsing'

function PalaceNodeInner({ id, data: rawData, selected }: NodeProps) {
  const data = rawData as PalaceNodeData
  const stations = data.stations ?? []
  const expanded = !!data.expanded
  const editor = useActiveMindmapEditor()
  const assets = useActiveMindmapStore((state) => state.assets)
  const asset = data.assetId ? assets.find((a) => a.id === data.assetId) : undefined
  // Images are always referenced through an asset; legacy data whose download failed keeps imageUrl as a fallback
  const imageSrc = asset ? assetToDataUrl(asset) : data.imageUrl || ''

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
      editor.setNodeExpanded(id, false)
    },
    [id, editor],
  )

  if (data.generating) {
    // Manual run in flight: progress sits beside the node (CONTEXT.md "stream event routing"),
    // not in the chat panel. A stopped/failed run keeps the placeholder so it can
    // resume on its own private thread, and that is what the button then offers.
    const stopped = data.runStopped === true
    const fileUuid = editor.getState().fileUuid
    return (
      <div className="palace-node-generating">
        <Handle type="target" position={Position.Left} />
        <Landmark size={24} strokeWidth={1.5} className="palace-node-generating__icon" />
        {data.runStage && <span className="palace-node-generating__stage">{data.runStage}</span>}
        <button
          className="palace-node-generating__action"
          onClick={(e) => {
            e.stopPropagation()
            if (stopped) void resumePalaceRun(fileUuid, id)
            else stopPalaceRun(fileUuid, id)
          }}
          aria-label={stopped ? 'Resume palace generation' : 'Abort palace generation'}
        >
          {stopped ? <ChevronRight size={12} strokeWidth={2} /> : <X size={12} strokeWidth={2} />}
          {stopped ? 'Resume' : 'Abort'}
        </button>
        <Handle type="source" position={Position.Right} />
      </div>
    )
  }

  const showExpanded = phase === 'expanding' || phase === 'expanded' || phase === 'collapsing'

  return (
    <div
      className={`palace-node-shell palace-node-shell--${phase}${selected ? ' palace-node-shell--selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} />

      {!showExpanded && (
        <div className="palace-node-collapsed-inner">
          <Image size={28} strokeWidth={1.5} />
        </div>
      )}

      {showExpanded && (
        <div className="palace-node-expanded-inner">
          <button className="palace-node__collapse-btn" onClick={collapse} aria-label="Collapse">
            <Minimize2 size={14} strokeWidth={2} />
          </button>
          <div className="palace-node__thumb">
            {imageSrc ? (
              <img
                src={imageSrc}
                alt="Memory palace"
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
            <span className="palace-node__label">{data.label || 'Memory palace'}</span>
            <span className="palace-node__badge">{stations.length} stations</span>
          </div>
        </div>
      )}

      <Handle type="source" position={Position.Right} />
    </div>
  )
}

export const PalaceNodeComponent = memo(PalaceNodeInner)
