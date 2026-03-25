import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from 'react'
import { createShortcutRegistry, type ShortcutRegistry } from './ShortcutRegistry'

type RegistryContextValue = {
  registry: ShortcutRegistry
}

const ShortcutRegistryContext = createContext<RegistryContextValue | null>(null)

export function ShortcutRegistryProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => createShortcutRegistry(), [])

  useEffect(() => registry.attachKeyboard(), [registry])

  const value = useMemo(() => ({ registry }), [registry])

  return (
    <ShortcutRegistryContext.Provider value={value}>
      {children}
    </ShortcutRegistryContext.Provider>
  )
}

export function useShortcutRegistry(): ShortcutRegistry {
  const ctx = useContext(ShortcutRegistryContext)
  if (!ctx) {
    throw new Error('useShortcutRegistry 须在 ShortcutRegistryProvider 内使用')
  }
  return ctx.registry
}

export function useOptionalShortcutRegistry(): ShortcutRegistry | null {
  return useContext(ShortcutRegistryContext)?.registry ?? null
}
