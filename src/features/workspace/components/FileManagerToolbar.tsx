import { X, FolderInput, FilePlus, FolderPlus, RefreshCw } from 'lucide-react'

export function FileManagerToolbar({
  busy,
  workspacePath,
  onNewFile,
  onNewFolder,
  onRefresh,
  onSwitchWorkspace,
  onClose,
}: {
  busy: boolean
  workspacePath: string | null
  onNewFile: () => void
  onNewFolder: () => void
  onRefresh: () => void
  onSwitchWorkspace: () => void
  onClose: () => void
}) {
  return (
    <div className="file-manager__header-actions">
      {/* Primary actions */}
      <div className="file-manager__action-group">
        <button
          type="button"
          className="file-manager__btn file-manager__btn--primary"
          onClick={onNewFile}
          disabled={busy || !workspacePath}
          title="新建文件"
        >
          <FilePlus size={15} strokeWidth={2} />
          <span>文件</span>
        </button>
        <button
          type="button"
          className="file-manager__btn"
          onClick={onNewFolder}
          disabled={busy || !workspacePath}
          title="新建文件夹"
        >
          <FolderPlus size={15} strokeWidth={2} />
          <span>文件夹</span>
        </button>
      </div>

      <div className="file-manager__action-divider" />

      {/* Secondary actions */}
      <div className="file-manager__action-group">
        <button
          type="button"
          className="file-manager__icon-btn"
          onClick={onRefresh}
          disabled={busy || !workspacePath}
          title="刷新"
          aria-label="刷新"
        >
          <RefreshCw size={15} strokeWidth={1.5} />
        </button>
        <button
          type="button"
          className="file-manager__icon-btn"
          onClick={onSwitchWorkspace}
          disabled={busy}
          title="切换仓库"
          aria-label="切换仓库"
        >
          <FolderInput size={15} strokeWidth={1.5} />
        </button>
      </div>

      <div className="file-manager__action-divider" />

      {/* Close */}
      <button
        type="button"
        className="file-manager__close-btn"
        onClick={onClose}
        title="关闭"
        aria-label="关闭"
      >
        <X size={18} strokeWidth={2} />
      </button>
    </div>
  )
}
