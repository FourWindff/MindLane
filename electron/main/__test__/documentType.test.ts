import { describe, expect, it } from 'vitest'
import { detectDocumentType, documentTypeByExtension } from '../documentType.js'

describe('detectDocumentType', () => {
  it.each([
    ['/documents/report.pdf', 'pdf'],
    ['/documents/report.docx', 'docx'],
    ['/documents/deck.pptx', 'pptx'],
    ['/documents/data.xlsx', 'xlsx'],
    ['/documents/notes.md', 'markdown'],
    ['/documents/notes.markdown', 'markdown'],
    ['/documents/REPORT.PDF', 'pdf'],
    ['/documents/Report.Docx', 'docx'],
  ] as const)('detects %s as %s', (filePath, type) => {
    expect(detectDocumentType(filePath)).toBe(type)
  })

  it('lists the open-dialog extensions without the leading dot', () => {
    expect(Object.keys(documentTypeByExtension).map((extension) => extension.slice(1))).toEqual([
      'pdf',
      'docx',
      'pptx',
      'xlsx',
      'md',
      'markdown',
    ])
  })

  it.each(['/documents/report.doc', '/documents/slides.ppt', '/documents/archive.zip'])(
    'returns null for unsupported file %s',
    (filePath) => {
      expect(detectDocumentType(filePath)).toBeNull()
    },
  )
})
