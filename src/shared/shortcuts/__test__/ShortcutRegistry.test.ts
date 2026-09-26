import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MindmapOperationController } from '@/features/mindmap/model/mindmapOperationController'
import { mindmapShortcutRows } from '@/features/mindmap/hooks/mindmapShortcutTable'
import { registerShortcutRows } from '../useRegisterShortcut'
import { shortcutRegistry } from '../ShortcutRegistry'
import type { ShortcutRegistration } from '../types'

// 测试环境（Electron-as-Node）没有 DOM：`isTypingTarget` 只用到
// `instanceof HTMLElement` 与 `tagName` / `isContentEditable`。
class FakeElement {
  isContentEditable = false
  constructor(readonly tagName: string = 'DIV') {}
}

;(globalThis as { HTMLElement?: unknown }).HTMLElement = FakeElement

type Modifiers = { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean }

function keyEvent(
  code: string,
  options: { target?: FakeElement; modifiers?: Modifiers; repeat?: boolean } = {},
) {
  const modifiers = options.modifiers ?? {}
  return {
    code,
    metaKey: Boolean(modifiers.meta),
    ctrlKey: Boolean(modifiers.ctrl),
    shiftKey: Boolean(modifiers.shift),
    altKey: Boolean(modifiers.alt),
    repeat: options.repeat ?? false,
    target: options.target ?? new FakeElement(),
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  }
}

const registered: Array<() => void> = []

function register(
  entry: Partial<ShortcutRegistration> & Pick<ShortcutRegistration, 'id' | 'combo' | 'handler'>,
): () => void {
  const off = shortcutRegistry.register({
    description: entry.id,
    group: 'test',
    preventWhenTyping: true,
    ...entry,
  })
  registered.push(off)
  return off
}

afterEach(() => {
  registered.splice(0).forEach((off) => off())
  expect(shortcutRegistry.getSnapshot()).toHaveLength(0)
})

