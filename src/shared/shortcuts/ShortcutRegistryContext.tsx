import { createContext, useEffect, useMemo, type ReactNode } from 'react'
import { createShortcutRegistry } from './ShortcutRegistry'
import type { ShortcutRegistry } from './ShortcutRegistry'

type RegistryContextValue = {
  registry: ShortcutRegistry
}

// 注意：context 对象与此 Provider 同居一文件 —— 历史上曾拆成
// shortcutRegistryContext.ts（仅大小写不同），Windows 大小写不敏感文件系统下
// Vite 会误解析到错误文件导致「启动白屏」。勿再拆分。
export const ShortcutRegistryContext = createContext<RegistryContextValue | null>(null)

export function ShortcutRegistryProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => createShortcutRegistry(), [])

  useEffect(() => registry.attachKeyboard(), [registry])

  const value = useMemo(() => ({ registry }), [registry])

  return (
    <ShortcutRegistryContext.Provider value={value}>{children}</ShortcutRegistryContext.Provider>
  )
}
