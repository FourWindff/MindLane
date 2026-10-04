import { useEffect, useRef } from 'react'
import { shortcutRegistry } from './ShortcutRegistry'

/** One shortcut row: `[id, combo, description, handler, options?]`; options can override the table-level preventWhenTyping. */
export type ShortcutRow = readonly [
  id: string,
  combo: string,
  description: string,
  handler: (e: KeyboardEvent) => boolean | void,
  options?: { enabled?: () => boolean; preventWhenTyping?: boolean },
]

/** Shared metadata for one table */
type ShortcutDefaults = {
  group: string
  preventWhenTyping: boolean
}

type ShortcutRowsRef = { current: readonly ShortcutRow[] }

/**
 * Register one shortcut table, returning a one-shot unregister function.
 * handler / enabled are read from `rows.current` on every dispatch, so the table may be
 * recomputed on each render.
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
 * Register one shortcut table; registrations are only remounted when the metadata (id / combo /
 * description / preventWhenTyping / group) changes — otherwise every render would register +
 * emit, making the help panel re-render for nothing.
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
