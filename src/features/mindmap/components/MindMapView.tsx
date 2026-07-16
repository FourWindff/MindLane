import { ReactFlowProvider } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { MindMapHeader } from './MindMapHeader'
import { MindmapCanvas } from './MindmapCanvas'
import { MindMapContextMenu } from './MindMapContextMenu'
import { SelectionActionBar } from './SelectionActionBar'
import { AiProgressOverlay } from './AiProgressOverlay'
import { PalaceModal } from './PalaceModal'
import { HiddenThumbnailFlow } from './HiddenThumbnailFlow'
import { StylePanel } from './StylePanel'
import { DocumentRefsPanel } from './DocumentRefsPanel'
import { StyleProvider } from '@/features/mindmap/style/StyleContext'
import { useMindmapOperationController } from '@/features/mindmap/hooks/useMindmapOperationController'

function MindMapWorkspace({
  onSwitchWorkspace,
  onOpenSettings,
  chatOpen,
  capsuleExpanded,
  onToggleChat,
}: {
  onSwitchWorkspace?: () => void
  onOpenSettings?: () => void
  chatOpen: boolean
  capsuleExpanded: boolean
  onToggleChat: () => void
}) {
  const view = useMindmapOperationController()

  return (
    <div className="mindmap-shell">
      <MindMapHeader
        onAddChild={view.actions.addChild}
        onAddSibling={view.actions.addSibling}
        onRemove={view.actions.removeSelected}
        onUndo={view.actions.undo}
        onRedo={view.actions.redo}
        onOpenSettings={onOpenSettings}
        chatOpen={chatOpen}
        capsuleExpanded={capsuleExpanded}
        onToggleChat={onToggleChat}
        onSwitchWorkspace={onSwitchWorkspace}
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
        <AiProgressOverlay />
        <MindMapContextMenu
          menu={view.contextMenu}
          menuRef={view.contextMenuRef}
          onClose={view.actions.closeContextMenu}
          onAddChild={view.actions.addChild}
          onAddSibling={view.actions.addSibling}
          onRemove={view.actions.removeSelected}
          onReset={view.actions.reset}
          onGeneratePalace={view.actions.generatePalace}
          canAddSibling={view.canAddSibling}
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

export function MindMapView({
  onSwitchWorkspace,
  onOpenSettings,
  chatOpen,
  capsuleExpanded,
  onToggleChat,
}: {
  onSwitchWorkspace?: () => void
  onOpenSettings?: () => void
  chatOpen: boolean
  capsuleExpanded: boolean
  onToggleChat: () => void
}) {
  return (
    <StyleProvider>
      <ReactFlowProvider>
        <MindMapWorkspace
          onSwitchWorkspace={onSwitchWorkspace}
          onOpenSettings={onOpenSettings}
          chatOpen={chatOpen}
          capsuleExpanded={capsuleExpanded}
          onToggleChat={onToggleChat}
        />
      </ReactFlowProvider>
    </StyleProvider>
  )
}
