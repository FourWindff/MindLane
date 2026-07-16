import { Menu, MessageCircle, MessageCircleOff } from 'lucide-react'
import '../styles/window.css'

type Props = {
  onOpenFileManager: () => void
  fileManagerOpen: boolean
  filePath?: string
  chatOpen: boolean
  onToggleChat: () => void
}

function extractFileName(filePath: string | undefined): string | null {
  if (!filePath) return null
  return filePath
    .split(/[/\\]/)
    .pop()!
    .replace(/\.mindlane$/, '')
}

export function AppToolbar({
  onOpenFileManager,
  fileManagerOpen,
  filePath,
  chatOpen,
  onToggleChat,
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
      <span className="app-toolbar__divider" />
      <button
        type="button"
        className={`app-toolbar__menu${chatOpen ? '' : ' app-toolbar__menu--active'}`}
        onClick={onToggleChat}
        title={chatOpen ? '隐藏聊天' : '显示聊天'}
        aria-label={chatOpen ? '隐藏聊天' : '显示聊天'}
      >
        {chatOpen ? (
          <MessageCircle size={18} strokeWidth={1.5} />
        ) : (
          <MessageCircleOff size={18} strokeWidth={1.5} />
        )}
      </button>
    </div>
  )
}
