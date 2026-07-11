import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

let runEffect: (() => void | (() => void)) | undefined

vi.mock('react', () => ({
  useEffect: (effect: () => void | (() => void)) => {
    runEffect = effect
  },
}))

import { MindMapHeader } from '../MindMapHeader'

class TestElement {
  constructor(private readonly selector: string | null = null) {}

  closest(selector: string) {
    return selector === this.selector ? this : null
  }
}

const defaultProps = {
  onAddChild: vi.fn(),
  onAddSibling: vi.fn(),
  onRemove: vi.fn(),
  canAddChild: true,
  canAddSibling: true,
  canRemove: true,
}

describe('MindMapHeader style panel dismissal', () => {
  let pointerDown: ((event: { target: unknown }) => void) | undefined
  const addEventListener = vi.fn((type: string, listener: (event: { target: unknown }) => void) => {
    if (type === 'pointerdown') pointerDown = listener
  })
  const removeEventListener = vi.fn()

  beforeEach(() => {
    runEffect = undefined
    pointerDown = undefined
    addEventListener.mockClear()
    removeEventListener.mockClear()
    vi.stubGlobal('Element', TestElement)
    vi.stubGlobal('window', { addEventListener, removeEventListener })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function mount(open: boolean, onToggleStylePanel = vi.fn(), stylePanel?: ReactNode) {
    MindMapHeader({
      ...defaultProps,
      onToggleStylePanel,
      stylePanelOpen: open,
      stylePanel,
    })
    return { cleanup: runEffect?.(), onToggleStylePanel }
  }

  it('closes the open style panel when another area is used', () => {
    const { cleanup, onToggleStylePanel } = mount(true)

    pointerDown?.({ target: new TestElement() })

    expect(onToggleStylePanel).toHaveBeenCalledOnce()
    cleanup?.()
    expect(removeEventListener).toHaveBeenCalledWith('pointerdown', pointerDown, true)
  })

  it.each(['.style-panel', '[aria-label="导图样式"]'])(
    'keeps the style panel open for interactions matching %s',
    (selector) => {
      const { onToggleStylePanel } = mount(true)

      pointerDown?.({ target: new TestElement(selector) })

      expect(onToggleStylePanel).not.toHaveBeenCalled()
    },
  )

  it('does not register a listener while the style panel is closed', () => {
    mount(false)

    expect(addEventListener).not.toHaveBeenCalled()
  })
})
