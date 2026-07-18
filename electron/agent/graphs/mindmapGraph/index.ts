import { StateGraph, START, END, getWriter } from '@langchain/langgraph'
import path from 'node:path'
import type { LLMProvider } from '../../providers/index.js'
import { MindmapSubgraphState } from '../../state.js'
import type { DocumentRef } from '../../state.js'
import { extractTextContent, formatAgentError } from '../../utils.js'
import { serializeMindmapOutline, type MindmapYamlNode } from '../../utils/yamlMindmap.js'
import { validateMindmapYaml } from '../../utils/yamlValidation.js'
import {
  loadDocument,
  createDefaultLoaders,
  splitDocuments,
  batchDocuments,
  computeBudgetChars,
  type DocumentLoaderRegistry,
} from '../../document/index.js'
import { extractRootTree } from './shared/rootTree.js'
import { MindmapInputResolver } from './inputResolver.js'
import { logger } from '../../../shared/logger.js'
import { currentStreamId } from '../../../shared/runContext.js'
import { takeModelCallCount } from '../../providers/metering.js'

import {
  hashText,
  hashFile,
  shortHash,
  saveDocumentTextCache,
  buildTextPreview,
} from './documentTextCache.js'

const log = logger.withContext('mindmap')

// ===== 配置选项 =====

interface MindmapSubgraphOptions {
  provider: LLMProvider
  userDataPath?: string
  loaders?: DocumentLoaderRegistry
}

const MERGE_GROUP_SIZE = 8
const YAML_GENERATION_ATTEMPTS = 3

/** Per-run start times keyed by streamId so summary lines can report total elapsed. */
const runStarts = new Map<string, number>()

function runKey(): string {
  return currentStreamId() ?? '(no-stream)'
}

/** Read and clear the run start (build_output always runs, so this never leaks). */
function takeRunStart(): number | undefined {
  const key = runKey()
  const start = runStarts.get(key)
  runStarts.delete(key)
  return start
}

function countTreeNodes(node: { children?: unknown[] }): number {
  return (
    1 +
    (node.children ?? []).reduce(
      (sum: number, child) => sum + countTreeNodes(child as { children?: unknown[] }),
      0,
    )
  )
}

type PromptMessage = { role: string; content: string }

type MindmapProgressStep = 'reading-doc' | 'extracting' | 'merging' | 'finalizing'

function emitProgress(step: MindmapProgressStep): void {
  getWriter()?.({ type: 'mindmap-progress', step })
}

function createMindmapRunReset(): Partial<typeof MindmapSubgraphState.State> {
  return {
    response: '',
    error: '',
    mindmapYaml: '',
    mindmapTitle: '',
    documentBatches: [],
    leafCursor: 0,
    leafResults: [],
    mergeInputs: [],
    partialMergedTrees: [],
    mergeResults: [],
    pendingMergeGroups: [],
    finalTree: null,
  }
}

// ===== Prompt builders =====

function buildLeafExtractPrompt(chunksText: string): PromptMessage[] {
  return [
    {
      role: 'system',
      content: `You are a knowledge structure extraction assistant.
Extract a hierarchical mindmap outline from the provided text.
Output only YAML. Do not include JSON, Markdown, or explanations.
Use "node:" format for parent nodes and "- child" for children.
Keep 2-3 levels deep, max 8 children per node.

Example output format:
Root Topic:
  - Section A:
    - Point 1
    - Point 2
  - Section B:
    - Point 3`,
    },
    {
      role: 'user',
      content: `Extract a mindmap outline from the following text:\n\n${chunksText}`,
    },
  ]
}

function buildMergePrompt(treesYaml: string): PromptMessage[] {
  return [
    {
      role: 'system',
      content: `You are a knowledge structure merging assistant.
Merge multiple YAML mindmap trees into one coherent, unified tree.
Output only YAML. Do not include JSON, Markdown, or explanations.
Use "node:" format for parent nodes and "- child" for children.
Keep 2-3 levels deep, max 8 children per node.
Remove duplicates and combine related topics.`,
    },
    {
      role: 'user',
      content: `Merge the following YAML trees into one unified tree:\n\n${treesYaml}`,
    },
  ]
}

