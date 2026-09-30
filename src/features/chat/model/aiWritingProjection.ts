import { useAiStore } from './aiStore'
import { openFileRegistry, type OpenFileRegistry } from '@/features/mindmap/model/openFileRegistry'

/**
 * Projects each file's chat busy flag onto its open file instance.
 *
 * Single writer: the stream lifecycle only updates the chat store, and this one
 * subscription mirrors the flags onto the open files, so no setter has to
 * remember the projection. Writing the flag notifies the file's own listeners
 * only (never the mindmap store), which keeps autosave subscribers out of
 * busy/idle transitions.
 */
export function connectAiWritingProjection(
  registry: OpenFileRegistry = openFileRegistry,
): () => void {
  const sync = () => {
    const { fileChats } = useAiStore.getState()
    for (const instance of registry.list()) {
      const { fileUuid } = instance.store.getState()
      instance.setAiWriting(Boolean(fileChats[fileUuid]?.busy))
    }
  }
  const unsubscribeStore = useAiStore.subscribe(sync)
  const unsubscribeRegistry = registry.subscribe(sync)
  sync()
  return () => {
    unsubscribeStore()
    unsubscribeRegistry()
  }
}
