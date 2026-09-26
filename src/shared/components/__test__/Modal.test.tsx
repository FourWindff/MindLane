import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { Modal } from '../Modal'
import { TextPromptDialog } from '../TextPromptDialog'

/** 测试环境没有 DOM：把服务端标记交给 linkedom 解析后断言。 */
function render(element: ReactElement) {
  const { document } = parseHTML(
    `<html><body>${ReactDOMServer.renderToStaticMarkup(element)}</body></html>`,
  )
  return document
}

const noop = () => {}

describe('Modal', () => {
  it('renders a labelled dialog inside a presentation backdrop', () => {
    const doc = render(
      <Modal labelledBy="head" onCancel={noop} onSubmit={noop}>
        <h2 id="head">标题</h2>
      </Modal>,
    )

    const backdrop = doc.querySelector('[role="presentation"]')
    const dialog = doc.querySelector('[role="dialog"]')
    expect(backdrop?.className).toBe('workspace-modal-backdrop')
    expect(dialog?.parentElement).toBe(backdrop)
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('head')
    expect(doc.querySelector('h2')?.getAttribute('id')).toBe('head')
  })

  it('lets the caller swap both shells', () => {
    const doc = render(
      <Modal
        labelledBy="head"
        onCancel={noop}
        backdropClassName="workspace-modal-backdrop workspace-home__modal-backdrop"
        panelClassName="workspace-home__panel"
      >
        <h2 id="head">标题</h2>
      </Modal>,
    )

    expect(doc.querySelector('[role="presentation"]')?.className).toBe(
      'workspace-modal-backdrop workspace-home__modal-backdrop',
    )
    expect(doc.querySelector('[role="dialog"]')?.className).toBe('workspace-home__panel')
  })
})

describe('TextPromptDialog', () => {
  function renderPrompt(props: Partial<Parameters<typeof TextPromptDialog>[0]> = {}) {
    const doc = render(
      <TextPromptDialog
        label="新建文件"
        title="输入文件名"
        onConfirm={noop}
        onCancel={noop}
        {...props}
      />,
    )
    const dialog = doc.querySelector('[role="dialog"]')
    const buttons = Array.from(dialog?.querySelectorAll('button') ?? [])
    return { doc, dialog, buttons, confirm: buttons[1] }
  }

  it('labels the dialog by its title and forwards the prompt fields', () => {
    const { dialog, confirm } = renderPrompt({
      subtitle: '说明',
      placeholder: '例如：今日总结',
      confirmLabel: '创建文件',
      initialValue: '初值',
    })

    const title = dialog?.querySelector('.workspace-modal__title')
    expect(dialog?.getAttribute('aria-labelledby')).toBe(title?.getAttribute('id'))
    expect(dialog?.querySelector('.workspace-modal__label')?.textContent).toBe('新建文件')
    expect(title?.textContent).toBe('输入文件名')
    expect(dialog?.querySelector('.workspace-modal__subtitle')?.textContent).toBe('说明')

    const input = dialog?.querySelector('input')
    expect(input?.getAttribute('placeholder')).toBe('例如：今日总结')
    expect(input?.getAttribute('value')).toBe('初值')
    expect(confirm?.textContent).toBe('创建文件')
    expect(confirm?.hasAttribute('disabled')).toBe(false)
  })

  it('disables confirm for an empty value, a rejected value or a busy dialog', () => {
    expect(renderPrompt({ initialValue: '  ' }).confirm?.hasAttribute('disabled')).toBe(true)
    expect(
      renderPrompt({
        initialValue: '同名',
        canSubmit: (value) => value !== '同名',
      }).confirm?.hasAttribute('disabled'),
    ).toBe(true)
    expect(
      renderPrompt({
        initialValue: '新名',
        canSubmit: (value) => value !== '同名',
      }).confirm?.hasAttribute('disabled'),
    ).toBe(false)

    const busy = renderPrompt({ initialValue: '新名', disabled: true })
    expect(busy.buttons.map((button) => button.hasAttribute('disabled'))).toEqual([true, true])
  })
})
