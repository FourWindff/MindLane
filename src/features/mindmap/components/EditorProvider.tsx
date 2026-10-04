import { useState, useEffect, type ReactNode } from 'react'
import { OpenFileContext, type ActiveOpenFile } from '@/features/mindmap/hooks/useActiveOpenFile'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'

function resolveActiveInstance(): ActiveOpenFile {
  return openFileRegistry.getActive() ?? openFileRegistry.getDefault()
}

/**
 * Provide React components with the OpenFile of the currently active file.
 * The OpenFileRegistry isolates history per file: switching files keeps each file's history stack.
 * With no active file it falls back to the default instance, so components always reach a store.
 */
export function MindmapEditorProvider({ children }: { children: ReactNode }) {
  const [instance, setInstance] = useState<ActiveOpenFile>(resolveActiveInstance)

  useEffect(() => {
    return openFileRegistry.subscribe(() => {
      setInstance(resolveActiveInstance())
    })
  }, [])

  return <OpenFileContext.Provider value={instance}>{children}</OpenFileContext.Provider>
}
