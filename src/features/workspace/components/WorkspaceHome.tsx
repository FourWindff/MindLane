import { useState } from 'react'
import { TextPromptDialog } from '@/features/workspace/components/TextPromptDialog'
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
          <div className="workspace-home__section-label">Recently opened</div>
          <h2 className="workspace-home__title">Workspace directories</h2>
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
              No recently opened workspace directories yet. Create a repository or open a local one
              first.
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
            <h1 className="workspace-home__hero-title">
              Manage your mindmap files around workspace directories
            </h1>
            <p className="workspace-home__hero-subtitle">
              Once you open a workspace directory, only the available `.mindlane` documents are
              shown; on the next launch the last repository and file are restored automatically.
            </p>
          </div>
          <div className="workspace-home__actions">
            <button
              type="button"
              className="workspace-home__action workspace-home__action--primary"
              onClick={() => setCreateOpen(true)}
              disabled={busy}
            >
              Create a new repository in a chosen folder
            </button>
            <button
              type="button"
              className="workspace-home__action"
              onClick={() => void openWorkspaceDirectory()}
              disabled={busy}
            >
              Open a local repository
            </button>
          </div>
          {lastError && (
            <div className="workspace-home__error" role="alert">
              <span>{lastError}</span>
              <button type="button" className="workspace-home__error-close" onClick={clearError}>
                Close
              </button>
            </div>
          )}
        </div>
      </div>
      {createOpen && (
        <TextPromptDialog
          label="New repository"
          title="Repository name"
          subtitle="After you confirm the name, you pick a parent folder and the workspace is created there with the same name."
          placeholder="e.g. My knowledge base"
          confirmLabel="Choose location"
          disabled={busy}
          backdropClassName="workspace-modal-backdrop workspace-home__modal-backdrop"
          onConfirm={(name) => void handleCreateWorkspace(name)}
          onCancel={() => setCreateOpen(false)}
        />
      )}
    </section>
  )
}
