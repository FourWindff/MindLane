import { useAiStore } from './aiStore'
import { useWorkspaceStore } from '@/features/workspace/store'
import { openFileRegistry, type OpenFileRegistry } from '@/features/mindmap/model/openFileRegistry'

/**
 * Keeps chat's file index and capsule data in step with the workspace and the
 * open files. The composition root registers it once; the workspace store no
 * longer pokes chat, so control flow matches the dependency direction
 * (chat observes workspace, never the other way around).
 *
 * Two triggers:
 * - workspace change (tree / path): re-pull the capsule inputs, then re-apply
 *   the live open-file paths so an in-flight persist cannot clobber a newer one;
 * - open-file registry change (rename / move / release): refresh the path index
 *   from the live instances and persist it, so the capsule shows the new path
 *   immediately and the next launch too.
 */
export function connectChatWorkspaceSync(
  registry: OpenFileRegistry = openFileRegistry,
): () => void {
  const reprojectFromWorkspace = () => {
    void useAiStore
      .getState()
      .refreshCapsuleData()
      .then(() => reconcileOpenFilePaths(registry))
  }

  const unsubscribeWorkspace = useWorkspaceStore.subscribe((state, previous) => {
    if (state.tree === previous.tree && state.workspacePath === previous.workspacePath) return
    reprojectFromWorkspace()
  })
  const unsubscribeRegistry = registry.subscribe(() => reconcileOpenFilePaths(registry))
  reconcileOpenFilePaths(registry)
  return () => {
    unsubscribeWorkspace()
    unsubscribeRegistry()
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
    // 经桥落盘持久映射，供下次启动渲染胶囊条；失败不阻断本次投影。
    void window.mindlane?.workspace
      .updateFileUuidPath({ workspacePath, fileUuid, filePath })
      .catch(() => {})
  }
}