async function generateValidMindmapYaml(
  provider: LLMProvider,
  initialMessages: PromptMessage[],
  fallbackTitle: string,
): Promise<{ tree: MindmapYamlNode; attempts: number }> {
  let messages = initialMessages
  let lastReason = 'YAML 校验失败'
  let lastOutput = ''

  for (let attempt = 1; attempt <= YAML_GENERATION_ATTEMPTS; attempt += 1) {
    const response = await provider.reasoningModel.invoke(messages)
    const content = extractTextContent(response.content)
    const validation = validateMindmapYaml(content, {
      mode: 'tree',
      fallbackTitle,
    })

    if (validation.ok) {
      return { tree: validation.tree, attempts: attempt }
    }

    lastReason = validation.reason
    lastOutput = content
    log.warn(
      'YAML 校验失败（attempt %d/%d，%s）：%s',
      attempt,
      YAML_GENERATION_ATTEMPTS,
      fallbackTitle,
      lastReason,
    )
    messages = buildYamlRepairPrompt(initialMessages, lastOutput, lastReason)
  }

  log.error(
    'YAML 校验连续 %d 次失败（%s）：%s',
    YAML_GENERATION_ATTEMPTS,
    fallbackTitle,
    lastReason,
  )
  throw new Error(`YAML 校验失败：${lastReason}`)
}

function buildYamlRepairPrompt(
  originalMessages: PromptMessage[],
  previousOutput: string,
  reason: string,
): PromptMessage[] {
  return [
    ...originalMessages,
    {
      role: 'assistant',
      content: previousOutput,
    },
    {
      role: 'user',
      content: `上一次输出的 YAML 无效，原因：${reason}

请根据原始任务重新生成完整的 outline YAML。
只输出 YAML，不要 JSON，不要 Markdown 解释，不要额外前后缀。
使用缩进表达层级：有子节点的节点写成“节点内容:”，子节点在下一行缩进后用“- 节点内容”。`,
    },
  ]
}

// ===== Node implementations =====

async function resolveInputNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const reset = createMindmapRunReset()
  const resolution = new MindmapInputResolver().resolve(state)

  if (!resolution) {
    return {
      ...reset,
      error: '请提供要生成思维导图的文档或文本。',
      response: '请提供要生成思维导图的文档或文本。',
    }
  }

  runStarts.set(runKey(), Date.now())
  log.info('入口： source=%s, title=%s', resolution.source.type, resolution.title)
  return {
    ...reset,
    mindmapInputSource: resolution.source,
    mindmapInputTitle: resolution.title,
  }
}

