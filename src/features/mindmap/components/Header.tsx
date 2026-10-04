import {
  GitBranch,
  BetweenHorizontalStart,
  Trash2,
  Save,
  FolderInput,
  Settings,
  Locate,
  Palette,
  Undo2,
  Redo2,
  Paperclip,
  MessageCircle,
  MessageCircleOff,
} from 'lucide-react'
import { useEffect } from 'react'

type Props = {
  onAddChild: () => void
  onAddSibling: () => void
  onRemove: () => void
  onUndo?: () => void
  onRedo?: () => void
  onOpenSettings?: () => void
  onSwitchWorkspace?: () => void
  onSave?: () => void
  onCenterRoot?: () => void
  onToggleStylePanel?: () => void
  onToggleDocumentRefsPanel?: () => void
  canAddChild: boolean
  canAddSibling: boolean
  canRemove: boolean
  canUndo?: boolean
  canRedo?: boolean
  stylePanelOpen?: boolean
  documentRefsPanelOpen?: boolean
  hasDocumentRefs?: boolean
  /** Chat panel flags/actions: owned by chat, wired through the root. */
  chatOpen: boolean
  capsuleExpanded: boolean
  onToggleChatOpen: () => void
  /** AI readiness gate: when unavailable the chat entry is disabled with a red background hint. */
  aiReady?: boolean
  /** Style panel content; rendered below the toolbar when open. */
  stylePanel?: React.ReactNode
  /** Linked files panel content; rendered below the toolbar when open. */
  documentRefsPanel?: React.ReactNode
}

