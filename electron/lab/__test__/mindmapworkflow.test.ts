import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import { sanitizeTreeCandidate } from '../mindmapworkflow/utils.js'
import {
  __test__,
  chunkPdfPages,
  loadPdfPages,
  runMindmapWorkflow,
  serializeMindmapYaml,
  type MindmapYamlNode,
  type PdfPage,
} from '../mindmapworkflow.js'

const LAB_DIR = path.dirname(new URL('../mindmapworkflow.ts', import.meta.url).pathname)
const SAMPLE_PDF = path.join(LAB_DIR, '..', 'lab', 'Hello-Agents-V1.0.2-20260210.pdf')

const tempDirs: string[] = []

class FakeModel {
  constructor(private failLeafRanges = new Set<string>()) {}

  async invoke(input: unknown): Promise<{ content: string }> {
    const text = getPromptText(input)
    if (text.includes('待合并 YAML')) {
      const trees = parseMergeTrees(text)
      return {
        content: makeOutlineYaml({
          label: `合并主题 ${__test__.derivePageRange(trees)}`,
          page_range: __test__.derivePageRange(trees),
          children: trees,
        }),
      }
    }

    const chunkEntries = extractLeafChunks(text)
    for (const entry of chunkEntries) {
      if (this.failLeafRanges.has(entry.range)) {
        throw new Error(`forced failure for ${entry.range}`)
      }
    }

    return {
      content: makeLeafBatchYaml(chunkEntries.map((entry) => ({
        chunkId: entry.chunkId,
        tree: {
          label: `主题 ${entry.range}`,
          page_range: entry.range,
          children: [
            {
              label: `子主题 ${entry.range}`,
              page_range: entry.range,
              children: [],
            },
          ],
        },
      }))),
    }
  }
}

class FakeNumericPageRangeModel {
  async invoke(input: unknown): Promise<{ content: string }> {
    const text = getPromptText(input)
    if (text.includes('待合并 YAML')) {
      const trees = parseMergeTrees(text)
      return {
        content: YAML.stringify({
          label: `合并主题 ${__test__.derivePageRange(trees)}`,
          page_range: 1,
          children: trees,
        }),
      }
    }

    const chunkEntries = extractLeafChunks(text)

    return {
      content: YAML.stringify({
        results: chunkEntries.map((entry) => ({
          chunk_id: entry.chunkId,
          mindmap: {
            label: `主题 ${entry.startPage}`,
            page_range: entry.startPage,
            children: [
              {
                label: `子主题 ${entry.startPage}`,
                page_range: entry.startPage,
                children: [],
              },
            ],
          },
        })),
      }),
    }
  }
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true })
    }),
  )
})

