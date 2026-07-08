import { useState, useEffect, type ReactNode } from 'react'
import {
  MindmapInstanceContext,
  type ActiveMindmapInstance,
} from '@/features/mindmap/hooks/useActiveMindmapInstance'
import { mindmapRegistry } from '@/features/mindmap/model/mindmapRegistry'

function resolveActiveInstance(): ActiveMindmapInstance {
  return mindmapRegistry.getActive() ?? mindmapRegistry.getDefault()
}

/**
 * 为 React 组件提供当前活动文件的 MindmapInstance。
 * 通过 MindmapRegistry 实现多文件历史隔离：切换文件时保留各文件的历史栈。
 * 没有活动文件时回退到默认实例，保证组件始终能访问 store。
 */
export function MindmapEditorProvider({ children }: { children: ReactNode }) {
  const [instance, setInstance] = useState<ActiveMindmapInstance>(resolveActiveInstance)

  useEffect(() => {
    return mindmapRegistry.subscribe(() => {
      setInstance(resolveActiveInstance())
    })
  }, [])

  return (
    <MindmapInstanceContext.Provider value={instance}>{children}</MindmapInstanceContext.Provider>
  )
}
