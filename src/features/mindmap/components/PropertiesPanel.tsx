import type { PalaceNodeData } from '@/shared/lib/fileFormat'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { usePalaceStore } from '@/features/mindmap/model/palaceStore'

export function PropertiesPanel() {
  const nodes = useMindmapStore((s) => s.nodes)
  const selected = nodes.filter((n) => n.selected)

  if (selected.length === 0) {
    return <div className="panel-empty">选中节点查看属性</div>
  }

  if (selected.length > 1) {
    return (
      <div className="panel-empty">
        已选中 {selected.length} 个节点
      </div>
    )
  }

  const node = selected[0]!

  if (node.type === 'palace') {
    return <PalaceProperties nodeId={node.id} data={node.data as PalaceNodeData} />
  }

  if (node.type === 'document') {
    const data = node.data as { filename?: string; excerpt?: string }
    return (
      <div>
        <div className="panel-section">
          <div className="panel-section__title">文档节点</div>
          <div className="panel-field">
            <span className="panel-field__label">文件名</span>
            <span style={{ fontSize: '0.85rem' }}>{data.filename || '未知'}</span>
          </div>
          {data.excerpt && (
            <div className="panel-field">
              <span className="panel-field__label">摘要</span>
              <p style={{ fontSize: '0.8rem', margin: 0, lineHeight: 1.4, color: 'var(--ml-text-muted)' }}>
                {data.excerpt}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  const data = node.data as { label?: string }
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section__title">主题节点</div>
        <div className="panel-field">
          <span className="panel-field__label">标签</span>
          <span style={{ fontSize: '0.85rem' }}>{data.label || '未命名'}</span>
        </div>
        <div className="panel-field">
          <span className="panel-field__label">ID</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--ml-text-faint)', fontFamily: 'monospace' }}>
            {node.id}
          </span>
        </div>
      </div>
    </div>
  )
}

function PalaceProperties({ nodeId, data }: { nodeId: string; data: PalaceNodeData }) {
  const openPalace = usePalaceStore((s) => s.openPalace)
  return (
    <div>
      <div className="panel-section">
        <div className="panel-section__title">记忆宫殿</div>
        <div className="panel-field">
          <span className="panel-field__label">名称</span>
          <span style={{ fontSize: '0.85rem' }}>{data.label || '记忆宫殿'}</span>
        </div>
        <div className="panel-field">
          <span className="panel-field__label">站点数</span>
          <span style={{ fontSize: '0.85rem' }}>{data.stations?.length ?? 0}</span>
        </div>
        {data.imageUrl && (
          <div className="panel-field">
            <img
              src={data.imageUrl}
              alt="宫殿预览"
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid var(--ml-border)',
              }}
            />
          </div>
        )}
        <button
          type="button"
          className="panel-btn panel-btn--full"
          onClick={() => openPalace(nodeId, data)}
        >
          查看详情
        </button>
      </div>
      {data.stations && data.stations.length > 0 && (
        <div className="panel-section">
          <div className="panel-section__title">路线站点</div>
          {data.stations.map((s) => (
            <div
              key={s.order}
              style={{
                display: 'flex',
                gap: '0.4rem',
                alignItems: 'flex-start',
                marginBottom: '0.4rem',
                padding: '0.35rem',
                borderRadius: 6,
                background: 'var(--ml-fill-soft)',
              }}
            >
              <span
                style={{
                  flexShrink: 0,
                  width: '1.3rem',
                  height: '1.3rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 5,
                  fontSize: '0.7rem',
                  fontWeight: 800,
                  color: '#fff',
                  background: '#111',
                }}
              >
                {s.order}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>{s.content}</div>
                {s.anchorVisual && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--ml-text-muted)', marginTop: 2 }}>
                    {s.anchorVisual}
                  </div>
                )}
                {s.association && (
                  <div style={{ fontSize: '0.68rem', color: 'var(--ml-text-faint, #999)', marginTop: 2, fontStyle: 'italic' }}>
                    {s.association}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
