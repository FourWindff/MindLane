import { useAiStore } from './aiStore'
import { useWorkspaceStore } from '@/features/workspace/store'

/**
 * Keeps the capsule bar in step with the workspace. Rename, move and delete are
 * database writes in the main process, so the renderer only has to re-pull the
 * single capsule query when the workspace tree changes; there is no path
 * write-back to repair afterwards. The composition root registers it once.
 */
export function connectChatWorkspaceSync(): () => void {
  return useWorkspaceStore.subscribe((state, previous) => {
    if (state.tree === previous.tree && state.workspacePath === previous.workspacePath) return
    void useAiStore.getState().refreshCapsuleData()
  })
}
