import { isApplePlatform } from './platform'

/** 将内部 combo 转为界面展示用文案，如 `Ctrl + /` 或 `⌘ /` */
export function formatComboLabel(combo: string): string {
  const isMac = isApplePlatform()
  const parts = combo.split('+')
  const labels: string[] = []

  for (const p of parts) {
    if (p === 'mod') {
      labels.push(isMac ? '⌘' : 'Ctrl')
      continue
    }
    if (p === 'shift') {
      labels.push(isMac ? '⇧' : 'Shift')
      continue
    }
    if (p === 'alt') {
      labels.push(isMac ? '⌥' : 'Alt')
      continue
    }
    labels.push(keyTokenToLabel(p))
  }

  return labels.join(isMac ? ' ' : ' + ')
}

function keyTokenToLabel(token: string): string {
  switch (token) {
    case 'slash':
      return '/'
    case 'enter':
      return 'Enter'
    case 'escape':
      return 'Esc'
    case 'backspace':
      return 'Backspace'
    case 'delete':
      return 'Delete'
    case 'space':
      return 'Space'
    case 'period':
      return '.'
    case 'comma':
      return ','
    default:
      return token.length === 1 ? token.toUpperCase() : token
  }
}
