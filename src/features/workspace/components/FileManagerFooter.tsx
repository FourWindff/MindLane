import type { WorkspaceTreeEntry } from '../types'

export function FileManagerFooter({ items }: { items: WorkspaceTreeEntry[] }) {
  return (
    <div className="file-manager__footer">
      <div className="file-manager__footer-divider" />
      <div className="file-manager__stats">
        <div className="file-manager__stat">
          <span className="file-manager__stat-value">{items.length}</span>
          <span className="file-manager__stat-label">Total Clusters</span>
        </div>
        <div className="file-manager__stat-divider" />
        <div className="file-manager__stat">
          <span className="file-manager__stat-value">
            {items.filter((e) => e.type === 'directory').length}
          </span>
          <span className="file-manager__stat-label">Biological Groups</span>
        </div>
        <div className="file-manager__stat-divider" />
        <div className="file-manager__stat">
          <span className="file-manager__stat-value">
            {items.filter((e) => e.type === 'file').length}
          </span>
          <span className="file-manager__stat-label">Neural Nodes</span>
        </div>
      </div>
    </div>
  )
}
