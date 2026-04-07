import type { Document } from '@langchain/core/documents'
import type { Chunk, ChunkMetadata } from '../../types.js'
import crypto from 'node:crypto'
import path from 'node:path'

export interface HierarchicalChunkerOptions {
  maxChunkSize?: number      // Maximum chunk size (default: 1000)
  minChunkSize?: number      // Minimum chunk size (default: 300)
  chunkOverlap?: number      // Overlap between chunks (default: 100)
}

/**
 * Hierarchical chunker that preserves document structure
 * Level 0: Document (rarely used)
 * Level 1: Chapter/Section
 * Level 2: Paragraph
 * Level 3: Sentence (for very long paragraphs)
 */
export class HierarchicalChunker {
  private options: Required<HierarchicalChunkerOptions>

  constructor(options: HierarchicalChunkerOptions = {}) {
    this.options = {
      maxChunkSize: options.maxChunkSize ?? 1000,
      minChunkSize: options.minChunkSize ?? 300,
      chunkOverlap: options.chunkOverlap ?? 100,
    }
  }

  /**
   * Chunk a document while preserving hierarchy
   */
  chunkDocument(
    doc: Document,
    docId: string,
    options?: {
      sectionTitle?: string
      path?: string[]
      pageNumber?: number
      level?: number
    }
  ): Chunk[] {
    const content = doc.pageContent
    const sourcePath = doc.metadata.source ?? 'unknown'
    const metadata: Omit<ChunkMetadata, 'charCount' | 'indexedAt'> = {
      docId,
      filename: doc.metadata.filename ?? path.basename(sourcePath),
      source: sourcePath,
      pageNumber: options?.pageNumber ?? doc.metadata.loc?.pageNumber,
      sectionTitle: options?.sectionTitle ?? doc.metadata.sectionTitle,
      path: options?.path ?? [],
      nodeId: doc.metadata.nodeId,
      nodeLevel: doc.metadata.nodeLevel,
    }

    // If content is small enough, return as single chunk
    if (content.length <= this.options.maxChunkSize) {
      return [this.createChunk(content, metadata, options?.level ?? 2, undefined)]
    }

    // Split into paragraphs first
    const paragraphs = this.splitIntoParagraphs(content)
    const chunks: Chunk[] = []

    for (const para of paragraphs) {
      if (para.length <= this.options.maxChunkSize) {
        chunks.push(this.createChunk(para, metadata, 2, undefined))
      } else {
        // Split long paragraphs into overlapping chunks
        const paraChunks = this.splitLongParagraph(para)
        for (const chunkContent of paraChunks) {
          chunks.push(this.createChunk(chunkContent, metadata, 2, undefined))
        }
      }
    }

    return chunks
  }

  /**
   * Chunk PDF with page awareness
   * Optimized to reduce chunk count by merging smaller sections
   */
  chunkPDF(
    pages: Array<{ text: string; num: number }>,
    docId: string,
    filePath: string
  ): Chunk[] {
    const chunks: Chunk[] = []
    const filename = path.basename(filePath)

    // Collect all text content first
    const allText = pages.map(p => p.text).join('\n')

    // Split into paragraphs
    const paragraphs = this.splitIntoParagraphs(allText)

    // Merge paragraphs into larger chunks
    let currentChunk = ''
    let currentSection = ''
    let startPage = pages[0]?.num ?? 1

    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i]
      const trimmed = para.trim()
      if (!trimmed) continue

