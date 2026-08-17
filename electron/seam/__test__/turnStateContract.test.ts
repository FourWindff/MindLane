import { describe, expect, it } from 'vitest'
import { EDITOR_STATE_TAG, serializeTurnState, stripTurnState, xmlEscape } from '../../ipc.js'
import type { ChatContext, MindmapReadRequest, MindmapReadResponse } from '../../ipc.js'

/** 最小上下文：文件身份 + 空选。 */
function baseContext(overrides: Partial<ChatContext> = {}): ChatContext {
  return {
    fileUuid: 'file-uuid-1',
    filePath: '/workspace/demo.mindlane',
    fileTitle: 'Demo 导图',
    selectedNodes: [],
    ...overrides,
  }
}

describe('serializeTurnState', () => {
  it('emits EDITOR_STATE root with file identity attributes', () => {
    const xml = serializeTurnState(baseContext())

    expect(
      xml.startsWith(
        `<${EDITOR_STATE_TAG} file_uuid="file-uuid-1" file_path="/workspace/demo.mindlane" file_title="Demo 导图">`,
      ),
    ).toBe(true)
    expect(xml.endsWith(`</${EDITOR_STATE_TAG}>`)).toBe(true)
  })

  it('always emits SELECTED_NODES with count; empty selection is count="0" with no children', () => {
    const xml = serializeTurnState(baseContext())

    expect(xml).toContain('<SELECTED_NODES count="0">')
    expect(xml).toContain('</SELECTED_NODES>')
    expect(xml).not.toContain('<node ')
  })

  it('emits selected nodes with id/type/label when present', () => {
    const xml = serializeTurnState(
      baseContext({
        selectedNodes: [
          { id: 'n1', type: 'text', label: '节点一' },
          { id: 'n2', type: 'palace', label: '宫殿' },
        ],
      }),
    )

    expect(xml).toContain('<SELECTED_NODES count="2">')
    expect(xml).toContain('<node id="n1" type="text" content="节点一"/>')
    expect(xml).toContain('<node id="n2" type="palace" content="宫殿"/>')
  })

  it('emits ATTACHED_DOCUMENT and LINKED_DOCUMENTS only when present', () => {
    const without = serializeTurnState(baseContext())
    expect(without).not.toContain('<ATTACHED_DOCUMENT')
    expect(without).not.toContain('<LINKED_DOCUMENTS')

    const withDocs = serializeTurnState(
      baseContext({
        attachedDocument: {
          id: 'doc-1',
          type: 'pdf',
          source: '/docs/paper.pdf',
          filename: 'paper.pdf',
          importedAt: '2026-01-01T00:00:00Z',
        },
        linkedDocuments: [
          {
            id: 'doc-2',
            type: 'markdown',
            source: '/docs/notes.md',
            filename: 'notes.md',
            importedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    )

    expect(withDocs).toContain(
      '<ATTACHED_DOCUMENT type="pdf" filename="paper.pdf" path="/docs/paper.pdf">',
    )
    expect(withDocs).toContain('请根据此文档内容生成思维导图')
    expect(withDocs).toContain('<LINKED_DOCUMENTS count="1">')
    expect(withDocs).toContain(
      '<document id="doc-2" type="markdown" filename="notes.md" text_cache_key="doc-2"/>',
    )
  })

  it('escapes attribute values so labels with XML specials cannot break structure', () => {
    const xml = serializeTurnState(
      baseContext({
        fileTitle: 'A & B <tag> "quote"',
        selectedNodes: [
          { id: 'n1', type: 'text', label: 'x < y > z & "w"' },
          { id: 'n2', type: 'text', label: 'root' },
        ],
        attachedDocument: {
          id: 'doc-1',
          type: 'text',
          source: '/docs/a&b.txt',
          filename: 'a&b.txt',
          importedAt: '2026-01-01T00:00:00Z',
        },
      }),
    )

    expect(xml).toContain('file_title="A &amp; B &lt;tag&gt; &quot;quote&quot;"')
    expect(xml).toContain('content="x &lt; y &gt; z &amp; &quot;w&quot;"')
    expect(xml).toContain('path="/docs/a&amp;b.txt"')
    // 原文中的 < > & " 不再以裸字符出现，结构不被破坏。
    expect(xml).not.toContain('content="x <')
    expect(xml).not.toContain('&"w"')
  })

  it('emits compact mode: root chain + direct subtree for selected nodes', () => {
    const xml = serializeTurnState(
      baseContext({
        selectedNodes: [
          {
            id: 'n3',
            type: 'text',
            label: '选中',
            chain: ['root', 'n1', 'n3'],
            children: [
              { id: 'n4', type: 'text', label: '子节点' },
              { id: 'n5', type: 'text', label: '另一个' },
            ],
          },
        ],
      }),
    )

    expect(xml).toContain('<node id="n3" type="text" content="选中" chain="root,n1,n3">')
    expect(xml).toContain('<node id="n4" type="text" content="子节点"/>')
    expect(xml).toContain('<node id="n5" type="text" content="另一个"/>')
    expect(xml).toContain('</node>')
  })

  it('omits the chain attribute for root-level selections', () => {
    const xml = serializeTurnState(
      baseContext({
        selectedNodes: [{ id: 'root', type: 'text', label: '中心', chain: ['root'] }],
      }),
    )

    expect(xml).not.toContain('chain=')
    expect(xml).toContain('<node id="root" type="text" content="中心"/>')
  })

  it('contains no mindmap tree: no summary text, no nodes beyond the selected list', () => {
    const xml = serializeTurnState(
      baseContext({ selectedNodes: [{ id: 'n1', type: 'text', label: '选中' }] }),
    )

    expect(xml).not.toContain('mindmapSummary')
    expect(xml).not.toContain('getContextSummary')
    expect(xml).not.toContain('<MINDMAP')
    // 导图树节点（root 等）不会出现，只有 SELECTED_NODES 里的选中节点。
    expect(xml).not.toContain('root (id:')
  })

  it('xmlEscape escapes the five XML specials', () => {
    expect(xmlEscape('a&b<c>"d\'e')).toBe("a&amp;b&lt;c&gt;&quot;d'e")
  })
})

describe('stripTurnState', () => {
  it('round-trips a normal message: serialize then strip restores the question', () => {
    const question = '请帮我整理这个导图'
    const message = `${question}\n${serializeTurnState(baseContext())}`

    expect(stripTurnState(message)).toBe(question)
  })

  it('round-trips empty selection, attachments, linked documents and special-char labels', () => {
    const question = '问题'
    const context = baseContext({
      fileTitle: 'A < B & "C"',
      selectedNodes: [
        { id: 'n1', type: 'text', label: 'x < y > z & "w"' },
        { id: 'n2', type: 'text', label: 'root' },
      ],
      attachedDocument: {
        id: 'doc-1',
        type: 'pdf',
        source: '/docs/a&b.pdf',
        filename: 'a&b.pdf',
        importedAt: '2026-01-01T00:00:00Z',
      },
      linkedDocuments: [
        {
          id: 'doc-2',
          type: 'markdown',
          source: '/docs/notes.md',
          filename: 'notes.md',
          importedAt: '2026-01-01T00:00:00Z',
        },
      ],
    })

    expect(stripTurnState(`${question}\n${serializeTurnState(context)}`)).toBe(question)
  })

  it('is a no-op on text without a trailing block', () => {
    expect(stripTurnState('普通消息')).toBe('普通消息')
    expect(stripTurnState('')).toBe('')
    // 中间出现标签但末尾无块：不触碰。
    expect(stripTurnState('提到 <EDITOR_STATE> 这个词')).toBe('提到 <EDITOR_STATE> 这个词')
    expect(stripTurnState('<EDITOR_STATE file_uuid="x"></EDITOR_STATE> 后面还有字')).toBe(
      '<EDITOR_STATE file_uuid="x"></EDITOR_STATE> 后面还有字',
    )
  })

  it('removes only the trailing block and never touches interior content', () => {
    const interior = '开头 <EDITOR_STATE>中间</EDITOR_STATE> 继续'
    const message = `${interior}\n${serializeTurnState(baseContext())}`

    expect(stripTurnState(message)).toBe(interior)
  })

  it('handles a message that is exactly the block', () => {
    const block = serializeTurnState(baseContext())
    expect(stripTurnState(block)).toBe('')
  })

  it('does not strip a block that is not anchored at the very end', () => {
    const text = `问题\n${serializeTurnState(baseContext())}\n追问`
    expect(stripTurnState(text)).toBe(text)
  })
})

describe('MindmapRead bridge types', () => {
  it('correlates request and response by requestId', () => {
    const request: MindmapReadRequest = { requestId: 'req-1', fileUuid: 'file-a' }
    const okResponse: MindmapReadResponse = { requestId: 'req-1', ok: true, summary: '树' }
    const errorResponse: MindmapReadResponse = {
      requestId: 'req-1',
      ok: false,
      error: '文件未打开',
    }

    expect(request.requestId).toBe(okResponse.requestId)
    expect(errorResponse.requestId).toBe(okResponse.requestId)
    expect(okResponse.ok).toBe(true)
    expect(errorResponse.ok).toBe(false)
  })
})
