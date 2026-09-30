import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import ReactDOMServer from 'react-dom/server'

let runEffect: (() => void | (() => void)) | undefined

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useEffect: (effect: () => void | (() => void)) => {
      runEffect = effect
    },
  }
})

import { MindmapHeader } from './Header'

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
  chatOpen: true,
  capsuleExpanded: false,
  onToggleChatOpen: vi.fn(),
}

describe('MindmapHeader style panel dismissal', () => {
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

  it('compresses the header while the capsule is expanded', () => {
    const html = ReactDOMServer.renderToString(
      <MindmapHeader {...defaultProps} capsuleExpanded={true} />,
    )

    expect(html).toContain('mindmap-header--capsule-expanded')
    expect(html).toContain('aria-label="隐藏聊天"')
  })

  it('restores the regular header state when the chat panel is collapsed', () => {
    const html = ReactDOMServer.renderToString(<MindmapHeader {...defaultProps} chatOpen={false} />)

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
