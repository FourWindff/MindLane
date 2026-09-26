import { mindmapRegistry } from '../mindmapRegistry'

/**
 * Test-only blank slate: dispose every instance held by the singleton registry
 * and clear its active key. Production code releases one file at a time through
 * `release(key)`, so this lives outside the class instead of widening its API.
 */
export function resetRegistry(): void {
  const registry = mindmapRegistry as unknown as {
    instances: Map<string, { dispose: () => void }>
    activeKey: string | null
  }
  for (const instance of registry.instances.values()) instance.dispose()
  registry.instances.clear()
  registry.activeKey = null
  mindmapRegistry.resetDefault()
}
