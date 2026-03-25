import { useEffect, useRef, type DependencyList } from 'react'
import { useShortcutRegistry } from './ShortcutRegistryContext'
import type { ShortcutRegistration } from './types'

type ShortcutConfig = Omit<ShortcutRegistration, 'handler' | 'enabled'> & {
  handler: (e: KeyboardEvent) => boolean | void
  enabled?: () => boolean
}

/**
 * 向当前应用的 ShortcutRegistry 注册一条快捷键。
 * handler / enabled 始终指向最新实现（内部 ref），`deps` 变化时重新挂载注册。
 */
export function useRegisterShortcut(
  config: ShortcutConfig,
  deps: DependencyList = [],
) {
  const registry = useShortcutRegistry()
  const handlerRef = useRef(config.handler)
  const enabledRef = useRef(config.enabled)
  handlerRef.current = config.handler
  enabledRef.current = config.enabled

  useEffect(() => {
    return registry.register({
      id: config.id,
      combo: config.combo,
      description: config.description,
      group: config.group,
      preventWhenTyping: config.preventWhenTyping,
      priority: config.priority,
      showInHelp: config.showInHelp,
      handler: (e) => handlerRef.current(e),
      enabled: config.enabled
        ? () => {
            const fn = enabledRef.current
            return fn ? fn() : true
          }
        : undefined,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 由调用方通过 deps 控制
  }, [
    registry,
    config.id,
    config.combo,
    config.description,
    config.group,
    config.preventWhenTyping,
    config.priority,
    config.showInHelp,
    ...deps,
  ])
}

/** `useRegisterShortcut` 的别名 */
export const useShortcut = useRegisterShortcut