      // Check if this is a section header
      if (this.isSectionHeader(trimmed)) {
        // Save current chunk if it's large enough
        if (currentChunk.length >= this.options.minChunkSize) {
          chunks.push(
            this.createChunk(
              currentChunk.trim(),
              {
                docId,
                filename,
                source: filePath,
                pageNumber: startPage,
                sectionTitle: currentSection,
                path: currentSection ? [currentSection] : [],
              },
              1,
              undefined
            )
          )
        }
        currentSection = trimmed
        currentChunk = ''
        startPage = pages[0]?.num ?? 1
      } else {
        // Check if adding this paragraph would exceed maxChunkSize
        if (currentChunk.length + trimmed.length + 1 > this.options.maxChunkSize && currentChunk.length >= this.options.minChunkSize) {
          chunks.push(
            this.createChunk(
              currentChunk.trim(),
              {
                docId,
                filename,
                source: filePath,
                pageNumber: startPage,
                sectionTitle: currentSection,
                path: currentSection ? [currentSection] : [],
              },
              1,
              undefined
            )
          )
          currentChunk = trimmed + '\n'
          startPage = pages[0]?.num ?? 1
        } else {
          currentChunk += trimmed + '\n'
        }
      }
    }

    // Save last chunk — always keep it if no chunks were produced yet
    if (currentChunk.trim().length > 0 && (currentChunk.length >= this.options.minChunkSize || chunks.length === 0)) {
      chunks.push(
        this.createChunk(
          currentChunk.trim(),
          {
            docId,
            filename,
            source: filePath,
            pageNumber: pages[pages.length - 1]?.num ?? startPage,
            sectionTitle: currentSection,
            path: currentSection ? [currentSection] : [],
          },
          1,
          undefined
        )
      )
    }

    return chunks
  }

  /**
   * Chunk MindLane with hierarchy preservation
   */
  chunkMindLane(
    nodes: Array<{
      id: string
      data?: { label?: string }
      type?: string
      parentId?: string
    }>,
    docId: string,
    filePath: string,
    title: string
  ): Chunk[] {
    const chunks: Chunk[] = []
    const filename = path.basename(filePath)

    // Build parent mapping
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))

    // Calculate paths for each node
    const getPath = (nodeId: string): string[] => {
      const paths: string[] = []
      let current = nodeMap.get(nodeId)
      while (current?.parentId) {
        const parent = nodeMap.get(current.parentId)
        if (parent?.data?.label) {
          paths.unshift(parent.data.label)
        }
        current = parent
      }
      return paths
    }

    // Calculate level
    const getLevel = (nodeId: string): number => {
      let level = 0
      let current = nodeMap.get(nodeId)
      while (current?.parentId) {
        level++
        current = nodeMap.get(current.parentId)
      }
      return level
    }

    for (const node of nodes) {
      const label = node.data?.label
      if (!label || label.length < 2) continue

      const nodePath = getPath(node.id)
      const level = getLevel(node.id)

      chunks.push(
        this.createChunk(
          label,
          {
            docId,
            filename,
            source: filePath,
            sectionTitle: title,
            path: [title, ...nodePath],
            nodeId: node.id,
            nodeLevel: level,
          },
          Math.min(level + 1, 3),
          undefined
        )
      )
    }

    return chunks
  }

  /**
   * Detect if a line is a section header
   */
  private isSectionHeader(line: string): boolean {
    const trimmed = line.trim()

    // Numbered headers: "1. Introduction", "2.1 Subsection"
    if (/^\d+(\.\d+)*\.?\s+\w+/.test(trimmed)) {
      return true
    }

    // Short lines (likely headers)
    if (trimmed.length < 50 && trimmed.length > 3) {
      // All caps
      if (trimmed === trimmed.toUpperCase()) {
        return true
      }

      // Ends with colon
      if (trimmed.endsWith(':')) {
        return true
      }

      // Common header words
      const headerWords = [
        'chapter',
        'section',
        'introduction',
        'conclusion',
        'summary',
        'overview',
        '背景',
        '介绍',
        '总结',
        '结论',
        '概述',
      ]
      const lower = trimmed.toLowerCase()
      if (headerWords.some((w) => lower.includes(w))) {
        return true
      }
    }

    return false
  }

  /**
   * Split content into paragraphs
   */
  private splitIntoParagraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)
  }

  /**
   * Split long paragraph into overlapping chunks
   */
  private splitLongParagraph(text: string): string[] {
    const chunks: string[] = []
    let start = 0

    while (start < text.length) {
      const end = Math.min(start + this.options.maxChunkSize, text.length)
      chunks.push(text.slice(start, end))
      if (end >= text.length) break
      const nextStart = end - this.options.chunkOverlap
      start = nextStart <= start ? start + 1 : nextStart
    }

    return chunks
  }

  /**
   * Create a chunk with proper metadata
   */
  private createChunk(
    content: string,
    metadata: Omit<ChunkMetadata, 'charCount' | 'indexedAt'>,
    level: number,
    parentId: string | undefined
  ): Chunk {
    return {
      id: crypto.randomUUID(),
      content,
      level,
      parentId,
      metadata: {
        ...metadata,
        charCount: content.length,
        indexedAt: new Date().toISOString(),
      },
    }
  }
}
