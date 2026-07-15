import { useEffect, useState } from 'react'
import { MindMapView } from '@/features/mindmap/components/MindMapView'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveMindmapStore'
import { SettingsModal } from '@/features/settings/components/SettingsModal'
import { loadSettingsFromBackend, useSettingsStore } from '@/features/settings/model/settingsStore'
import { loadMindmapStyleFromBackend } from '@/features/mindmap/style/styleStore'
import { ChatPanel } from '@/features/chat/components/ChatPanel'
import { WorkspaceHome } from '@/features/workspace/components/WorkspaceHome'
import { FileManager } from '@/features/workspace/components/FileManager'
import {
  initializeWorkspaceSession,
  saveCurrentDocumentSilently,
  useWorkspaceStore,
} from '@/features/workspace/store'
import { AppWindowBar } from '@/features/shell/components/AppWindowBar'
import { AppToolbar } from '@/features/shell/components/AppToolbar'
import { MindmapEditorProvider } from '@/features/mindmap/components/MindmapEditorProvider'
import { ShortcutRegistryProvider } from '@/shared/shortcuts/ShortcutRegistryContext'
import { useShortcut } from '@/shared/shortcuts/useRegisterShortcut'
import { ToastContainer } from '@/shared/components/ToastContainer'
import {
  connectAiStore,
  subscribeToChatStreamEvents,
  useAiStore,
} from '@/features/chat/model/aiStore'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'
import { createMindmapToolCallRouter } from '@/features/chat/model/mindmapToolCallRouter'
import { handleMindmapToolCall, MINDMAP_ACTION_TOOLS } from '@/features/chat/lib/aiToolCalls'
import './styles/app-shell.css'
import '@/shared/components/toast.css'
import '@/features/workspace/workspace.css'
import '@/features/mindmap/styles/mindmap.css'

function WorkspaceEmptyState() {
  const busy = useWorkspaceStore((s) => s.busy)
  const openWorkspaceDirectory = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const createMindlaneFile = useWorkspaceStore((s) => s.createMindlaneFile)

  return (
    <div className="workspace-empty">
      <div className="workspace-empty__card">
        <div className="workspace-empty__label">工作区已就绪</div>
        <h2 className="workspace-empty__title">选择一个 .mindlane 文件开始编辑</h2>
        <p className="workspace-empty__subtitle">
          左侧显示当前工作目录中的文档。你也可以先在空白画布上编辑，再通过"另存为"保存到当前仓库。
        </p>
        <div className="workspace-empty__actions">
          <button
            type="button"
            className="workspace-empty__action workspace-empty__action--primary"
            onClick={() => void createMindlaneFile('未命名')}
            disabled={busy}
          >
            新建 .mindlane 文件
          </button>
          <button
            type="button"
            className="workspace-empty__action"
            onClick={() => void openWorkspaceDirectory()}
            disabled={busy}
          >
            切换仓库
          </button>
        </div>
      </div>
    </div>
  )
}

function AppContent() {
  const [fileManagerOpen, setFileManagerOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loaded = useSettingsStore((s) => s.loaded)
  const workspaceInitialized = useWorkspaceStore((s) => s.initialized)
  const workspaceInitializing = useWorkspaceStore((s) => s.initializing)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const switchWorkspace = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const hasDocumentOpen = useActiveMindmapStore((s) => s.hasDocumentOpen)
  const filePath = useActiveMindmapStore((s) => s.filePath)

  useEffect(() => {
    void loadSettingsFromBackend()
    void loadMindmapStyleFromBackend()
    const disconnectAiStore = connectAiStore(mindmapRegistry)
    const stopToolRouter = createMindmapToolCallRouter({
      subscribe: subscribeToChatStreamEvents,
      resolveFileUuid: (sessionId) => useAiStore.getState().sessionFileUuids[sessionId],
      getEditor: (fileUuid) => mindmapRegistry.getByFileUuid(fileUuid)?.editor,
      handleToolCall: (toolCall, editor) => handleMindmapToolCall(toolCall, editor as never),
      actionToolNames: MINDMAP_ACTION_TOOLS,
    }).start()
    return () => {
      stopToolRouter()
      disconnectAiStore()
    }
  }, [])

  useEffect(() => {
    return window.mindlane?.window.onBeforeClose(() => {
      void saveCurrentDocumentSilently().finally(() => {
        window.mindlane?.window.closeConfirmed()
      })
    })
  }, [])

  useEffect(() => {
    if (!loaded || workspaceInitialized || workspaceInitializing) return
    void initializeWorkspaceSession()
  }, [loaded, workspaceInitialized, workspaceInitializing])

  useShortcut({
    id: 'app.openSettings',
    combo: 'mod+comma',
    description: '打开设置',
    group: 'app',
    preventWhenTyping: false,
    handler: () => {
      setSettingsOpen(true)
    },
  })

  useShortcut({
    id: 'app.openFileManager',
    combo: 'mod+shift+f',
    description: '打开文件管理器',
    group: 'app',
    preventWhenTyping: false,
    handler: () => {
      setFileManagerOpen((open) => !open)
    },
  })

  return (
    <div className="app-frame">
      <AppWindowBar />
      <div className="app-frame__content">
        {!loaded || !workspaceInitialized ? (
          <div className="app-shell app-shell--loading">
            <span style={{ color: '#888', fontSize: '0.9rem' }}>加载配置中…</span>
          </div>
        ) : !workspacePath ? (
          <WorkspaceHome />
        ) : (
          <div className="app-shell">
            <main className="app-shell__main">
              {workspacePath && (
                <AppToolbar
                  onOpenFileManager={() => setFileManagerOpen(true)}
                  fileManagerOpen={fileManagerOpen}
                  filePath={filePath ?? undefined}
                />
              )}
              {hasDocumentOpen ? (
                <MindMapView
                  onSwitchWorkspace={() => void switchWorkspace()}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              ) : (
                <WorkspaceEmptyState />
              )}
            </main>
            {hasDocumentOpen && <ChatPanel />}
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            <FileManager isOpen={fileManagerOpen} onClose={() => setFileManagerOpen(false)} />
            <ToastContainer />
          </div>
        )}
      </div>
    </div>
  )
}

export function App() {
  return (
    <ShortcutRegistryProvider>
      <MindmapEditorProvider>
        <AppContent />
      </MindmapEditorProvider>
    </ShortcutRegistryProvider>
  )
}
