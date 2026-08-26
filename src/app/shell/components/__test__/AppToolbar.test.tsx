import ReactDOMServer from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AppToolbar } from '../AppToolbar'

describe('AppToolbar', () => {
  it('contains file controls without owning the chat toggle', () => {
    const html = ReactDOMServer.renderToString(
      <AppToolbar
        onOpenFileManager={vi.fn()}
        fileManagerOpen={false}
        filePath="/workspace/notes.mindlane"
      />,
    )

    expect(html).toContain('打开文件管理器')
    expect(html).toContain('notes')
    expect(html).not.toContain('显示聊天')
    expect(html).not.toContain('隐藏聊天')
  })
})
