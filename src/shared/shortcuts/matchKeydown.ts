/** 基于 KeyboardEvent.code，避免布局/大小写差异 */
export function eventComboFromCode(e: KeyboardEvent): string {
  const mods: string[] = []
  if (e.metaKey || e.ctrlKey) mods.push('mod')
  if (e.shiftKey) mods.push('shift')
  if (e.altKey) mods.push('alt')

  let k: string
  switch (e.code) {
    case 'Slash':
      k = 'slash'
      break
    case 'Period':
      k = 'period'
      break
    case 'Comma':
      k = 'comma'
      break
    case 'Enter':
      k = 'enter'
      break
    case 'Escape':
      k = 'escape'
      break
    case 'Backspace':
      k = 'backspace'
      break
    case 'Delete':
      k = 'delete'
      break
    case 'Space':
      k = 'space'
      break
    default:
      if (e.code.startsWith('Key')) {
        k = e.code.slice(3).toLowerCase()
      } else if (e.code.startsWith('Digit')) {
        k = e.code.slice(5)
      } else {
        k = e.code.toLowerCase()
      }
  }

  return [...mods, k].join('+')
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  return false
}
