import fs from 'node:fs/promises'
import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocumentRef } from '../../../src/shared/lib/fileFormat.js'
import type { CacheManager } from '../../fs/cacheManager.js'
import { PdfInputAnalyzer } from '../graphs/mindmapGraph/loaders/pdfLoader.js'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10
const SNIPPET_CONTEXT_CHARS = 500

interface LinkedDocumentSearchOptions {
  documents: DocumentRef[] | (() => DocumentRef[])
  cacheManager: CacheManager
}

function resolveDocuments(documents: LinkedDocumentSearchOptions['documents']): DocumentRef[] {
  return typeof documents === 'function' ? documents() : documents
}

function getTextCacheKey(doc: DocumentRef): string {
  const key = doc.metadata?.textCacheKey
  if (typeof key === 'string' && /^[A-Za-z0-9_-]+$/.test(key)) return key
  return doc.id
}

function getOriginalPath(doc: DocumentRef): string | null {
  const originalPath = doc.metadata?.originalPath
  if (typeof originalPath === 'string' && originalPath.trim()) return originalPath
  return doc.source || null
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function normalizeSnippet(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

async function loadDocumentText(
  doc: DocumentRef,
  cacheManager: CacheManager,
): Promise<string | null> {
  const cacheKey = getTextCacheKey(doc)
  const cachedText = await cacheManager.readDocumentText(cacheKey)
  if (cachedText) return cachedText

  if (doc.type !== 'pdf') return null

  const originalPath = getOriginalPath(doc)
  if (!originalPath || !(await pathExists(originalPath))) return null

  const analyzer = new PdfInputAnalyzer()
  const pages = await analyzer.load(originalPath)
  const text = pages.map((page) => page.text).join('\n\n')
  if (!text.trim()) return null

  await cacheManager.cacheDocumentText(cacheKey, text)
  return text
}

function findMatches(
  doc: DocumentRef,
  text: string,
  query: string,
  limit: number,
): Array<{ docId: string; filename: string; snippet: string; start: number; end: number }> {
  const normalizedQuery = query.toLocaleLowerCase()
  const searchableText = text.toLocaleLowerCase()
  const matches: Array<{ docId: string; filename: string; snippet: string; start: number; end: number }> = []
  let searchFrom = 0

  while (matches.length < limit) {
    const matchIndex = searchableText.indexOf(normalizedQuery, searchFrom)
    if (matchIndex < 0) break

    const start = Math.max(0, matchIndex - SNIPPET_CONTEXT_CHARS)
    const end = Math.min(text.length, matchIndex + query.length + SNIPPET_CONTEXT_CHARS)
    matches.push({
      docId: doc.id,
      filename: doc.filename,
      snippet: normalizeSnippet(text.slice(start, end)),
      start,
      end,
    })
    searchFrom = matchIndex + Math.max(query.length, 1)
  }

  return matches
}

export function createSearchLinkedDocumentTool(
  options: LinkedDocumentSearchOptions,
): StructuredToolInterface {
  return tool(
    async ({ query, docId, limit }) => {
      const normalizedQuery = query.trim()
      if (!normalizedQuery) {
        return { ok: false, error: '搜索关键词不能为空' }
      }

      const linkedDocuments = resolveDocuments(options.documents)
      const documents = docId
        ? linkedDocuments.filter((doc) => doc.id === docId)
        : linkedDocuments

      if (documents.length === 0) {
        return {
          ok: false,
          error: docId
            ? `未找到关联文档：${docId}`
            : '当前思维导图没有关联源文档',
        }
      }

      const cappedLimit = Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
      const matches: Array<{ docId: string; filename: string; snippet: string; start: number; end: number }> = []
      const unavailable: string[] = []

      for (const doc of documents) {
        if (matches.length >= cappedLimit) break
        const text = await loadDocumentText(doc, options.cacheManager)
        if (!text) {
          unavailable.push(doc.filename)
          continue
        }

        matches.push(
          ...findMatches(doc, text, normalizedQuery, cappedLimit - matches.length),
        )
      }

      if (matches.length === 0) {
        const suffix = unavailable.length > 0
          ? `；以下文档缓存缺失且原文件不可访问：${unavailable.join('、')}`
          : ''
        return { ok: false, error: `未找到匹配片段${suffix}` }
      }

      return { ok: true, matches }
    },
    {
      name: 'searchLinkedDocument',
      description: '在当前思维导图关联源文档的文本缓存中搜索关键词片段。用户要求根据原文件、原文、文档或章节修改思维导图时，应先调用此工具获取相关原文片段。',
      schema: z.object({
        query: z.string().describe('要搜索的关键词、短语或章节名'),
        docId: z.string().optional().describe('指定只搜索某个关联文档；不提供则搜索所有关联文档'),
        limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe('最多返回多少条片段，默认 5，最大 10'),
      }),
    },
  )
}
