import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MindmapHeader } from './Header'
import { MindmapCanvas } from './Canvas'
import { MindmapContextMenu } from './ContextMenu'
import { SelectionActionBar } from './SelectionActionBar'
import { PalaceModal } from './PalaceModal'
import { HiddenThumbnailFlow } from './HiddenThumbnailFlow'
import { StylePanel } from './StylePanel'
import { DocumentRefsPanel } from './DocumentRefsPanel'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveOpenFile'
import { useMindmapView, type MindmapSelectedTopic } from '@/features/mindmap/hooks/useMindmapView'

/** Props of both the public view and its inner workspace component. */
type MindmapViewProps = {
  onSwitchWorkspace?: () => void
  onOpenSettings?: () => void
  /** Generate-palace intent; the orchestration lives in chat and is wired by the root. */
  onGeneratePalace: (topics: MindmapSelectedTopic[]) => void
  syncAfterFileSaved: (filePath: string) => Promise<void>
  updateFilePreviewUrl: (filePath: string, previewUrl: string) => void
  chatOpen: boolean
  capsuleExpanded: boolean
  onToggleChatOpen: () => void
  aiReady: boolean
}

function MindmapWorkspace({
  onSwitchWorkspace,
  onOpenSettings,
  onGeneratePalace,
  syncAfterFileSaved,
  updateFilePreviewUrl,
  chatOpen,
  capsuleExpanded,
  onToggleChatOpen,
  aiReady,
}: MindmapViewProps) {
  const view = useMindmapView({ onGeneratePalace, syncAfterFileSaved, updateFilePreviewUrl })
  const { visualVariant, colorScheme } = useActiveMindmapStore((s) => s.style)

  return (
    <div className="mindmap-shell" data-map-style={visualVariant} data-color-scheme={colorScheme}>
      <MindmapHeader
        onAddChild={view.actions.addChild}
        onAddSibling={view.actions.addSibling}
        onRemove={view.actions.removeSelected}
        onUndo={view.actions.undo}
        onRedo={view.actions.redo}
        onOpenSettings={onOpenSettings}
        onSwitchWorkspace={onSwitchWorkspace}
        chatOpen={chatOpen}
        capsuleExpanded={capsuleExpanded}
        onToggleChatOpen={onToggleChatOpen}
        onSave={view.actions.save}
        onCenterRoot={() => void view.actions.centerRoot()}
        onToggleStylePanel={view.actions.toggleStylePanel}
        onToggleDocumentRefsPanel={view.actions.toggleDocumentRefsPanel}
        canAddChild={view.canAddChild}
        canAddSibling={view.canAddSibling}
        canRemove={view.canRemove}
        canUndo={view.canUndo}
        canRedo={view.canRedo}
        stylePanelOpen={view.stylePanelOpen}
        documentRefsPanelOpen={view.documentRefsPanelOpen}
        hasDocumentRefs={view.hasDocumentRefs}
        aiReady={aiReady}
        stylePanel={
          view.stylePanelOpen ? <StylePanel onClose={view.actions.closeStylePanel} /> : null
        }
        documentRefsPanel={
          view.documentRefsPanelOpen ? (
            <DocumentRefsPanel onClose={view.actions.closeDocumentRefsPanel} />
          ) : null
        }
      />
      <div className="mindmap-canvas-wrap">
        <MindmapCanvas
          nodes={view.nodes}
          edges={view.edges}
          nodeTypes={view.nodeTypes}
          edgeTypes={view.edgeTypes}
          disabled={view.aiBusy}
          {...view.canvas}
        />
        <SelectionActionBar
          selectedTopicCount={view.selectedTopicCount}
          onGeneratePalace={view.actions.generatePalace}
          aiBusy={view.aiBusy}
          palaceEnabled={view.palaceEnabled}
        />
        <MindmapContextMenu
          menu={view.contextMenu}
          menuRef={view.contextMenuRef}
          onClose={view.actions.closeContextMenu}
          onAddChild={view.actions.addChild}
          onAddSibling={view.actions.addSibling}
          onAddParent={view.actions.addParent}
          onRemove={view.actions.removeSelected}
          onReset={view.actions.reset}
          onGeneratePalace={view.actions.generatePalace}
          onInsertImage={view.actions.insertImage}
          canAddSibling={view.canAddSibling}
          canAddParent={view.canAddParent}
          canRemove={view.canRemove}
          aiBusy={view.aiBusy}
          selectedCount={view.selectedTopicCount || 1}
          palaceEnabled={view.palaceEnabled}
        />
        {view.palaceModal && (
          <PalaceModal data={view.palaceModal} onClose={view.actions.closePalaceModal} />
        )}
      </div>
      <div
        ref={view.hiddenFlowRef}
        aria-hidden="true"
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: '1200px',
          height: '800px',
          opacity: 0,
          pointerEvents: 'none',
          zIndex: -1,
        }}
      >
        <ReactFlowProvider>
          <HiddenThumbnailFlow
            nodes={view.nodes}
            edges={view.edges}
            nodeTypes={view.nodeTypes}
            edgeTypes={view.edgeTypes}
            onInit={view.hiddenRfInstanceRef}
          />
        </ReactFlowProvider>
      </div>
    </div>
  )
}

export function MindmapView(props: MindmapViewProps) {
  return (
    <ReactFlowProvider>
      <MindmapWorkspace {...props} />
    </ReactFlowProvider>
  )
}