function ToolbarButton({
  onClick,
  disabled,
  ariaLabel,
  tooltip,
  icon,
  variant = 'default',
  active,
  unavailable,
}: {
  onClick: () => void
  disabled?: boolean
  ariaLabel: string
  tooltip: string
  icon: React.ReactNode
  variant?: 'default' | 'danger'
  active?: boolean
  /** Service unavailable: stays disabled with a red background hint (unlike the plain disabled fade). */
  unavailable?: boolean
}) {
  return (
    <div className="float-toolbar__btn-wrap">
      <button
        type="button"
        className={[
          'float-toolbar__btn',
          variant === 'danger' ? 'float-toolbar__btn--danger' : '',
          active ? 'float-toolbar__btn--active' : '',
          unavailable ? 'float-toolbar__btn--unavailable' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={active}
      >
        {icon}
      </button>
      <span className="float-toolbar__tooltip">{tooltip}</span>
    </div>
  )
}

export function MindmapHeader({
  onAddChild,
  onAddSibling,
  onRemove,
  onUndo,
  onRedo,
  onOpenSettings,
  onSwitchWorkspace,
  onSave,
  onCenterRoot,
  onToggleStylePanel,
  onToggleDocumentRefsPanel,
  canAddChild,
  canAddSibling,
  canRemove,
  canUndo,
  canRedo,
  stylePanelOpen,
  documentRefsPanelOpen,
  hasDocumentRefs,
  chatOpen,
  capsuleExpanded,
  onToggleChatOpen,
  aiReady = true,
  stylePanel,
  documentRefsPanel,
}: Props) {
  useEffect(() => {
    if (
      (!stylePanelOpen && !documentRefsPanelOpen) ||
      (!onToggleStylePanel && !onToggleDocumentRefsPanel)
    )
      return

    const dismissPanel = (event: PointerEvent) => {
      const target = event.target
      if (
        target instanceof Element &&
        (target.closest('.style-panel') ||
          target.closest('[aria-label="Mindmap style"]') ||
          target.closest('.document-refs-panel') ||
          target.closest('[aria-label="Linked files"]'))
      ) {
        return
      }
      if (stylePanelOpen) onToggleStylePanel?.()
      if (documentRefsPanelOpen) onToggleDocumentRefsPanel?.()
    }

    window.addEventListener('pointerdown', dismissPanel, true)
    return () => window.removeEventListener('pointerdown', dismissPanel, true)
  }, [onToggleStylePanel, onToggleDocumentRefsPanel, stylePanelOpen, documentRefsPanelOpen])

  return (
    <header
      className={`mindmap-header${capsuleExpanded ? ' mindmap-header--capsule-expanded' : ''}`}
    >
      <div className="mindmap-header__panel">
        <div className="mindmap-header__toolbar-viewport">
          <nav className="float-toolbar" aria-label="Mindmap actions">
            <div className="float-toolbar__group float-toolbar__group--edit">
              {onUndo && (
                <ToolbarButton
                  onClick={onUndo}
                  disabled={!canUndo}
                  ariaLabel="Undo"
                  tooltip="Undo (Ctrl+Z)"
                  icon={<Undo2 size={22} strokeWidth={1.5} />}
                />
              )}
              {onRedo && (
                <ToolbarButton
                  onClick={onRedo}
                  disabled={!canRedo}
                  ariaLabel="Redo"
                  tooltip="Redo (Ctrl+Shift+Z)"
                  icon={<Redo2 size={22} strokeWidth={1.5} />}
                />
              )}
              <ToolbarButton
                onClick={onAddChild}
                disabled={!canAddChild}
                ariaLabel="Add child topic"
                tooltip="Add child topic"
                icon={<GitBranch size={22} strokeWidth={1.5} />}
              />
              <ToolbarButton
                onClick={onAddSibling}
                disabled={!canAddSibling}
                ariaLabel="Add sibling topic"
                tooltip={
                  !canAddSibling ? 'The root node cannot have siblings' : 'Add sibling topic'
                }
                icon={<BetweenHorizontalStart size={22} strokeWidth={1.5} />}
              />
              <ToolbarButton
                onClick={onRemove}
                disabled={!canRemove}
                ariaLabel="Delete"
                tooltip="Delete"
                variant="danger"
                icon={<Trash2 size={22} strokeWidth={1.5} />}
              />
            </div>

            <div className="float-toolbar__divider" />

            <div className="float-toolbar__group float-toolbar__group--file">
              {onCenterRoot && (
                <ToolbarButton
                  onClick={onCenterRoot}
                  ariaLabel="Back to central topic"
                  tooltip="Back to central topic (Ctrl+0)"
                  icon={<Locate size={22} strokeWidth={1.5} />}
                />
              )}
              {onSave && (
                <ToolbarButton
                  onClick={onSave}
                  ariaLabel="Save"
                  tooltip="Save (Ctrl+S)"
                  icon={<Save size={22} strokeWidth={1.5} />}
                />
              )}
              {onSwitchWorkspace && (
                <ToolbarButton
                  onClick={onSwitchWorkspace}
                  ariaLabel="Switch workspace"
                  tooltip="Switch workspace"
                  icon={<FolderInput size={22} strokeWidth={1.5} />}
                />
              )}
            </div>

            <div className="float-toolbar__divider" />

            <div className="float-toolbar__group float-toolbar__group--system">
              {onToggleDocumentRefsPanel && (
                <ToolbarButton
                  onClick={onToggleDocumentRefsPanel}
                  disabled={!hasDocumentRefs}
                  ariaLabel="Linked files"
                  tooltip={!hasDocumentRefs ? 'No linked files' : 'Linked files'}
                  active={documentRefsPanelOpen}
                  icon={<Paperclip size={22} strokeWidth={1.5} />}
                />
              )}
              {onToggleStylePanel && (
                <ToolbarButton
                  onClick={onToggleStylePanel}
                  ariaLabel="Mindmap style"
                  tooltip="Mindmap style"
                  active={stylePanelOpen}
                  icon={<Palette size={22} strokeWidth={1.5} />}
                />
              )}
              {onOpenSettings && (
                <ToolbarButton
                  onClick={onOpenSettings}
                  ariaLabel="Open settings"
                  tooltip="Open settings"
                  icon={<Settings size={22} strokeWidth={1.5} />}
                />
              )}
              <ToolbarButton
                onClick={onToggleChatOpen}
                disabled={!aiReady}
                unavailable={!aiReady}
                ariaLabel={chatOpen ? 'Hide chat' : 'Show chat'}
                tooltip={
                  aiReady ? (chatOpen ? 'Hide chat' : 'Show chat') : 'Chat service unavailable'
                }
                active={aiReady && !chatOpen}
                icon={
                  chatOpen ? (
                    <MessageCircle size={22} strokeWidth={1.5} />
                  ) : (
                    <MessageCircleOff size={22} strokeWidth={1.5} />
                  )
                }
              />
            </div>
          </nav>
        </div>
        {stylePanel}
        {documentRefsPanel}
      </div>
    </header>
  )
}
