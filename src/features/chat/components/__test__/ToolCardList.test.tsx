import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { parseHTML } from 'linkedom'
import { ToolCardList, type ToolCardItem } from '../ToolCardList'

type Card = ToolCardItem

function card(overrides: Partial<Card>): Card {
  return { name: 'insertXmlFragment', status: 'success', ...overrides }
}

describe('ToolCardList rendering', () => {
  it('shows a running subgraph card expanded with the live stage and counts', () => {
    const html = ReactDOMServer.renderToString(
      <ToolCardList
        cards={[
          card({
            name: 'generateMindmapFragment',
            status: 'running',
            step: 'extracting',
            completed: 2,
            total: 5,
          }),
        ]}
      />,
    )

    expect(html).toContain('chat-message-list__tool-card--subgraph')
    expect(html).toContain('chat-message-list__spinner')
    expect(html).toContain('aria-expanded="true"')
    // 计数来自 step payload 透传：extracting n/m
    expect(html).toContain('Extracting 2/5')
    expect(html).toContain('chat-message-list__tool-card__stage')
  })

  it('auto-collapses a finished subgraph card to a single line with a check', () => {
    const html = ReactDOMServer.renderToString(
      <ToolCardList
        cards={[
          card({
            name: 'generateMindmapFragment',
            status: 'success',
            step: 'finalizing',
          }),
        ]}
      />,
    )

    expect(html).toContain('chat-message-list__tool-card--subgraph')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('chat-message-list__tool-card__stage')
    // 单行：工具名 + ✓，无 spinner
    expect(html).toContain('Generate Mindmap Fragment')
    expect(html).not.toContain('chat-message-list__spinner')
  })

  it('renders the persisted history stage trace as an expandable subgraph card', () => {
    const html = ReactDOMServer.renderToString(
      <ToolCardList
        cards={[
          card({
            name: 'generateMindmapFragment',
            status: 'success',
            steps: [
              { step: 'reading-doc' },
              { step: 'extracting', completed: 3, total: 3 },
              { step: 'merging' },
              { step: 'finalizing' },
            ],
          }),
        ]}
      />,
    )

    // 历史卡片同样折叠为单行；阶段轨迹保留在可展开区域（展开渲染见交互测试）
    expect(html).toContain('chat-message-list__tool-card--subgraph')
    expect(html).toContain('aria-expanded="false"')
    expect(html).not.toContain('chat-message-list__tool-card__stage')
  })

  it('keeps the palace subgraph card single-line (spinner → ✓, no stages, no expand)', () => {
    const running = ReactDOMServer.renderToString(
      <ToolCardList cards={[card({ name: 'generatePalace', status: 'running' })]} />,
    )
    const done = ReactDOMServer.renderToString(
      <ToolCardList cards={[card({ name: 'generatePalace', status: 'success' })]} />,
    )

    expect(running).toContain('chat-message-list__spinner')
    expect(running).not.toContain('chat-message-list__tool-card--subgraph')
    expect(running).not.toContain('chat-message-list__tool-card__toggle')
    expect(running).not.toContain('chat-message-list__tool-card__stage')
    expect(done).not.toContain('chat-message-list__spinner')
    expect(done).toContain('Generate Memory Palace')
  })

  it('keeps write/read tool cards single-line and non-expandable', () => {
    const html = ReactDOMServer.renderToString(
      <ToolCardList
        cards={[
          card({ name: 'insertXmlFragment', status: 'running' }),
          card({ name: 'readMindmap', status: 'error' }),
        ]}
      />,
    )

    expect(html).toContain('chat-message-list__tool-card--running')
    expect(html).toContain('chat-message-list__tool-card--error')
    expect(html).not.toContain('chat-message-list__tool-card__toggle')
    expect(html).not.toContain('chat-message-list__tool-card__stage')
  })
})

describe('ToolCardList manual expand/collapse', () => {
  let window: ReturnType<typeof parseHTML>['window']
  let root: Root
  let prevGlobals: Record<string, unknown>

  beforeEach(() => {
    const parsed = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
    window = parsed.window
    prevGlobals = {
      window: globalThis.window,
      document: globalThis.document,
      Element: globalThis.Element,
      Node: globalThis.Node,
      SVGElement: globalThis.SVGElement,
    }
    globalThis.window = window
    globalThis.document = window.document
    globalThis.Element = window.Element
    globalThis.Node = window.Node
    globalThis.SVGElement = window.SVGElement
    root = createRoot(window.document.getElementById('root')!)
  })

  afterEach(() => {
    act(() => root.unmount())
    globalThis.window = prevGlobals.window as typeof globalThis.window
    globalThis.document = prevGlobals.document as typeof globalThis.document
    globalThis.Element = prevGlobals.Element as typeof globalThis.Element
    globalThis.Node = prevGlobals.Node as typeof globalThis.Node
    globalThis.SVGElement = prevGlobals.SVGElement as typeof globalThis.SVGElement
  })

  function clickToggle() {
    const toggle = window.document.querySelector('button.chat-message-list__tool-card__toggle')
    act(() => {
      toggle?.dispatchEvent(new window.Event('click', { bubbles: true }))
    })
  }

  it('re-expands a finished subgraph card on click and collapses it again', () => {
    act(() => {
      root.render(
        <ToolCardList
          cards={[
            card({
              name: 'generateMindmapFragment',
              status: 'success',
              steps: [{ step: 'reading-doc' }, { step: 'extracting', completed: 1, total: 2 }],
            }),
          ]}
        />,
      )
    })

    // 完成态默认折叠：无阶段轨迹可见
    expect(window.document.body.textContent).not.toContain('Reading doc')
    const toggle = window.document.querySelector(
      'button.chat-message-list__tool-card__toggle',
    ) as HTMLButtonElement
    expect(toggle.getAttribute('aria-expanded')).toBe('false')

    // 手动展开：阶段轨迹可见
    clickToggle()
    expect(window.document.body.textContent).toContain('Reading doc')
    expect(window.document.body.textContent).toContain('Extracting 1/2')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    // 手动收起：回到单行
    clickToggle()
    expect(window.document.body.textContent).not.toContain('Reading doc')
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('collapses a running subgraph card manually and re-expands it', () => {
    act(() => {
      root.render(
        <ToolCardList
          cards={[
            card({
              name: 'generateMindmapFragment',
              status: 'running',
              step: 'merging',
              completed: 1,
              total: 2,
            }),
          ]}
        />,
      )
    })

    const toggle = window.document.querySelector(
      'button.chat-message-list__tool-card__toggle',
    ) as HTMLButtonElement
    // 运行中默认展开
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(window.document.body.textContent).toContain('Merging 1/2')

    clickToggle()
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(window.document.body.textContent).not.toContain('Merging')

    clickToggle()
    expect(window.document.body.textContent).toContain('Merging 1/2')
  })
})
