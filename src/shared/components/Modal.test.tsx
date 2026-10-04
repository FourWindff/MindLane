import type { ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import ReactDOMServer from 'react-dom/server'
import { parseHTML } from 'linkedom'
import { Modal } from './Modal'
import { TextPromptDialog } from '@/features/workspace/components/TextPromptDialog'

/** The test environment has no DOM: hand the server markup to linkedom for parsing before asserting. */
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
        <h2 id="head">Title</h2>
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
        <h2 id="head">Title</h2>
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
        label="New file"
        title="File name"
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
      subtitle: 'Description',
      placeholder: "e.g. Today's summary",
      confirmLabel: 'Create file',
      initialValue: 'Initial value',
    })

    const title = dialog?.querySelector('.workspace-modal__title')
    expect(dialog?.getAttribute('aria-labelledby')).toBe(title?.getAttribute('id'))
    expect(dialog?.querySelector('.workspace-modal__label')?.textContent).toBe('New file')
    expect(title?.textContent).toBe('File name')
    expect(dialog?.querySelector('.workspace-modal__subtitle')?.textContent).toBe('Description')

    const input = dialog?.querySelector('input')
    expect(input?.getAttribute('placeholder')).toBe("e.g. Today's summary")
    expect(input?.getAttribute('value')).toBe('Initial value')
    expect(confirm?.textContent).toBe('Create file')
    expect(confirm?.hasAttribute('disabled')).toBe(false)
  })

  it('disables confirm for an empty value, a rejected value or a busy dialog', () => {
    expect(renderPrompt({ initialValue: '  ' }).confirm?.hasAttribute('disabled')).toBe(true)
    expect(
      renderPrompt({
        initialValue: 'duplicate',
        canSubmit: (value) => value !== 'duplicate',
      }).confirm?.hasAttribute('disabled'),
    ).toBe(true)
    expect(
      renderPrompt({
        initialValue: 'new name',
        canSubmit: (value) => value !== 'duplicate',
      }).confirm?.hasAttribute('disabled'),
    ).toBe(false)

    const busy = renderPrompt({ initialValue: 'new name', disabled: true })
    expect(busy.buttons.map((button) => button.hasAttribute('disabled'))).toEqual([true, true])
  })
})
