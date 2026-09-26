import { useEffect, useRef } from 'react'
import { shortcutRegistry } from './ShortcutRegistry'
import type { ShortcutRegistration } from './types'

/**
 * 向快捷键注册表注册一条快捷键。
 * handler / enabled 始终指向最新实现（内部 ref），仅在元信息变化时重新挂载注册。
 */
export function useShortcut(config: ShortcutRegistration) {
  const handlerRef = useRef(config.handler)
  const enabledRef = useRef(config.enabled)
  handlerRef.current = config.handler
  enabledRef.current = config.enabled

  useEffect(() => {
    return shortcutRegistry.register({
      id: config.id,
      combo: config.combo,
      description: config.description,
      group: config.group,
      preventWhenTyping: config.preventWhenTyping,
      handler: (e) => handlerRef.current(e),
      enabled: () => {
        const fn = enabledRef.current
        return fn ? fn() : true
      },
    })
  }, [config.id, config.combo, config.description, config.group, config.preventWhenTyping])
}
