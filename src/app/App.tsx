import { useEffect, useState } from 'react'
import { MindmapView } from '@/features/mindmap/components/View'
import { useActiveMindmapStore } from '@/features/mindmap/hooks/useActiveOpenFile'
import { SettingsModal } from '@/features/settings/components/SettingsModal'
import type { SettingsFileActions } from '@/features/settings/components/SettingsPanel'
import { loadSettingsFromBackend, useSettingsStore } from '@/features/settings/model/settingsStore'
import { ChatInputBar } from '@/features/chat/components/ChatInputBar'
import { ChatMessageList } from '@/features/chat/components/ChatMessageList'
import { ChatCapsuleBar } from '@/features/chat/components/ChatCapsuleBar'
import { WorkspaceHome } from '@/features/workspace/components/WorkspaceHome'
import { FileManager } from '@/features/workspace/components/FileManager'
import {
  initializeWorkspaceSession,
  saveCurrentDocumentSilently,
  useWorkspaceStore,
} from '@/features/workspace/store'
import { AppWindowBar } from '@/app/shell/components/AppWindowBar'
import { AppToolbar } from '@/app/shell/components/AppToolbar'
import { AgentWriteSimulator } from '@/app/shell/components/AgentWriteSimulator'
import { MindmapEditorProvider } from '@/features/mindmap/components/EditorProvider'
import { useShortcuts } from '@/shared/shortcuts/useRegisterShortcut'
import {
  connectAiStore,
  subscribeToChatStreamEvents,
  useAiStore,
} from '@/features/chat/model/aiStore'
import { connectAiWritingProjection } from '@/features/chat/model/aiWritingProjection'
import { usePalaceGeneration } from '@/features/chat/model/usePalaceGeneration'
import { connectMindmapReadResponder } from '@/features/chat/model/mindmapReadResponder'
import { createMindmapWriteResponder } from '@/features/chat/model/mindmapWriteResponder'
import { createMindmapEndEffects } from '@/features/chat/model/mindmapEndEffects'
import { backfillEntryFileTitle } from '@/features/chat/lib/entryConversation'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'
import { saveOpenFile } from '@/features/mindmap/model/saveOpenFile'
import { reportRendererError, reportRendererWarning } from '@/shared/lib/reportRendererError'
import './styles/app-shell.css'
import '@/features/workspace/workspace.css'
import '@/features/mindmap/styles/mindmap.css'

type SyncAfterFileSaved = (filePath: string) => Promise<void>

/** Settings panel "open file": dialog → load into the registry → sync the workspace tree. */
async function openFileFromDialog(syncAfterFileSaved: SyncAfterFileSaved): Promise<void> {
  const result = await window.mindlane?.file.open()
  if (!result?.ok) return
  const instance = openFileRegistry.getOrCreate(result.data.filePath)
  instance.load(result.data.filePath, result.data.data, null)
  openFileRegistry.setActive(result.data.filePath)
  await syncAfterFileSaved(result.data.filePath)
}

/** Settings panel "save now": the shared save protocol (dirty check + error routing). */
async function saveActiveFile(syncAfterFileSaved: SyncAfterFileSaved): Promise<void> {
  const instance = openFileRegistry.getActive()
  if (!instance) return
  await saveOpenFile(instance.store, {
    syncAfterFileSaved,
    onError: reportRendererError,
  })
}

/** Settings panel "save as": dialog → load the new path → sync the workspace tree. */
async function saveActiveFileAs(
  workspacePath: string | null,
  syncAfterFileSaved: SyncAfterFileSaved,
): Promise<void> {
  const instance = openFileRegistry.getActive()
  if (!instance) return
  const result = await window.mindlane?.file.saveAs({
    data: instance.store.getState().toMindLaneFile(),
  })
  if (!result?.ok) return
  const next = openFileRegistry.getOrCreate(result.data.filePath)
  next.load(result.data.filePath, result.data.data, workspacePath)
  openFileRegistry.setActive(result.data.filePath)
  await syncAfterFileSaved(result.data.filePath)
}

