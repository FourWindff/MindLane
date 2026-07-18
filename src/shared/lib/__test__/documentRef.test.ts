import { describe, it, expect } from 'vitest'
import { resolveDocumentRef } from '../documentRef'

const userDataPath = '/home/user/.config/MindLane'

describe('resolveDocumentRef', () => {
  it('returns filename and source path for pdf', () => {
    const result = resolveDocumentRef(
      {
        id: 'doc-1',
        type: 'pdf',
        source: '/tmp/report.pdf',
        filename: 'report.pdf',
        importedAt: '2026-07-10T00:00:00.000Z',
      },
      userDataPath,
    )

    expect(result).toEqual({
      ok: true,
      displayText: 'report.pdf',
      target: '/tmp/report.pdf',
      external: false,
    })
  })

  it.each(['docx', 'pptx', 'xlsx', 'markdown'] as const)(
    'returns filename and source path for %s',
    (type) => {
      const result = resolveDocumentRef(
        {
          id: `doc-${type}`,
          type,
          source: `/tmp/report.${type === 'markdown' ? 'md' : type}`,
          filename: `report.${type === 'markdown' ? 'md' : type}`,
          importedAt: '2026-07-10T00:00:00.000Z',
        },
        userDataPath,
      )

      expect(result).toEqual({
        ok: true,
        displayText: `report.${type === 'markdown' ? 'md' : type}`,
        target: `/tmp/report.${type === 'markdown' ? 'md' : type}`,
        external: false,
      })
    },
  )

  it('returns source url and marks url as external', () => {
    const result = resolveDocumentRef(
      {
        id: 'doc-2',
        type: 'url',
        source: 'https://example.com/article',
        filename: 'article',
        importedAt: '2026-07-10T00:00:00.000Z',
      },
      userDataPath,
    )

    expect(result).toEqual({
      ok: true,
      displayText: 'https://example.com/article',
      target: 'https://example.com/article',
      external: true,
    })
  })

  it('returns source preview and resolved absolute textPath for text', () => {
    const result = resolveDocumentRef(
      {
        id: 'doc-3',
        type: 'text',
        source: 'Lorem ipsum dolor sit amet...',
        filename: 'snippet.txt',
        importedAt: '2026-07-10T00:00:00.000Z',
        textPath: 'text-cache/doc-3.txt',
      },
      userDataPath,
    )

    expect(result).toEqual({
      ok: true,
      displayText: 'Lorem ipsum dolor sit amet...',
      target: `${userDataPath}/text-cache/doc-3.txt`,
      external: false,
    })
  })

  it('returns error when textPath is missing', () => {
    const result = resolveDocumentRef(
      {
        id: 'doc-4',
        type: 'text',
        source: 'some preview text',
        filename: 'snippet.txt',
        importedAt: '2026-07-10T00:00:00.000Z',
      },
      userDataPath,
    )

    expect(result).toEqual({
      ok: false,
      displayText: 'some preview text',
      error: '缓存文件路径缺失',
    })
  })
})