describe('shortcutRegistry', () => {
  it('dispatches a registered combo and consumes the event', () => {
    const handler = vi.fn()
    register({ id: 'a', combo: 'mod+enter', handler })

    const event = keyEvent('Enter', { modifiers: { meta: true } })
    expect(shortcutRegistry.dispatch(event as unknown as KeyboardEvent)).toBe(true)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(event.stopPropagation).toHaveBeenCalledTimes(1)
  })

  it('leaves unmatched combos unhandled', () => {
    const handler = vi.fn()
    register({ id: 'a', combo: 'mod+enter', handler })

    const event = keyEvent('KeyB')
    expect(shortcutRegistry.dispatch(event as unknown as KeyboardEvent)).toBe(false)
    expect(handler).not.toHaveBeenCalled()
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('ignores typing targets unless the shortcut opts out', () => {
    const guarded = vi.fn()
    const unguarded = vi.fn()
    register({ id: 'guarded', combo: 'mod+s', handler: guarded })
    register({ id: 'unguarded', combo: 'mod+s', preventWhenTyping: false, handler: unguarded })

    const inInput = keyEvent('KeyS', {
      target: new FakeElement('INPUT'),
      modifiers: { meta: true },
    })
    shortcutRegistry.dispatch(inInput as unknown as KeyboardEvent)

    expect(guarded).not.toHaveBeenCalled()
    expect(unguarded).toHaveBeenCalledTimes(1)
  })

  it('replaces the previous entry when the same id registers again', () => {
    const first = vi.fn()
    const second = vi.fn()
    register({ id: 'a', combo: 'mod+enter', handler: first })
    register({ id: 'a', combo: 'mod+enter', handler: second })

    expect(shortcutRegistry.getSnapshot()).toHaveLength(1)
    shortcutRegistry.dispatch(
      keyEvent('Enter', { modifiers: { meta: true } }) as unknown as KeyboardEvent,
    )
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('skips disabled entries and handlers that decline the key', () => {
    const disabled = vi.fn()
    const declining = vi.fn(() => false)
    const winner = vi.fn()
    register({ id: 'disabled', combo: 'delete', enabled: () => false, handler: disabled })
    register({ id: 'declining', combo: 'delete', handler: declining })
    register({ id: 'winner', combo: 'delete', handler: winner })

    const event = keyEvent('Delete')
    expect(shortcutRegistry.dispatch(event as unknown as KeyboardEvent)).toBe(true)
    expect(disabled).not.toHaveBeenCalled()
    expect(declining).toHaveBeenCalledTimes(1)
    expect(winner).toHaveBeenCalledTimes(1)
  })

  it('ignores repeated keydown events', () => {
    const handler = vi.fn()
    register({ id: 'a', combo: 'delete', handler })

    shortcutRegistry.dispatch(keyEvent('Delete', { repeat: true }) as unknown as KeyboardEvent)
    expect(handler).not.toHaveBeenCalled()
  })

  it('keeps the snapshot reference while unchanged and notifies subscribers', () => {
    const listener = vi.fn()
    const unsubscribe = shortcutRegistry.subscribe(listener)

    const off = register({ id: 'a', combo: 'mod+enter', handler: vi.fn() })
    const afterFirst = shortcutRegistry.getSnapshot()
    expect(afterFirst).toHaveLength(1)
    expect(shortcutRegistry.getSnapshot()).toBe(afterFirst)
    expect(listener).toHaveBeenCalledTimes(1)

    register({ id: 'b', combo: 'mod+b', handler: vi.fn() })
    expect(shortcutRegistry.getSnapshot()).not.toBe(afterFirst)

    off()
    expect(shortcutRegistry.getSnapshot()).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(3)
    unsubscribe()
  })
})

const CASES: Array<{ code: string; modifiers: Modifiers; action: string }> = [
  { code: 'Enter', modifiers: { meta: true }, action: 'addChild' },
  { code: 'Enter', modifiers: { meta: true, shift: true }, action: 'addSibling' },
  { code: 'Delete', modifiers: {}, action: 'removeSelected' },
  { code: 'Backspace', modifiers: {}, action: 'removeSelected' },
  { code: 'F2', modifiers: {}, action: 'startEditing' },
  { code: 'KeyR', modifiers: { meta: true, shift: true }, action: 'reset' },
  { code: 'ArrowLeft', modifiers: {}, action: 'navigateLeft' },
  { code: 'ArrowRight', modifiers: {}, action: 'navigateRight' },
  { code: 'ArrowUp', modifiers: {}, action: 'navigateUp' },
  { code: 'ArrowDown', modifiers: {}, action: 'navigateDown' },
  { code: 'Digit0', modifiers: { meta: true }, action: 'centerRoot' },
  { code: 'KeyZ', modifiers: { meta: true }, action: 'undo' },
  { code: 'KeyZ', modifiers: { meta: true, shift: true }, action: 'redo' },
  { code: 'KeyS', modifiers: { meta: true }, action: 'save' },
]

const COMBOS = [
  'mod+enter',
  'mod+shift+enter',
  'delete',
  'backspace',
  'f2',
  'mod+shift+r',
  'arrowleft',
  'arrowright',
  'arrowup',
  'arrowdown',
  'mod+0',
  'mod+z',
  'mod+shift+z',
  'mod+s',
]

describe('mindmap shortcut table', () => {
  function buildTable(enabled: () => boolean = () => true) {
    const spies = {
      addChild: vi.fn(),
      addSibling: vi.fn(),
      removeSelected: vi.fn(),
      startEditing: vi.fn(),
      reset: vi.fn(),
      navigateLeft: vi.fn(),
      navigateRight: vi.fn(),
      navigateUp: vi.fn(),
      navigateDown: vi.fn(),
      centerRoot: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
    }
    const save = vi.fn()
    const rows = mindmapShortcutRows({
      controller: spies as unknown as MindmapOperationController,
      selectedId: 'n1',
      canAddSibling: true,
      enabled,
      save,
    })
    registered.push(
      registerShortcutRows({ current: rows }, { group: 'mindmap', preventWhenTyping: true }),
    )
    return { spies, save, rows }
  }

  it('routes every combo to exactly one action', () => {
    const { spies, save, rows } = buildTable()
    expect(rows).toHaveLength(CASES.length)
    expect(rows.map((row) => row[1])).toEqual(COMBOS)

    for (const [index, { code, modifiers, action }] of CASES.entries()) {
      for (const spy of [...Object.values(spies), save]) spy.mockClear()

      const event = keyEvent(code, { modifiers })
      const label = COMBOS[index]!
      expect(shortcutRegistry.dispatch(event as unknown as KeyboardEvent), label).toBe(true)
      expect(event.preventDefault, label).toHaveBeenCalledTimes(1)
      expect(
        Object.entries({ save, ...spies })
          .filter(([, spy]) => spy.mock.calls.length > 0)
          .map(([name]) => name),
        label,
      ).toEqual([action])
    }
  })

  it('disables the whole table while the AI streams', () => {
    const { spies } = buildTable(() => false)
    const event = keyEvent('Enter', { modifiers: { meta: true } })
    expect(shortcutRegistry.dispatch(event as unknown as KeyboardEvent)).toBe(false)
    expect(spies.addChild).not.toHaveBeenCalled()
  })
})
