import { createContext } from 'react'
import type { ShortcutRegistry } from './ShortcutRegistry'

type RegistryContextValue = {
  registry: ShortcutRegistry
}

export const ShortcutRegistryContext = createContext<RegistryContextValue | null>(null)
