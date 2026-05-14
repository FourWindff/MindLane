import { useEffect, useState } from 'react'
import { MindMapView } from '@/features/mindmap/components/MindMapView'
import { useMindmapStore } from '@/features/mindmap/model/mindmapStore'
import { SettingsModal } from '@/features/settings/components/SettingsModal'
import { loadSettingsFromBackend, useSettingsStore } from '@/features/settings/model/settingsStore'
import { ChatPanel } from '@/features/chat/components/ChatPanel'
import { WorkspaceHome } from '@/features/workspace/components/WorkspaceHome'
import { WorkspaceSidebar } from '@/features/workspace/components/WorkspaceSidebar'
import {
  initializeWorkspaceSession,
  saveCurrentDocumentSilently,
  useWorkspaceStore,
} from '@/features/workspace/store'
import { AppWindowBar } from '@/features/shell/components/AppWindowBar'
import { SidePanel, type SidePanelTab } from '@/features/shell/components/SidePanel'
import { ShortcutRegistryProvider, useShortcut } from '@/shared/shortcuts'
import './styles/app-shell.css'
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
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true)
  const [sidePanelOpen, setSidePanelOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<SidePanelTab>('chat')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const loaded = useSettingsStore((s) => s.loaded)
  const workspaceInitialized = useWorkspaceStore((s) => s.initialized)
  const workspaceInitializing = useWorkspaceStore((s) => s.initializing)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const switchWorkspace = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const hasDocumentOpen = useMindmapStore((s) => s.hasDocumentOpen)
  const canToggleLeftSidebar = Boolean(workspacePath)
  const canToggleRightSidebar = Boolean(workspacePath && hasDocumentOpen)

  useEffect(() => {
    void loadSettingsFromBackend()
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

  useShortcut(
    {
      id: 'app.openSettings',
      combo: 'mod+comma',
      description: '打开设置',
      group: 'app',
      preventWhenTyping: false,
      handler: () => {
        setSettingsOpen(true)
      },
    },
  )

  return (
    <div className="app-frame">
      <AppWindowBar
        canToggleLeftSidebar={canToggleLeftSidebar}
        canToggleRightSidebar={canToggleRightSidebar}
        leftSidebarOpen={leftSidebarOpen}
        rightSidebarOpen={canToggleRightSidebar && sidePanelOpen}
        onToggleLeftSidebar={() => setLeftSidebarOpen((open) => !open)}
        onToggleRightSidebar={() => {
          if (!canToggleRightSidebar) return
          setSidePanelOpen((open) => !open)
        }}
      />
      <div className="app-frame__content">
        {!loaded || !workspaceInitialized ? (
          <div className="app-shell app-shell--loading">
            <span style={{ color: '#888', fontSize: '0.9rem' }}>加载配置中…</span>
          </div>
        ) : !workspacePath ? (
          <WorkspaceHome />
        ) : (
          <div className="app-shell">
            <div
              className={`workspace-layout__sidebar${leftSidebarOpen ? '' : ' workspace-layout__sidebar--collapsed'}`}
            >
              {leftSidebarOpen && <WorkspaceSidebar onOpenSettings={() => setSettingsOpen(true)} />}
            </div>
            <div className="workspace-layout">
              <main className="app-shell__main">
                {hasDocumentOpen ? (
                  <MindMapView
                    onSwitchWorkspace={() => void switchWorkspace()}
                    onOpenSettings={() => setSettingsOpen(true)}
                  />
                ) : (
                  <WorkspaceEmptyState />
                )}
              </main>
              <SidePanel
                open={canToggleRightSidebar && sidePanelOpen}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              >
                {{
                  chat: <ChatPanel />,
                }}
              </SidePanel>
            </div>
            <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
          </div>
        )}
      </div>
    </div>
  )
}

export function App() {
  return (
    <ShortcutRegistryProvider>
      <AppContent />
    </ShortcutRegistryProvider>
  )
}
