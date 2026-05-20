import { ListTree, Columns2, Trash2, RotateCcw, Save, FolderInput, Settings, FileUp } from 'lucide-react'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'

type Props = {
  onAddChild: () => void
  onAddSibling: () => void
  onRemove: () => void
  onReset: () => void
  onOpenSettings?: () => void
  onSwitchWorkspace?: () => void
  onSave?: () => void
  onGenerateFromFile?: () => void
  generateFromFileBusy?: boolean
  canAddChild: boolean
  canAddSibling: boolean
  canRemove: boolean
}

export function MindMapHeader({
  onAddChild,
  onAddSibling,
  onRemove,
  onReset,
  onOpenSettings,
  onSwitchWorkspace,
  onSave,
  onGenerateFromFile,
  generateFromFileBusy,
  canAddChild,
  canAddSibling,
  canRemove,
}: Props) {
  const filePath = useMindmapStore((s) => s.filePath)
  const displayFileName = filePath
    ? filePath.split('/').pop()!.replace(/\.mindlane$/, '')
    : '未命名'

  return (
    <header className="mindmap-header">
      <div className="mindmap-header__lead">
        <span className="mindmap-header__filename">{displayFileName}</span>
      </div>

      <nav className="mindmap-header__nav" aria-label="导图操作">
        <div className="mindmap-header__cluster">
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--primary"
            onClick={onAddChild}
            disabled={!canAddChild}
          >
            <ListTree className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>子主题</span>
          </button>
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--primary"
            onClick={onAddSibling}
            disabled={!canAddSibling}
            title={!canAddSibling ? '根节点不能添加同级' : undefined}
          >
            <Columns2 className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>同级</span>
          </button>
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--danger"
            onClick={onRemove}
            disabled={!canRemove}
          >
            <Trash2 className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>删除</span>
          </button>
        </div>
        <div className="mindmap-header__cluster mindmap-header__cluster--muted">
          {onGenerateFromFile && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onGenerateFromFile}
              disabled={generateFromFileBusy}
              title="从 PDF 文件生成思维导图"
            >
              <FileUp className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>{generateFromFileBusy ? '生成中…' : '从文件生成'}</span>
            </button>
          )}
          {onSave && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onSave}
              title="保存 (Ctrl+S)"
            >
              <Save className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>保存</span>
            </button>
          )}
          {onSwitchWorkspace && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onSwitchWorkspace}
              title="切换仓库"
            >
              <FolderInput className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>切换仓库</span>
            </button>
          )}
          {onOpenSettings && (
            <button
              type="button"
              className="mindmap-header__btn mindmap-header__btn--ghost"
              onClick={onOpenSettings}
              title="打开设置"
            >
              <Settings className="mindmap-header__icon" size={16} strokeWidth={1.5} />
              <span>设置</span>
            </button>
          )}
          <button
            type="button"
            className="mindmap-header__btn mindmap-header__btn--ghost"
            onClick={onReset}
          >
            <RotateCcw className="mindmap-header__icon" size={16} strokeWidth={1.5} />
            <span>重置</span>
          </button>
        </div>
      </nav>

    </header>
  )
}
