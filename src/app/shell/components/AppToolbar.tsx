import { Menu } from 'lucide-react'
import { displayFileName } from '@/shared/lib/displayFileName'
import '../styles/window.css'

type Props = {
  onOpenFileManager: () => void
  fileManagerOpen: boolean
  filePath?: string
}

export function AppToolbar({ onOpenFileManager, fileManagerOpen, filePath }: Props) {
  const fileName = filePath ? displayFileName(filePath) : null

  return (
    <div className={`app-toolbar${fileName ? ' app-toolbar--with-filename' : ''}`}>
      <button
        type="button"
        className={`app-toolbar__menu${fileManagerOpen ? ' app-toolbar__menu--active' : ''}`}
        onClick={onOpenFileManager}
        title="Open file manager"
        aria-label="Open file manager"
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