async function loadDocumentNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  emitProgress('reading-doc')
  const source = state.mindmapInputSource
  const reset = createMindmapRunReset()

  if (!source) {
    return {
      ...reset,
      error: '请提供输入来源。',
      response: '请提供输入来源。',
    }
  }

  try {
    // Document ingestion pipeline: load → split → batch; batches are precomputed into state
    const loaders = { ...createDefaultLoaders(), ...options.loaders }
    const docs = await loadDocument(source, loaders)
    const chunks = await splitDocuments(docs)
    const budgetChars = computeBudgetChars(options.provider.contextWindow)
    const batches = batchDocuments(chunks, budgetChars)

    if (batches.length === 0) {
      return {
        ...reset,
        error: '文档未能提取出任何文本内容。',
        response: '文档未能提取出任何文本内容。',
      }
    }

    log.info(
      '文档管线： source=%s, docs=%d, chunks=%d, batches=%d, budget=%d 字符',
      source.type,
      docs.length,
      chunks.length,
      batches.length,
      budgetChars,
    )

    const existingRef = state.documentRef
    const text = docs.map((doc) => doc.pageContent).join('\n\n')

    let hash: string
    let baseFilename: string
    let persistedSource: string
    let filename: string
    let type: DocumentRef['type']

    switch (source.type) {
      case 'pdf': {
        const filePath = source.path!
        type = 'pdf'
        hash =
          (await hashFile(filePath).catch(() => undefined)) ?? existingRef?.sha256 ?? hashText(text)
        baseFilename = existingRef?.filename || path.basename(filePath)
        persistedSource = filePath
        filename = existingRef?.filename || path.basename(filePath)
        break
      }
      case 'text': {
        type = 'text'
        hash = hashText(text)
        baseFilename = '用户输入'
        persistedSource = buildTextPreview(text)
        filename = `用户输入_${shortHash(hash)}.txt`
        break
      }
      case 'url': {
        type = 'url'
        hash = hashText(text)
        baseFilename = existingRef?.filename || 'URL来源'
        persistedSource = source.url!
        filename = existingRef?.filename || `URL来源_${shortHash(hash)}.txt`
        break
      }
      default: {
        // Exhaustive fallback
        type = source.type as DocumentRef['type']
        hash = hashText(text)
        baseFilename = existingRef?.filename || '未命名'
        persistedSource = String(source.path ?? source.url ?? source.content ?? '')
        filename = existingRef?.filename || `未命名_${shortHash(hash)}.txt`
      }
    }

    let textPath: string | undefined
    if (options.userDataPath) {
      textPath = await saveDocumentTextCache(options.userDataPath, baseFilename, hash, text)
    }

    const documentRef: DocumentRef = {
      id: hash,
      type,
      source: persistedSource,
      filename,
      importedAt: existingRef?.importedAt || new Date().toISOString(),
      title: existingRef?.title,
      pageCount: existingRef?.pageCount,
      textPath,
      sha256: hash,
    }

    return {
      ...reset,
      documentBatches: batches,
      leafCursor: 0,
      documentRef,
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    log.error('加载文档失败： %s', formatted.split('\n')[0])
    return {
      ...reset,
      error: formatted,
      response: `加载文档失败：${formatted.split('\n')[0]}`,
    }
  }
}

async function leafExtractNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  emitProgress('extracting')
  const batchIndex = state.leafCursor
  const batch = state.documentBatches[batchIndex]
  if (!batch) {
    return {}
  }

  const chunksText = batch.map((doc) => doc.pageContent).join('\n\n---\n\n')
  const batchStart = Date.now()

  try {
    const { tree, attempts } = await generateValidMindmapYaml(
      options.provider,
      buildLeafExtractPrompt(chunksText),
      `Batch ${batchIndex + 1}`,
    )

    const branches = (tree as { children?: unknown[] }).children?.length ?? 0
    log.info(
      'leaf %d/%d, 提取 %d 分支, %ss, 重试 %d 次',
      batchIndex + 1,
      state.documentBatches.length,
      branches,
      ((Date.now() - batchStart) / 1000).toFixed(1),
      attempts - 1,
    )

    return {
      leafResults: [
        ...state.leafResults,
        {
          batchIndex,
          batchId: `batch-${batchIndex + 1}`,
          tree,
        },
      ],
      leafCursor: batchIndex + 1,
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    log.error(
      'leaf %d/%d 提取失败： %s',
      batchIndex + 1,
      state.documentBatches.length,
      formatted.split('\n')[0],
    )
    return {
      error: formatted,
      response: `提取结构失败：${formatted.split('\n')[0]}`,
    }
  }
}

async function collectLeafNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const latestResult = state.leafResults[state.leafResults.length - 1]
  if (!latestResult) {
    return {}
  }

  const mergeInputs = [...state.mergeInputs, latestResult.tree]
  const leafDone = state.leafCursor >= state.documentBatches.length

  // A single leaf result needs no merge — it becomes the finalTree directly
  if (leafDone && mergeInputs.length === 1 && state.partialMergedTrees.length === 0) {
    return {
      mergeInputs: [],
      finalTree: mergeInputs[0],
    }
  }

  return { mergeInputs }
}