describe('mindmap workflow lab', () => {
  it('loads sample PDF with page-level text', async () => {
    const pages = await loadPdfPages(SAMPLE_PDF)
    expect(pages.length).toBe(633)
    expect(pages[0]?.text.length).toBeGreaterThan(0)
  }, 120000)

  it('chunks sample PDF and covers full page range', async () => {
    const pages = await loadPdfPages(SAMPLE_PDF)
    const chunks = chunkPdfPages(pages, 7000)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]?.startPage).toBe(1)
    expect(chunks.at(-1)?.endPage).toBe(633)

    for (let index = 1; index < chunks.length; index += 1) {
      expect(chunks[index]!.startPage).toBe(chunks[index - 1]!.endPage + 1)
    }
  }, 120000)

  it('dispatches grouped leaf sends by leafChunkGroupSize', () => {
    const state = {
      pendingLeafRange: { start: 0, end: 5 },
      chunks: Array.from({ length: 5 }, (_, index) => ({
        id: `chunk-${index + 1}`,
        index,
        startPage: index + 1,
        endPage: index + 1,
        text: `page ${index + 1}`,
      })),
      document: {
        pdfPath: '/tmp/test.pdf',
        title: 'test',
        totalPages: 5,
        totalChars: 100,
      },
    } as Parameters<typeof __test__.routeLeafBatch>[0]

    const sends = __test__.routeLeafBatch(state, 2)
    expect(sends).toHaveLength(3)
    expect(sends[0]?.node).toBe('leaf_extract')
    expect(sends[0]?.args.chunks).toHaveLength(2)
    expect(sends[2]?.args.chunks[0]?.index).toBe(4)
  })

  it('sorts leaf results by chunk index', () => {
    const sorted = __test__.sortLeafResults([
      { chunkIndex: 3, chunkId: 'c3', tree: makeTree('3-3') },
      { chunkIndex: 1, chunkId: 'c1', tree: makeTree('1-1') },
      { chunkIndex: 2, chunkId: 'c2', tree: makeTree('2-2') },
    ])

    expect(sorted.map((item) => item.chunkId)).toEqual(['c1', 'c2', 'c3'])
  })

  it('serializes YAML with expected top-level keys', () => {
    const yaml = serializeMindmapYaml(
      {
        pdfPath: '/tmp/test.pdf',
        title: 'test',
        totalPages: 10,
        totalChars: 1000,
      },
      makeTree('1-10'),
      new Date('2026-05-04T00:00:00.000Z'),
    )

    expect(yaml).toContain('document:')
    expect(yaml).toContain('generated_at:')
    expect(yaml).toContain('mindmap:')
    expect(yaml).toContain('主题 1-10')
  })

  it('runs the workflow end-to-end and writes yaml/log files', async () => {
    const outputDir = await makeTempDir()
    const result = await runMindmapWorkflow(
      {
        apiKey: '',
        baseUrl: '',
        model: '',
        pdfPath: SAMPLE_PDF,
        outputDir,
        chunkCharLimit: 350,
        concurrency: 4,
        leafChunkGroupSize: 2,
        mergeBatchSize: 2,
        debug: false,
      },
      {
        model: new FakeModel(),
        pdfLoader: async () => makePages(633, 48),
        now: () => new Date('2026-05-04T00:00:00.000Z'),
      },
    )

    const yaml = await fs.readFile(result.yamlPath, 'utf-8')
    const log = await fs.readFile(result.logPath, 'utf-8')

    expect(result.pageCount).toBe(633)
    expect(result.leafChunkCount).toBeGreaterThan(1)
    expect(result.mergeRounds).toBeGreaterThan(1)
    expect(yaml).toContain('document:')
    expect(yaml).toContain('mindmap:')
    expect(log).toContain('workflow 启动')
    expect(log).toContain('finalize: YAML 已写入')
  })

  it('writes yaml and logs to separate files across repeated runs', async () => {
    const outputDir = await makeTempDir()
    const config = {
      apiKey: '',
      baseUrl: '',
      model: '',
      pdfPath: SAMPLE_PDF,
      outputDir,
      chunkCharLimit: 180,
      concurrency: 2,
      leafChunkGroupSize: 2,
      mergeBatchSize: 2,
      debug: false,
    }

    const deps = {
      model: new FakeModel(),
      pdfLoader: async () => makePages(6, 30),
      now: () => new Date('2026-05-04T00:00:00.000Z'),
    }

    const first = await runMindmapWorkflow(config, deps)
    const second = await runMindmapWorkflow(config, deps)

    expect(first.yamlPath).not.toBe(second.yamlPath)
    expect(first.logPath).not.toBe(second.logPath)
    await expect(fs.readFile(first.yamlPath, 'utf-8')).resolves.toContain('mindmap:')
    await expect(fs.readFile(second.yamlPath, 'utf-8')).resolves.toContain('mindmap:')
    await expect(fs.readFile(first.logPath, 'utf-8')).resolves.toContain('workflow 启动')
    await expect(fs.readFile(second.logPath, 'utf-8')).resolves.toContain('workflow 启动')
  })

  it('falls back to a degraded leaf node when one chunk fails', async () => {
    const outputDir = await makeTempDir()
    const pages = makePages(20, 30)
    const rangeToFail = chunkPdfPages(pages, 180)[0]!.startPage + '-' + chunkPdfPages(pages, 180)[0]!.endPage

    const result = await runMindmapWorkflow(
      {
        apiKey: '',
        baseUrl: '',
        model: '',
        pdfPath: SAMPLE_PDF,
        outputDir,
        chunkCharLimit: 180,
        concurrency: 2,
        leafChunkGroupSize: 2,
        mergeBatchSize: 2,
        debug: false,
      },
      {
        model: new FakeModel(new Set([rangeToFail])),
        pdfLoader: async () => pages,
      },
    )

    const yaml = await fs.readFile(result.yamlPath, 'utf-8')
    expect(yaml).toContain('未解析片段')
  })

  it('normalizes numeric page_range values from model YAML output', async () => {
    const outputDir = await makeTempDir()
    const result = await runMindmapWorkflow(
      {
        apiKey: '',
        baseUrl: '',
        model: '',
        pdfPath: SAMPLE_PDF,
        outputDir,
        chunkCharLimit: 180,
        concurrency: 2,
        leafChunkGroupSize: 2,
        mergeBatchSize: 2,
        debug: false,
      },
      {
        model: new FakeNumericPageRangeModel(),
        pdfLoader: async () => makePages(6, 30),
      },
    )

    const yaml = await fs.readFile(result.yamlPath, 'utf-8')
    expect(yaml).toContain('主题 1')
    expect(yaml).not.toContain('未解析片段')
  })
})

