import { createContext } from 'react'
import type { ShortcutRegistry } from './ShortcutRegistry'

type RegistryContextValue = {
  registry: ShortcutRegistry
}

// 注意：本文件名不可与 Provider 文件仅差大小写（历史上曾用
// ShortcutRegistryContext.tsx 与之配对，Windows 大小写不敏感文件系统下
// Vite 会解析到错误文件导致启动白屏）。
export const ShortcutRegistryContext = createContext<RegistryContextValue | null>(null)
