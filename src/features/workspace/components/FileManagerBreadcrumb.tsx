import { ChevronRight } from 'lucide-react'

export function FileManagerBreadcrumb({
  navigationPath,
  currentFolder,
  lastError,
  onNavigateRoot,
  onBreadcrumbClick,
  onClearError,
}: {
  navigationPath: string[]
  currentFolder: string | null
  lastError: string | null
  onNavigateRoot: () => void
  onBreadcrumbClick: (idx: number) => void
  onClearError: () => void
}) {
  return (
    <>
      <div className="file-manager__header-left">
        <div className="file-manager__breadcrumb">
          <button type="button" className="file-manager__breadcrumb-root" onClick={onNavigateRoot}>
            思想聚落
          </button>
          {navigationPath.map((name, idx) => (
            <div key={name} className="file-manager__breadcrumb-segment">
              <ChevronRight className="file-manager__breadcrumb-chevron" size={18} />
              <button
                type="button"
                className="file-manager__breadcrumb-link"
                onClick={() => onBreadcrumbClick(idx)}
              >
                {name}
              </button>
            </div>
          ))}
        </div>
        <p className="file-manager__subtitle">
          {currentFolder ? `当前位置：${currentFolder}` : '浏览工作区中的文件和文件夹'}
        </p>
      </div>

      {lastError && (
        <div className="file-manager__error" role="alert">
          <span>{lastError}</span>
          <button type="button" className="file-manager__error-close" onClick={onClearError}>
            关闭
          </button>
        </div>
      )}
    </>
  )
}