function makePages(count: number, repeatCount: number): PdfPage[] {
  return Array.from({ length: count }, (_, index) => ({
    num: index + 1,
    text: `Page ${index + 1} ${'内容 '.repeat(repeatCount)}`,
  }))
}

function makeTree(range: string): MindmapYamlNode {
  return {
    label: `主题 ${range}`,
    page_range: range,
    children: [],
  }
}

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mindmap-lab-'))
  tempDirs.push(dir)
  return dir
}

function getPromptText(input: unknown): string {
  if (typeof input === 'string') return input
  if (!Array.isArray(input)) return String(input ?? '')
  return input
    .map((message) => {
      if (message && typeof message === 'object' && 'content' in message) {
        const content = (message as { content?: unknown }).content
        if (typeof content === 'string') return content
      }
      return ''
    })
    .join('\n')
}

function parseMergeTrees(prompt: string): MindmapYamlNode[] {
  const marker = '待合并 YAML：'
  const index = prompt.indexOf(marker)
  if (index < 0) return []
  const yamlText = prompt.slice(index + marker.length).trim()
  const parsed = YAML.parse(yamlText) as unknown
  if (!Array.isArray(parsed)) return []

  return parsed
    .map((item) => sanitizeTreeCandidate([item]))
    .filter((item): item is MindmapYamlNode => Boolean(item))
}

function extractLeafChunks(prompt: string): Array<{
  chunkId: string
  range: string
  startPage: number
}> {
  const matches = [...prompt.matchAll(/chunk_id:\s*(chunk-\d+)[\s\S]*?page_range:\s*(\d+-\d+)/g)]
  return matches.map((match) => ({
    chunkId: match[1]!,
    range: match[2]!,
    startPage: Number(match[2]!.split('-')[0]),
  }))
}

function makeLeafBatchYaml(
  results: Array<{ chunkId: string; tree: MindmapYamlNode }>,
): string {
  return YAML.stringify({
    results: results.map((result) => ({
      chunk_id: result.chunkId,
      mindmap: YAML.parse(makeOutlineYaml(result.tree)),
    })),
  })
}

function makeOutlineYaml(tree: MindmapYamlNode): string {
  return outlineLines(tree, 0, true).join('\n')
}

function outlineLines(
  node: MindmapYamlNode,
  indentLevel: number,
  isRoot: boolean,
): string[] {
  const indent = '  '.repeat(indentLevel)
  const title = `${node.label} [p${node.page_range}]`
  const children = node.children ?? []

  if (isRoot) {
    if (children.length === 0) {
      return [`${indent}${JSON.stringify(title)}: []`]
    }

    return [
      `${indent}${JSON.stringify(title)}:`,
      ...children.flatMap((child) => outlineLines(child, indentLevel + 1, false)),
    ]
  }

  if (children.length === 0) {
    return [`${indent}- ${JSON.stringify(title)}`]
  }

  return [
    `${indent}- ${JSON.stringify(title)}:`,
    ...children.flatMap((child) => outlineLines(child, indentLevel + 1, false)),
  ]
}
