import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { DocumentRef } from '../../../src/shared/lib/fileFormat.js'
import type { CacheManager } from '../../fs/cacheManager.js'

export interface ReadLinkedDocumentArgs {
  documentRefId: string
  start?: number
  end?: number
}

interface ReadLinkedDocumentOptions {
  cacheManager: CacheManager
  documents: DocumentRef[] | (() => DocumentRef[])
}

function resolveDocuments(documents: ReadLinkedDocumentOptions['documents']): DocumentRef[] {
  return typeof documents === 'function' ? documents() : documents
}

function resolveCacheKey(doc: DocumentRef): string {
  const key = doc.metadata?.textCacheKey
  if (typeof key === 'string' && /^[A-Za-z0-9_-]+$/.test(key)) return key
  return doc.id
}

function findDocumentById(
  documents: DocumentRef[],
  documentRefId: string,
): DocumentRef | undefined {
  return documents.find((doc) => doc.id === documentRefId)
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function readLineRange(
  text: string,
  start?: number,
  end?: number,
): {
  text: string
  startLine: number
  endLine: number
  totalLines: number
} {
  const lines = text.split('\n')
  const totalLines = lines.length

  const requestedStart = start === undefined || start < 1 ? 1 : start
  const requestedEnd = end === undefined || end > totalLines ? totalLines : end

  const startLine = clamp(requestedStart, 1, totalLines)
  const endLine = clamp(requestedEnd, startLine, totalLines)

  const zeroBasedStart = startLine - 1
  const zeroBasedEnd = endLine

  return {
    text: lines.slice(zeroBasedStart, zeroBasedEnd).join('\n'),
    startLine,
    endLine,
    totalLines,
  }
}

export function createReadLinkedDocumentTool(
  options: ReadLinkedDocumentOptions,
): StructuredToolInterface {
  return tool(
    async ({ documentRefId, start, end }) => {
      const linkedDocuments = resolveDocuments(options.documents)
      const documentRef = findDocumentById(linkedDocuments, documentRefId)

      if (!documentRef) {
        return { ok: false, error: `未找到关联文档：${documentRefId}` }
      }

      const cacheKey = resolveCacheKey(documentRef)
      const cachedText = await options.cacheManager.readDocumentText(cacheKey)

      if (!cachedText) {
        return {
          ok: false,
          error: `文档文本尚未缓存：${documentRef.filename}（请先通过生成思维导图等方式解析该文档）`,
        }
      }

      const { text, startLine, endLine, totalLines } = readLineRange(cachedText, start, end)

      return {
        ok: true,
        documentRefId,
        text,
        startLine,
        endLine,
        totalLines,
      }
    },
    {
      name: 'readLinkedDocument',
      description:
        '按行号范围读取已关联文档的缓存文本。用户要求根据原文件、原文、文档或章节修改思维导图时，先用此工具读取相关文本，再调用思维导图操作工具修改节点。',
      schema: z.object({
        documentRefId: z.string().describe('要读取的关联文档 ID'),
        start: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('起始行号（1-based，闭区间；省略则从开头开始）'),
        end: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('结束行号（1-based，闭区间；省略则读到末尾）'),
      }),
    },
  )
}
