import ReactDOMServer from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppToolbar } from './AppToolbar'

describe('AppToolbar', () => {
  it('contains file controls without owning the chat toggle', () => {
    const html = ReactDOMServer.renderToString(
      <AppToolbar
        onOpenFileManager={vi.fn()}
        fileManagerOpen={false}
        filePath="/workspace/notes.mindlane"
      />,
    )

    expect(html).toContain('Open file manager')
    expect(html).toContain('notes')
    expect(html).not.toContain('Show chat')
    expect(html).not.toContain('Hide chat')
  })
})
