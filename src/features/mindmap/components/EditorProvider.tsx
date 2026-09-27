import { useState, useEffect, type ReactNode } from 'react'
import { OpenFileContext, type ActiveOpenFile } from '@/features/mindmap/hooks/useActiveOpenFile'
import { openFileRegistry } from '@/features/mindmap/model/openFileRegistry'

function resolveActiveInstance(): ActiveOpenFile {
  return openFileRegistry.getActive() ?? openFileRegistry.getDefault()
}

/**
 * 为 React 组件提供当前活动文件的 OpenFile。
 * 通过 OpenFileRegistry 实现多文件历史隔离：切换文件时保留各文件的历史栈。
 * 没有活动文件时回退到默认实例，保证组件始终能访问 store。
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
