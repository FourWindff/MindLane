import { Menu } from 'lucide-react'
import '../styles/window.css'

type Props = {
  onOpenFileManager: () => void
  fileManagerOpen: boolean
  filePath?: string
}

function extractFileName(filePath: string | undefined): string | null {
  if (!filePath) return null
  return filePath.split(/[/\\]/).pop()!.replace(/\.mindlane$/, '')
}

export function AppToolbar({
  onOpenFileManager,
  fileManagerOpen,
  filePath,
}: Props) {
  const fileName = extractFileName(filePath)

  return (
    <div className="app-toolbar">
      <button
        type="button"
        className={`app-toolbar__menu${fileManagerOpen ? ' app-toolbar__menu--active' : ''}`}
        onClick={onOpenFileManager}
        title="打开文件管理器"
        aria-label="打开文件管理器"
      >
        <Menu size={18} strokeWidth={1.5} />
      </button>
      {fileName && (
        <>
          <span className="app-toolbar__divider" />
          <span className="app-toolbar__filename" title={fileName}>
            {fileName}
          </span>
        </>
      )}
    </div>
  )
}