async function dispatchMergeNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  const leafDone = state.leafCursor >= state.documentBatches.length
  const inputs = leafDone
    ? [...state.partialMergedTrees, ...state.mergeInputs]
    : state.mergeInputs.slice(0, MERGE_GROUP_SIZE)
  const groups: Array<{ groupIndex: number; trees: unknown[] }> = []

  for (let i = 0; i < inputs.length; i += MERGE_GROUP_SIZE) {
    groups.push({
      groupIndex: Math.floor(i / MERGE_GROUP_SIZE),
      trees: inputs.slice(i, i + MERGE_GROUP_SIZE),
    })
  }

  return {
    pendingMergeGroups: groups,
    mergeResults: [],
  }
}

async function mergeTreesNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  emitProgress('merging')
  const groups = state.pendingMergeGroups
  if (groups.length === 0) {
    return {}
  }

  // For simplicity, process groups sequentially
  const results: Array<{ groupIndex: number; tree: unknown }> = []

  for (const group of groups) {
    const treesYaml = group.trees
      .map((tree, i) => {
        const rootTree = extractRootTree(tree, `Tree ${i + 1}`)
        return `--- Tree ${i + 1} ---\n${rootTree ? serializeMindmapOutline(rootTree) : String(tree)}`
      })
      .join('\n\n')

    try {
      const groupStart = Date.now()
      const { tree, attempts } = await generateValidMindmapYaml(
        options.provider,
        buildMergePrompt(treesYaml),
        `Merged Tree ${group.groupIndex + 1}`,
      )

      log.info(
        'merge group %d/%d, 合并 %d 棵树, %ss, 重试 %d 次',
        group.groupIndex + 1,
        groups.length,
        group.trees.length,
        ((Date.now() - groupStart) / 1000).toFixed(1),
        attempts - 1,
      )

      results.push({
        groupIndex: group.groupIndex,
        tree,
      })
    } catch (error) {
      const formatted = formatAgentError(error)
      return {
        error: formatted,
        response: `合并结构失败：${formatted.split('\n')[0]}`,
      }
    }
  }

  return {
    mergeResults: results,
  }
}

async function collectMergeNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  if (state.finalTree) {
    return {}
  }

  const results = state.mergeResults
  const trees = results.map((r) => r.tree)
  const leafDone = state.leafCursor >= state.documentBatches.length

  if (!leafDone) {
    return {
      partialMergedTrees: [...state.partialMergedTrees, ...trees],
      mergeInputs: state.mergeInputs.slice(MERGE_GROUP_SIZE),
      pendingMergeGroups: [],
      mergeResults: [],
    }
  }

  // If only one result, it's the final tree
  if (results.length === 1) {
    return {
      finalTree: results[0]!.tree,
      mergeInputs: [],
      partialMergedTrees: [],
      pendingMergeGroups: [],
      mergeResults: [],
    }
  }

  // Multiple results — need another merge round
  return {
    mergeInputs: trees,
    partialMergedTrees: [],
    pendingMergeGroups: [],
    mergeResults: [],
  }
}

async function buildOutputNode(
  state: typeof MindmapSubgraphState.State,
): Promise<Partial<typeof MindmapSubgraphState.State>> {
  emitProgress('finalizing')
  // build_output always terminates a run — consume the run start here so
  // failed runs don't leak entries in runStarts.
  const runStart = takeRunStart()
  // Preserve existing error
  if (state.error) {
    return {}
  }

  const tree = state.finalTree
  const title = state.mindmapInputTitle || '思维导图'

  if (!tree) {
    return {
      error: '未能生成有效的思维导图结构',
      response: '生成思维导图失败：未能生成有效的结构',
    }
  }

  const rootTree = extractRootTree(tree, title)
  if (!rootTree) {
    return {
      error: 'AI 未返回有效的思维导图结构',
      response: '生成思维导图失败：无法解析结构',
    }
  }

  const finalTitle = rootTree.label || title

  if (!rootTree.children || rootTree.children.length === 0) {
    return {
      error: '未提取到任何要点',
      response: '生成思维导图失败：未提取到任何要点',
    }
  }

  log.info(
    '完成： 总耗时 %ss, 产出 %d 节点, 模型调用 %d 次, title=%s',
    runStart ? ((Date.now() - runStart) / 1000).toFixed(1) : '0',
    countTreeNodes(rootTree),
    takeModelCallCount(currentStreamId() ?? ''),
    finalTitle,
  )

  return {
    pendingSubgraph: null,
    mindmapYaml: serializeMindmapOutline(rootTree),
    mindmapTitle: finalTitle,
    response: `已生成思维导图「${finalTitle}」。`,
  }
}

