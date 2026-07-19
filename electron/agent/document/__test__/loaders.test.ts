import { describe, it, expect, vi } from 'vitest'
import { Document } from '@langchain/core/documents'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { loadDocument, createDefaultLoaders, type DocumentLoaderRegistry } from '../loaders.js'
import { OfficeConverter } from 'officeparser/slim'
import {
  createDocxFixture,
  createPptxFixture,
  createXlsxFixture,
} from './fixtures/officeFixtures.js'

function fakeRegistry(): DocumentLoaderRegistry & {
  pdf: ReturnType<typeof vi.fn>
  url: ReturnType<typeof vi.fn>
  text: ReturnType<typeof vi.fn>
} {
  return {
    pdf: vi.fn().mockResolvedValue([new Document({ pageContent: 'pdf text' })]),
    url: vi.fn().mockResolvedValue([new Document({ pageContent: 'url text' })]),
    text: vi.fn().mockResolvedValue([new Document({ pageContent: 'plain text' })]),
  }
}

describe('loadDocument registry routing', () => {
  it('routes pdf input to the pdf loader', async () => {
    const registry = fakeRegistry()
    const source = { type: 'pdf' as const, path: '/tmp/a.pdf' }

    const docs = await loadDocument(source, registry)

    expect(registry.pdf).toHaveBeenCalledWith(source)
    expect(registry.url).not.toHaveBeenCalled()
    expect(docs[0]!.pageContent).toBe('pdf text')
  })

  it('routes url input to the url loader', async () => {
    const registry = fakeRegistry()
    const source = { type: 'url' as const, url: 'https://example.test/a' }

    const docs = await loadDocument(source, registry)

    expect(registry.url).toHaveBeenCalledWith(source)
    expect(registry.pdf).not.toHaveBeenCalled()
    expect(docs[0]!.pageContent).toBe('url text')
  })

  it('routes text input to the text loader', async () => {
    const registry = fakeRegistry()
    const source = { type: 'text' as const, content: 'hello' }

    const docs = await loadDocument(source, registry)

    expect(registry.text).toHaveBeenCalledWith(source)
    expect(docs[0]!.pageContent).toBe('plain text')
  })

  it('throws a clear error when the registry lacks the loader', async () => {
    await expect(loadDocument({ type: 'pdf', path: '/tmp/a.pdf' }, {})).rejects.toThrow(
      '不支持的输入类型: pdf',
    )
  })
})

describe('default text loader', () => {
  it('wraps text into a single Document', async () => {
    const docs = await loadDocument({ type: 'text', content: '直接粘贴的内容' })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.pageContent).toBe('直接粘贴的内容')
  })

  it('throws a clear error for empty text', async () => {
    await expect(loadDocument({ type: 'text', content: '   ' })).rejects.toThrow(
      '文本输入内容为空。',
    )
  })
})

describe('default registry', () => {
  it('covers all supported input types', () => {
    const registry = createDefaultLoaders()
    expect(Object.keys(registry).sort()).toEqual([
      'docx',
      'markdown',
      'pdf',
      'pptx',
      'text',
      'url',
      'xlsx',
    ])
  })
})

describe('default file loaders', () => {
  async function fixturePath(filename: string, content: string | Buffer): Promise<string> {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'mindlane-document-'))
    const filePath = path.join(directory, filename)
    await writeFile(filePath, content)
    return filePath
  }

  it('loads docx content along paragraph boundaries', async () => {
    const filePath = await fixturePath('report.docx', createDocxFixture())

    const docs = await loadDocument({ type: 'docx', path: filePath })

    expect(docs.map((doc) => doc.pageContent)).toEqual(['Quarterly report', 'Revenue increased'])
  })

  it('falls back to the office text conversion when no chunks are produced', async () => {
    const filePath = await fixturePath('report.docx', createDocxFixture())
    const convertSpy = vi
      .spyOn(OfficeConverter, 'convert')
      .mockResolvedValueOnce({ value: [], messages: [] } as never)
      .mockResolvedValueOnce({ value: 'Recovered DOCX text', messages: [] } as never)

    await expect(loadDocument({ type: 'docx', path: filePath })).resolves.toEqual([
      expect.objectContaining({ pageContent: 'Recovered DOCX text' }),
    ])

    expect(convertSpy).toHaveBeenCalledTimes(2)
    convertSpy.mockRestore()
  })

  it('loads pptx content with slide metadata', async () => {
    const filePath = await fixturePath('slides.pptx', createPptxFixture())

    const docs = await loadDocument({ type: 'pptx', path: filePath })

    expect(docs.map((doc) => [doc.pageContent, doc.metadata.slideNumber])).toEqual([
      ['Opening slide', 1],
      ['Closing slide', 2],
    ])
  })

  it('loads xlsx content with sheet metadata', async () => {
    const filePath = await fixturePath('workbook.xlsx', createXlsxFixture())

    const docs = await loadDocument({ type: 'xlsx', path: filePath })

    expect(docs.map((doc) => [doc.pageContent, doc.metadata.sheetName])).toEqual([
      ['Total revenue', 'Summary'],
      ['Region north', 'Details'],
    ])
  })

  it('loads markdown as one document', async () => {
    const filePath = await fixturePath('notes.md', '# Notes\n\nUseful details')

    const docs = await loadDocument({ type: 'markdown', path: filePath })

    expect(docs).toHaveLength(1)
    expect(docs[0]!.pageContent).toBe('# Notes\n\nUseful details')
  })

  it('reports corrupt office documents clearly', async () => {
    const filePath = await fixturePath('broken.docx', 'not an office archive')

    await expect(loadDocument({ type: 'docx', path: filePath })).rejects.toThrow(
      '无法解析 DOCX 文档',
    )
  })

  it('reports empty markdown clearly', async () => {
    const filePath = await fixturePath('empty.markdown', '   \n')

    await expect(loadDocument({ type: 'markdown', path: filePath })).rejects.toThrow(
      'Markdown 文档未包含文本内容。',
    )
  })
})
