import { useState } from 'react'
import { TextPromptDialog } from '@/shared/components/TextPromptDialog'
import { useWorkspaceStore } from '../store'

function workspaceName(workspacePath: string): string {
  const normalizedPath = workspacePath.replace(/\\/g, '/')
  const parts = normalizedPath.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? workspacePath
}

export function WorkspaceHome() {
  const [createOpen, setCreateOpen] = useState(false)
  const busy = useWorkspaceStore((s) => s.busy)
  const recentWorkspacePaths = useWorkspaceStore((s) => s.recentWorkspacePaths)
  const lastError = useWorkspaceStore((s) => s.lastError)
  const clearError = useWorkspaceStore((s) => s.clearError)
  const openWorkspaceDirectory = useWorkspaceStore((s) => s.openWorkspaceDirectory)
  const createWorkspaceDirectory = useWorkspaceStore((s) => s.createWorkspaceDirectory)
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace)

  const handleCreateWorkspace = async (name: string) => {
    const ok = await createWorkspaceDirectory(name)
    if (ok) setCreateOpen(false)
  }

  return (
    <section className="workspace-home">
      <div className="workspace-home__frame">
        <div className="workspace-home__recent">
          <div className="workspace-home__section-label">最近打开</div>
          <h2 className="workspace-home__title">工作目录</h2>
          {recentWorkspacePaths.length > 0 ? (
            <div className="workspace-home__recent-list">
              {recentWorkspacePaths.map((workspacePath) => (
                <button
                  key={workspacePath}
                  type="button"
                  className="workspace-home__recent-item"
                  onClick={() => void switchWorkspace(workspacePath)}
                  disabled={busy}
                >
                  <span className="workspace-home__recent-name">
                    {workspaceName(workspacePath)}
                  </span>
                  <span className="workspace-home__recent-path">{workspacePath}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="workspace-home__empty">
              还没有最近打开的工作目录，先创建一个仓库或打开本地仓库。
            </div>
          )}
        </div>

        <div className="workspace-home__hero">
          <img
            className="workspace-home__logo"
            src="/assets/mindlane-logo.svg"
            alt="MindLane logo"
          />
          <div className="workspace-home__hero-text">
            <div className="workspace-home__section-label">MindLane</div>
            <h1 className="workspace-home__hero-title">围绕工作目录管理导图文件</h1>
            <p className="workspace-home__hero-subtitle">
              打开一个工作目录后，只展示可用的 `.mindlane`
              文档；再次启动时自动恢复你上次的仓库与文件。
            </p>
          </div>
          <div className="workspace-home__actions">
            <button
              type="button"
              className="workspace-home__action workspace-home__action--primary"
              onClick={() => setCreateOpen(true)}
              disabled={busy}
            >
              在指定文件夹下创建新的仓库
            </button>
            <button
              type="button"
              className="workspace-home__action"
              onClick={() => void openWorkspaceDirectory()}
              disabled={busy}
            >
              打开本地仓库
            </button>
          </div>
          {lastError && (
            <div className="workspace-home__error" role="alert">
              <span>{lastError}</span>
              <button type="button" className="workspace-home__error-close" onClick={clearError}>
                关闭
              </button>
            </div>
          )}
        </div>
      </div>
      {createOpen && (
        <TextPromptDialog
          label="新建仓库"
          title="输入仓库名称"
          subtitle="确认名称后，会继续让你选择父目录，并在其中创建同名工作区。"
          placeholder="例如：我的知识库"
          confirmLabel="继续选择位置"
          disabled={busy}
          backdropClassName="workspace-modal-backdrop workspace-home__modal-backdrop"
          onConfirm={(name) => void handleCreateWorkspace(name)}
          onCancel={() => setCreateOpen(false)}
        />
      )}
    </section>
  )
}
