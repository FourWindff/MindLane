import { useAiStore } from './aiStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import { openFileRegistry, type OpenFileRegistry } from '@/features/mindmap/model/openFileRegistry'

/**
 * Keeps chat's file index and capsule data in step with the workspace and the
 * open files. The composition root registers it once; the workspace store no
 * longer pokes chat, so control flow matches the dependency direction
 * (chat observes workspace, never the other way around).
 *
 * Triggers:
 * - workspace change (tree / path): re-pull the capsule inputs;
 * - open-file registry change (rename / move / release): refresh the path index
 *   from the live instances and persist it, so the capsule shows the new path
 *   immediately and the next launch too;
 * - any write to the chat read model: re-apply the live paths, so a session
 *   pull that lands with the stale persisted mapping cannot clobber a fresh one.
 */
export function connectChatWorkspaceSync(
  registry: OpenFileRegistry = openFileRegistry,
): () => void {
  const unsubscribeWorkspace = useWorkspaceStore.subscribe((state, previous) => {
    if (state.tree === previous.tree && state.workspacePath === previous.workspacePath) return
    void useAiStore.getState().refreshCapsuleData()
  })
  const unsubscribeRegistry = registry.subscribe(() => reconcileOpenFilePaths(registry))
  const unsubscribeStore = useAiStore.subscribe(() => reconcileOpenFilePaths(registry))
  reconcileOpenFilePaths(registry)
  return () => {
    unsubscribeWorkspace()
    unsubscribeRegistry()
    unsubscribeStore()
  }
}

/** Mirrors every open file's live path into chat's index and the persisted mapping. */
function reconcileOpenFilePaths(registry: OpenFileRegistry): void {
  for (const instance of registry.list()) {
    const { fileUuid, filePath } = instance.store.getState()
    if (!fileUuid || !filePath) continue
    const { fileUuidPaths, workspacePath } = useAiStore.getState()
    if (fileUuidPaths[fileUuid] === filePath) continue
    useAiStore.getState().updateFileUuidPath(fileUuid, filePath)
    if (!workspacePath) continue
    // Persist the mapping through the bridge so the next launch can render the
    // capsule bar; a failure here does not block the current projection.
    void window.mindlane?.workspace
      .updateFileUuidPath({ workspacePath, fileUuid, filePath })
      .catch(() => {})
  }
}
