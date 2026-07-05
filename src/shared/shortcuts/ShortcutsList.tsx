import { useMemo, useSyncExternalStore } from 'react'
import { formatComboLabel } from './formatComboLabel'
import { useShortcutRegistry } from './useShortcutRegistry'
import type { ShortcutRegistration } from './types'
import './shortcuts.css'

const GROUP_LABEL: Record<string, string> = {
  app: '应用',
  mindmap: '思维导图',
}

const GROUP_ORDER = ['app', 'mindmap']

function groupLabel(id: string): string {
  return GROUP_LABEL[id] ?? id
}

export function ShortcutsList() {
  const registry = useShortcutRegistry()
  const entries = useSyncExternalStore(
    registry.subscribe,
    () => registry.getSnapshot(),
    () => registry.getSnapshot(),
  )

  const visible = useMemo(() => entries.filter((e) => e.showInHelp !== false), [entries])

  const grouped = useMemo(() => {
    const map = new Map<string, ShortcutRegistration[]>()
    for (const e of visible) {
      const list = map.get(e.group)
      if (list) list.push(e)
      else map.set(e.group, [e])
    }
    const pairs = [...map.entries()].sort(([a], [b]) => {
      const ia = GROUP_ORDER.indexOf(a)
      const ib = GROUP_ORDER.indexOf(b)
      if (ia !== -1 && ib !== -1) return ia - ib
      if (ia !== -1) return -1
      if (ib !== -1) return 1
      return a.localeCompare(b)
    })
    return pairs.map(([id, items]) => ({
      id,
      label: groupLabel(id),
      items,
    }))
  }, [visible])

  return (
    <>
      {grouped.map((block) => (
        <section key={block.id} className="shortcuts-panel__block">
          <h3 className="shortcuts-panel__block-title">{block.label}</h3>
          <ul className="shortcuts-panel__list">
            {block.items.map((item) => (
              <li key={item.id} className="shortcuts-panel__row">
                <kbd className="shortcuts-panel__kbd">{formatComboLabel(item.combo)}</kbd>
                <span className="shortcuts-panel__desc">{item.description}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  )
}
