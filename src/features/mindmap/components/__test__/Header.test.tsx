import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import ReactDOMServer from 'react-dom/server'

let runEffect: (() => void | (() => void)) | undefined

// The header reads the chat panel flags from the ai store; the component is
// called as a plain function here, so the store hook must not be a real hook.
const chatState = vi.hoisted(() => ({
  chatOpen: true,
  capsuleExpanded: false,
  setChatOpen: vi.fn(),
}))

vi.mock('@/features/chat/model/aiStore', () => ({
  useAiStore: (selector: (state: typeof chatState) => unknown) => selector(chatState),
}))

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      runEffect = effect
    },
  }
})

import { MindmapHeader } from '../Header'

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

describe('MindmapHeader style panel dismissal', () => {
  let pointerDown: ((event: { target: unknown }) => void) | undefined
  const addEventListener = vi.fn((type: string, listener: (event: { target: unknown }) => void) => {
    if (type === 'pointerdown') pointerDown = listener
  })
  const removeEventListener = vi.fn()

  beforeEach(() => {
    runEffect = undefined
    chatState.chatOpen = true
    chatState.capsuleExpanded = false
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
    MindmapHeader({
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

  it('owns the chat toggle and enters the capsule-compressed state', () => {
    chatState.capsuleExpanded = true
    const html = ReactDOMServer.renderToString(<MindmapHeader {...defaultProps} />)

    expect(html).toContain('mindmap-header--capsule-expanded')
    expect(html).toContain('aria-label="隐藏聊天"')
  })

  it('restores the regular header state when capsules collapse', () => {
    chatState.chatOpen = false
    const html = ReactDOMServer.renderToString(<MindmapHeader {...defaultProps} />)

    expect(html).not.toContain('mindmap-header--capsule-expanded')
    expect(html).toContain('aria-label="显示聊天"')
  })

  it('disables the chat entry with a red unavailable state when AI is not ready', () => {
    const html = ReactDOMServer.renderToString(<MindmapHeader {...defaultProps} aiReady={false} />)

    expect(html).toContain('float-toolbar__btn--unavailable')
    expect(html).toContain('disabled')
    expect(html).toContain('聊天服务不可用')
  })

  it('keeps the chat entry usable when AI is ready', () => {
    const html = ReactDOMServer.renderToString(<MindmapHeader {...defaultProps} aiReady />)

    expect(html).not.toContain('float-toolbar__btn--unavailable')
    expect(html).toContain('aria-label="隐藏聊天"')
  })
})
