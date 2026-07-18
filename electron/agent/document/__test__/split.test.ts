import { describe, it, expect } from 'vitest'
import { Document } from '@langchain/core/documents'
import { splitDocuments, CHUNK_SIZE } from '../split.js'

describe('splitDocuments', () => {
  it('never emits chunks over chunkSize', async () => {
    const text = Array.from({ length: 50 }, (_, i) => `第 ${i} 段：${'内容'.repeat(100)}`).join(
      '\n\n',
    )
    const chunks = await splitDocuments([new Document({ pageContent: text })])

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.pageContent.length).toBeLessThanOrEqual(CHUNK_SIZE)
    }
  })

  it('splits on paragraph boundaries first', async () => {
    const para = '句子。'.repeat(300) // one ~900-char paragraph
    const text = `${para}\n\n${para}\n\n${para}`
    const chunks = await splitDocuments([new Document({ pageContent: text })], 1000)

    expect(chunks.length).toBe(3)
    for (const chunk of chunks) {
      expect(chunk.pageContent).not.toContain('\n\n')
    }
  })

  it('preserves Document metadata', async () => {
    const chunks = await splitDocuments(
      [new Document({ pageContent: 'a'.repeat(10), metadata: { loc: { pageNumber: 3 } } })],
      100,
    )

    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.metadata).toMatchObject({ loc: { pageNumber: 3 } })
  })

  it('returns no chunks for empty text', async () => {
    const chunks = await splitDocuments([new Document({ pageContent: '' })])
    expect(chunks).toEqual([])
  })
})