// ===== Edge routing functions =====

function routeAfterResolveInput(state: typeof MindmapSubgraphState.State): string {
  if (state.error) return 'build_output'
  return 'load_document'
}

function routeAfterLoadDocument(state: typeof MindmapSubgraphState.State): string {
  if (state.error) return 'build_output'
  return 'leaf_extract'
}

function routeAfterCollectLeaf(state: typeof MindmapSubgraphState.State): string {
  if (state.error || state.finalTree) return 'build_output'
  if (state.mergeInputs.length >= MERGE_GROUP_SIZE) return 'dispatch_merge'
  if (state.leafCursor < state.documentBatches.length) return 'leaf_extract'
  if (state.mergeInputs.length > 0 || state.partialMergedTrees.length > 0) return 'dispatch_merge'
  return 'build_output'
}

function routeAfterCollectMerge(state: typeof MindmapSubgraphState.State): string {
  if (state.error || state.finalTree) return 'build_output'
  if (state.mergeInputs.length >= MERGE_GROUP_SIZE) return 'dispatch_merge'
  if (state.leafCursor < state.documentBatches.length) return 'leaf_extract'
  if (state.mergeInputs.length > 0 || state.partialMergedTrees.length > 0) return 'dispatch_merge'
  return 'build_output'
}

// ===== Subgraph 构建器 =====

/**
 * Build the Mindmap Subgraph
 *
 * Flow:
 * START -> resolve_input -> load_document (load → split → batch, precomputed once)
 *   -> leaf_extract -> collect_leaf -> (loop by batch index, or merge)
 *   -> dispatch_merge -> merge_trees -> collect_merge -> (loop or output)
 *   -> build_output -> END
 * A single leaf result skips merge and goes straight to output.
 */
export function buildMindmapSubgraph(options: MindmapSubgraphOptions) {
  const graph = new StateGraph(MindmapSubgraphState)
    .addNode('resolve_input', (state) => resolveInputNode(state))
    .addNode('load_document', (state) => loadDocumentNode(state, options))
    .addNode('leaf_extract', (state) => leafExtractNode(state, options))
    .addNode('collect_leaf', (state) => collectLeafNode(state))
    .addNode('dispatch_merge', (state) => dispatchMergeNode(state))
    .addNode('merge_trees', (state) => mergeTreesNode(state, options))
    .addNode('collect_merge', (state) => collectMergeNode(state))
    .addNode('build_output', (state) => buildOutputNode(state))

  // START -> resolve_input -> load_document
  graph.addEdge(START, 'resolve_input')
  graph.addConditionalEdges('resolve_input', routeAfterResolveInput, [
    'load_document',
    'build_output',
  ])

  // load_document precomputes batches, then enters the leaf loop directly
  graph.addConditionalEdges('load_document', routeAfterLoadDocument, [
    'leaf_extract',
    'build_output',
  ])

  graph.addEdge('leaf_extract', 'collect_leaf')
  graph.addConditionalEdges('collect_leaf', routeAfterCollectLeaf, [
    'leaf_extract',
    'dispatch_merge',
    'build_output',
  ])

  graph.addEdge('dispatch_merge', 'merge_trees')
  graph.addEdge('merge_trees', 'collect_merge')
  graph.addConditionalEdges('collect_merge', routeAfterCollectMerge, [
    'dispatch_merge',
    'leaf_extract',
    'build_output',
  ])

  // Final output
  graph.addEdge('build_output', END)

  return graph
}