function WorkspaceEmptyState() {
  const busy = useWorkspaceStore((s) => s.busy)
  const openWorkspaceDirectory = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const createMindLaneFile = useWorkspaceStore((s) => s.createMindLaneFile)

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
            onClick={() => void createMindLaneFile('未命名')}
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
  const chatOpen = useAiStore((s) => s.chatOpen)
  const capsuleExpanded = useAiStore((s) => s.capsuleExpanded)
  const setChatOpen = useAiStore((s) => s.setChatOpen)
  const setCapsuleExpanded = useAiStore((s) => s.setCapsuleExpanded)
  // Palace generation is chat orchestration; the mindmap only emits the intent.
  const generatePalace = usePalaceGeneration()
  // AI 服务就绪：启动时经桥读取一次，只读向下传递（不建状态机）。
  const [aiReady, setAiReady] = useState(false)
  const loaded = useSettingsStore((s) => s.loaded)
  const workspaceInitialized = useWorkspaceStore((s) => s.initialized)
  const workspaceInitializing = useWorkspaceStore((s) => s.initializing)
  const workspacePath = useWorkspaceStore((s) => s.workspacePath)
  const switchWorkspace = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const syncAfterFileSaved = useWorkspaceStore((s) => s.syncAfterFileSaved)
  const updateFilePreviewUrl = useWorkspaceStore((s) => s.updateFilePreviewUrl)
  const restoreLastWorkspaceOnLaunch = useWorkspaceStore((s) => s.restoreLastWorkspaceOnLaunch)
  const setRestoreLastWorkspaceOnLaunch = useWorkspaceStore(
    (s) => s.setRestoreLastWorkspaceOnLaunch,
  )
  const settingsFileActions: SettingsFileActions = {
    workspacePath,
    restoreLastWorkspaceOnLaunch,
    setRestoreLastWorkspaceOnLaunch: (enabled) => void setRestoreLastWorkspaceOnLaunch(enabled),
    openWorkspaceDirectory: () => void switchWorkspace(),
    openFile: () => void openFileFromDialog(syncAfterFileSaved),
    saveActiveFile: () => void saveActiveFile(syncAfterFileSaved),
    saveActiveFileAs: () => void saveActiveFileAs(workspacePath, syncAfterFileSaved),
  }
  const hasDocumentOpen = useActiveMindmapStore((s) => s.hasDocumentOpen)
  const filePath = useActiveMindmapStore((s) => s.filePath)

  useEffect(() => {
    void loadSettingsFromBackend()
    void window.mindlane?.ai.isReady().then((ready) => {
      setAiReady(ready)
      // AI 服务就绪 = 会话服务可用：补刷一次胶囊条持久输入，
      // 覆盖启动早期 refreshCapsuleData 遇 not-ready 后重试耗尽的情况。
      if (ready) void useAiStore.getState().refreshCapsuleData()
    })
    const disconnectAiStore = connectAiStore(openFileRegistry)
    // 「文件正在被 AI 写入」是打开的文件自己的状态：chat 订阅自己的每文件忙闲，
    // 单点投影进打开的文件；导图侧读文件，不读 chat。
    const disconnectAiWriting = connectAiWritingProjection(openFileRegistry)
    // 按需读导图应答器：主进程经反向通道拉实时导图时，按 fileUuid 取编辑器回包。
    const disconnectMindmapReadResponder = connectMindmapReadResponder()
    // 落盘应答器：主进程转发写工具参数，这里按 fileUuid 串行化校验+落图并回 ack。
    const stopWriteResponder = createMindmapWriteResponder({
      subscribe: (listener) => window.mindlane?.ai.onMindmapWriteRequest(listener) ?? (() => {}),
      resolveEditor: (fileUuid) => openFileRegistry.getByFileUuid(fileUuid)?.editor,
      persistFile: (fileUuid) => {
        const instance = openFileRegistry.getByFileUuid(fileUuid)
        if (!instance) return
        void saveOpenFile(instance.store, {
          syncAfterFileSaved: useWorkspaceStore.getState().syncAfterFileSaved,
          // A write-tool persist failure is reported per file: errors have no
          // renderer UI anymore, they only enter the diagnostic log.
          onError: (message) => reportRendererError(`[${fileUuid}] ${message}`),
        })
      },
      respond: (payload) => void window.mindlane?.ai.respondMindmapWrite(payload),
      warn: reportRendererWarning,
    }).start()
    const stopToolRouter = createMindmapEndEffects({
      subscribe: subscribeToChatStreamEvents,
      resolveFileUuid: (sessionId) => useAiStore.getState().sessionFileUuids[sessionId],
      getEditor: (fileUuid) => openFileRegistry.getByFileUuid(fileUuid)?.editor,
      // Entry-turn files start with a placeholder title; the generated map title
      // backfills it (only files the entry turn created are renamed).
      backfillTitle: backfillEntryFileTitle,
    }).start()
    return () => {
      stopToolRouter()
      stopWriteResponder()
      disconnectAiWriting()
      disconnectAiStore()
      disconnectMindmapReadResponder()
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

  useShortcuts(
    [
      ['app.openSettings', 'mod+comma', '打开设置', () => setSettingsOpen(true)],
      [
        'app.openFileManager',
        'mod+shift+f',
        '打开文件管理器',
        () => setFileManagerOpen((open) => !open),
      ],
    ],
    { group: 'app', preventWhenTyping: false },
  )

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
              <AppToolbar
                onOpenFileManager={() => setFileManagerOpen(true)}
                fileManagerOpen={fileManagerOpen}
                filePath={filePath ?? undefined}
              />
              {/* Dev-only visual QA panel for agent write animations; tree-shaken out of production builds */}
              {hasDocumentOpen && import.meta.env.DEV && <AgentWriteSimulator />}
              {hasDocumentOpen ? (
                <MindmapView
                  onSwitchWorkspace={() => void switchWorkspace()}
                  onOpenSettings={() => setSettingsOpen(true)}
                  onGeneratePalace={generatePalace}
                  syncAfterFileSaved={syncAfterFileSaved}
                  updateFilePreviewUrl={updateFilePreviewUrl}
                  chatOpen={chatOpen}
                  capsuleExpanded={capsuleExpanded}
                  onToggleChatOpen={() => setChatOpen(!chatOpen)}
                  aiReady={aiReady}
                />
              ) : (
                <WorkspaceEmptyState />
              )}
            </main>
            <aside
              className={`chat-panel${hasDocumentOpen ? '' : ' chat-panel--entry'}`}
              aria-label="聊天面板"
            >
              <ChatCapsuleBar
                expanded={capsuleExpanded}
                onToggleExpand={() => setCapsuleExpanded(!capsuleExpanded)}
              />
              {chatOpen && (
                <>
                  {/* No file open = entry conversation: input box only; sending creates and opens the file. */}
                  {hasDocumentOpen && <ChatMessageList />}
                  <ChatInputBar onOpenSettings={() => setSettingsOpen(true)} />
                </>
              )}
            </aside>
            <SettingsModal
              open={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              fileActions={settingsFileActions}
            />
            <FileManager isOpen={fileManagerOpen} onClose={() => setFileManagerOpen(false)} />
          </div>
        )}
      </div>
    </div>
  )
}

export function App() {
  return (
    <MindmapEditorProvider>
      <AppContent />
    </MindmapEditorProvider>
  )
}
