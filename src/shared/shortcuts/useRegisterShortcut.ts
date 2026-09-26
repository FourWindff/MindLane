import { useEffect, useRef } from 'react'
import { shortcutRegistry } from './ShortcutRegistry'

/** 一行快捷键：`[id, combo, description, handler, options?]`；options 可覆盖表级 preventWhenTyping。 */
export type ShortcutRow = readonly [
  id: string,
  combo: string,
  description: string,
  handler: (e: KeyboardEvent) => boolean | void,
  options?: { enabled?: () => boolean; preventWhenTyping?: boolean },
]

/** 一张表的公共元信息 */
export type ShortcutDefaults = {
  group: string
  preventWhenTyping: boolean
}

type ShortcutRowsRef = { current: readonly ShortcutRow[] }

/**
 * 注册一张快捷键表，返回一次性注销函数。
 * handler / enabled 每次派发都从 `rows.current` 读取，所以表可以每渲染重算。
 */
export function registerShortcutRows(
  rows: ShortcutRowsRef,
  defaults: ShortcutDefaults,
): () => void {
  const unregisters = rows.current.map(([id, combo, description], index) =>
    shortcutRegistry.register({
      id,
      combo,
      description,
      group: defaults.group,
      preventWhenTyping: rows.current[index]?.[4]?.preventWhenTyping ?? defaults.preventWhenTyping,
      handler: (e) => rows.current[index]?.[3](e),
      enabled: () => {
        const enabled = rows.current[index]?.[4]?.enabled
        return enabled ? enabled() : true
      },
    }),
  )
  return () => unregisters.forEach((off) => off())
}

/**
 * 注册一张快捷键表；仅在元信息（id / combo / description / preventWhenTyping / group）变化时
 * 重新挂载注册——否则每渲染都会 register + emit，帮助面板跟着白刷。
 */
export function useShortcuts(rows: readonly ShortcutRow[], defaults: ShortcutDefaults): void {
  const { group, preventWhenTyping } = defaults
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const signature = rows
    .map(([id, combo, description, , options]) =>
      [id, combo, description, options?.preventWhenTyping ?? ''].join('\u0000'),
    )
    .join('\u0001')

  useEffect(
    () => registerShortcutRows(rowsRef, { group, preventWhenTyping }),
    [signature, group, preventWhenTyping],
  )
}
