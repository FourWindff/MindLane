import fs from 'node:fs/promises'
import path from 'node:path'
import { Annotation, END, Send, START, StateGraph } from '@langchain/langgraph'
import { z } from 'zod'
import { LeafExtractAgent, MergeAgent } from './agents.js'
import { chunkPdfPages, serializeMindmapYaml } from './io.js'
import { createRuntime } from './runtime.js'
import { LeafTaskSchema, MergeTaskSchema } from './schemas.js'
import type {
  AnthropicLabConfig,
  DocumentMeta,
  LeafExtractionResult,
  MergeGroup,
  MergeTreeResult,
  MindmapWorkflowResult,
  MindmapYamlNode,
  PdfChunk,
  PendingLeafRange,
  WorkflowDependencies,
  WorkflowError,
  WorkflowLogEntry,
  WorkflowMetricSnapshot,
  WorkflowRuntime,
} from './types.js'
import {
  createEmptyMindmapNode,
  fallbackLeafNode,
  fallbackMergeNode,
  derivePageRange,
  groupTrees,
  sortLeafResults,
  sortMergeResults,
} from './utils.js'
import { overwriteArray } from '../utils/yamlMindmap.js'

const WorkflowState = Annotation.Root({
  document: Annotation<DocumentMeta | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  chunks: Annotation<PdfChunk[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  leafCursor: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  pendingLeafRange: Annotation<PendingLeafRange | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  leafResults: Annotation<LeafExtractionResult[]>({
    reducer: (prev, next) => sortLeafResults([...prev, ...next]),
    default: () => [],
  }),
  mergeRound: Annotation<number>({
    reducer: (_prev, next) => next,
    default: () => 0,
  }),
  mergeInputs: Annotation<MindmapYamlNode[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  pendingMergeGroups: Annotation<MergeGroup[]>({
    reducer: (_prev, next) => next,
    default: () => [],
  }),
  mergeResults: Annotation<MergeTreeResult[]>({
    reducer: (prev, next) => sortMergeResults([...prev, ...next]),
    default: () => [],
  }),
  finalTree: Annotation<MindmapYamlNode | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  artifacts: Annotation<{ yamlPath: string; logPath: string } | null>({
    reducer: (_prev, next) => next,
    default: () => null,
  }),
  metrics: Annotation<WorkflowMetricSnapshot>({
    reducer: (prev, next) => ({
      leafChunkCount: prev.leafChunkCount + next.leafChunkCount,
      leafSuccessCount: prev.leafSuccessCount + next.leafSuccessCount,
      leafFailureCount: prev.leafFailureCount + next.leafFailureCount,
      mergeCallCount: prev.mergeCallCount + next.mergeCallCount,
    }),
    default: () => ({
      leafChunkCount: 0,
      leafSuccessCount: 0,
      leafFailureCount: 0,
      mergeCallCount: 0,
    }),
  }),
  errors: Annotation<WorkflowError[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  logs: Annotation<WorkflowLogEntry[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
})

type WorkflowStateType = typeof WorkflowState.State
type LeafTask = z.infer<typeof LeafTaskSchema>
type MergeTask = z.infer<typeof MergeTaskSchema>

export async function runMindmapWorkflow(
  config: AnthropicLabConfig,
  dependencies: WorkflowDependencies = {},
): Promise<MindmapWorkflowResult> {
  const runtime = createRuntime(config, dependencies)
  const graph = buildMindmapWorkflowWithRuntime(runtime).compile()

  await runtime.logger.info('workflow 启动')

  try {
    const result = await graph.invoke({}, { recursionLimit: 1000 })
    await runtime.logger.flush()

    if (!result.artifacts) {
      throw new Error('workflow 结束但未生成输出文件')
    }
    if (!result.document) {
      throw new Error('workflow 结束但缺少文档信息')
    }

    return {
      yamlPath: result.artifacts.yamlPath,
      logPath: result.artifacts.logPath,
      documentTitle: result.document.title,
      pageCount: result.document.totalPages,
      leafChunkCount: result.metrics.leafChunkCount,
      mergeRounds: result.mergeRound,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await runtime.logger.error(`workflow 失败：${message}`)
    await runtime.logger.flush()
    throw error
  }
}

function buildMindmapWorkflowWithRuntime(
  runtime: WorkflowRuntime,
) {
  const leafAgent = new LeafExtractAgent(runtime.model, runtime.logger)
  const mergeAgent = new MergeAgent(runtime.model, runtime.logger)

  const graph = new StateGraph(WorkflowState)
    .addNode('prepare_document', async () => prepareDocument(runtime))
    .addNode('dispatch_leaf_batch', async (state: WorkflowStateType) =>
      dispatchLeafBatch(state, runtime),
    )
    .addNode('leaf_extract', async (state: LeafTask) => {
      const results = await leafAgent.invoke(state)
      return {
        leafResults: results.map((result) => ({
          chunkIndex: result.chunkIndex,
          chunkId: result.chunkId,
          tree: result.tree,
        })),
        metrics: {
          leafChunkCount: 0,
          leafSuccessCount: results.filter((result) => result.ok).length,
          leafFailureCount: results.filter((result) => !result.ok).length,
          mergeCallCount: 0,
        },
        ...(results.some((result) => result.error)
          ? { errors: results.flatMap((result) => result.error ? [result.error] : []) }
          : {}),
      }
    })
    .addNode('collect_leaf_results', async (state: WorkflowStateType) =>
      collectLeafResults(state, runtime),
    )
    .addNode('dispatch_merge_batch', async (state: WorkflowStateType) =>
      dispatchMergeBatch(state, runtime),
    )
    .addNode('merge_trees', async (state: MergeTask) => {
      const result = await mergeAgent.invoke(state)
      return {
        mergeResults: [{ groupIndex: result.groupIndex, tree: result.tree }],
        metrics: {
          leafChunkCount: 0,
          leafSuccessCount: 0,
          leafFailureCount: 0,
          mergeCallCount: 1,
        },
        ...(result.error ? { errors: [result.error] } : {}),
      }
    })
    .addNode('collect_merge_results', async (state: WorkflowStateType) =>
      collectMergeResults(state, runtime),
    )
    .addNode('finalize_yaml', async (state: WorkflowStateType) =>
      finalizeYaml(state, runtime),
    )

  graph.addEdge(START, 'prepare_document')
  graph.addEdge('prepare_document', 'dispatch_leaf_batch')
  graph.addConditionalEdges('dispatch_leaf_batch', (state) =>
    routeLeafBatch(state, runtime.config.leafChunkGroupSize),
  )
  graph.addEdge('leaf_extract', 'collect_leaf_results')
  graph.addConditionalEdges('collect_leaf_results', (state) =>
    routeAfterLeafCollection(state),
  )
  graph.addConditionalEdges('dispatch_merge_batch', (state) =>
    routeMergeBatch(state),
  )
  graph.addEdge('merge_trees', 'collect_merge_results')
  graph.addConditionalEdges('collect_merge_results', (state) =>
    routeAfterMergeCollection(state),
  )
  graph.addEdge('finalize_yaml', END)

  return graph
}

async function prepareDocument(
  runtime: WorkflowRuntime,
): Promise<Partial<WorkflowStateType>> {
  await runtime.logger.info(`prepare: 读取 PDF ${runtime.config.pdfPath}`)
  const pages = await runtime.pdfLoader(runtime.config.pdfPath)
  const totalChars = pages.reduce((sum, page) => sum + page.text.length, 0)
  let chunks = chunkPdfPages(pages, runtime.config.chunkCharLimit)

  if (runtime.config.maxChunks < chunks.length) {
    await runtime.logger.info(
      `prepare: maxChunks=${runtime.config.maxChunks}，截断 ${chunks.length} -> ${runtime.config.maxChunks} 个 chunk`,
    )
    chunks = chunks.slice(0, runtime.config.maxChunks)
  }
  const document: DocumentMeta = {
    pdfPath: runtime.config.pdfPath,
    title: path.basename(runtime.config.pdfPath, path.extname(runtime.config.pdfPath)),
    totalPages: pages.length,
    totalChars,
  }

  await runtime.logger.info(
    `prepare: 共 ${pages.length} 页，${totalChars} chars，切分为 ${chunks.length} 个 chunk`,
  )

  return {
    document,
    chunks,
    leafCursor: 0,
    pendingLeafRange: null,
    metrics: {
      leafChunkCount: chunks.length,
      leafSuccessCount: 0,
      leafFailureCount: 0,
      mergeCallCount: 0,
    },
    artifacts: runtime.artifacts,
    logs: [{
      timestamp: runtime.now().toISOString(),
      level: 'info',
      message: `prepared ${chunks.length} chunks`,
    }],
  }
}

async function dispatchLeafBatch(
  state: WorkflowStateType,
  runtime: WorkflowRuntime,
): Promise<Partial<WorkflowStateType>> {
  const start = state.leafCursor
  const batchChunkCount = runtime.config.concurrency * runtime.config.leafChunkGroupSize
  const end = Math.min(start + batchChunkCount, state.chunks.length)
  const pendingLeafRange = start < end ? { start, end } : null

  if (pendingLeafRange) {
    await runtime.logger.info(
      `dispatch leaf: 发送 chunk ${start + 1}-${end} / ${state.chunks.length}`,
    )
  }

  return { pendingLeafRange }
}

function routeLeafBatch(
  state: WorkflowStateType,
  leafChunkGroupSize: number,
): Array<Send<'leaf_extract', LeafTask>> {
  const range = state.pendingLeafRange
  const document = state.document

  if (!range || !document) {
    return []
  }

  const sends: Array<Send<'leaf_extract', LeafTask>> = []
  const batchSize = Math.max(1, leafChunkGroupSize)
  const batchChunks = state.chunks.slice(range.start, range.end)

  for (let index = 0; index < batchChunks.length; index += batchSize) {
    sends.push(
      new Send('leaf_extract', {
        chunks: batchChunks.slice(index, index + batchSize),
        document,
      }),
    )
  }

  return sends
}

async function collectLeafResults(
  state: WorkflowStateType,
  runtime: WorkflowRuntime,
): Promise<Partial<WorkflowStateType>> {
  const range = state.pendingLeafRange
  if (!range) {
    return {}
  }

  const leafCursor = range.end
  const remaining = leafCursor < state.chunks.length

  await runtime.logger.info(
    `collect leaf: 已完成 ${leafCursor}/${state.chunks.length} 个 chunk`,
  )

  if (remaining) {
    return {
      leafCursor,
      pendingLeafRange: null,
    }
  }

  await runtime.logger.info(
    `collect leaf: 叶子阶段完成，共得到 ${state.leafResults.length} 棵局部树`,
  )

  return {
    leafCursor,
    pendingLeafRange: null,
    mergeInputs: state.leafResults.map((item) => item.tree),
    mergeResults: overwriteArray<MergeTreeResult>([]),
  }
}

function routeAfterLeafCollection(
  state: WorkflowStateType,
): 'dispatch_leaf_batch' | 'dispatch_merge_batch' | typeof END {
  if (state.leafCursor < state.chunks.length) {
    return 'dispatch_leaf_batch'
  }
  if (state.mergeInputs.length > 0) {
    return 'dispatch_merge_batch'
  }
  return END
}

async function dispatchMergeBatch(
  state: WorkflowStateType,
  runtime: WorkflowRuntime,
): Promise<Partial<WorkflowStateType>> {
  const groups = groupTrees(state.mergeInputs, runtime.config.mergeBatchSize)

  await runtime.logger.info(
    `dispatch merge: 第 ${state.mergeRound + 1} 轮，${state.mergeInputs.length} 棵树 -> ${groups.length} 组`,
  )

  return {
    pendingMergeGroups: groups,
    mergeResults: overwriteArray<MergeTreeResult>([]),
  }
}

function routeMergeBatch(
  state: WorkflowStateType,
): Array<Send<'merge_trees', MergeTask>> {
  const document = state.document
  if (!document) {
    return []
  }
  return state.pendingMergeGroups.map((group) => new Send('merge_trees', {
    group,
    round: state.mergeRound + 1,
    document,
  }))
}

async function collectMergeResults(
  state: WorkflowStateType,
  runtime: WorkflowRuntime,
): Promise<Partial<WorkflowStateType>> {
  const completedRound = state.mergeRound + 1

  await runtime.logger.info(
    `collect merge: 第 ${completedRound} 轮完成，得到 ${state.mergeResults.length} 棵树`,
  )

  if (state.mergeResults.length === 1) {
    return {
      mergeRound: completedRound,
      pendingMergeGroups: [],
      mergeInputs: [],
      finalTree: state.mergeResults[0]?.tree ?? null,
    }
  }

  return {
    mergeRound: completedRound,
    pendingMergeGroups: [],
    mergeInputs: state.mergeResults.map((item) => item.tree),
    mergeResults: overwriteArray<MergeTreeResult>([]),
  }
}

function routeAfterMergeCollection(
  state: WorkflowStateType,
): 'dispatch_merge_batch' | 'finalize_yaml' | typeof END {
  if (state.finalTree) {
    return 'finalize_yaml'
  }
  if (state.mergeInputs.length > 1) {
    return 'dispatch_merge_batch'
  }
  if (state.mergeInputs.length === 1) {
    return 'finalize_yaml'
  }
  return END
}

async function finalizeYaml(
  state: WorkflowStateType,
  runtime: WorkflowRuntime,
): Promise<Partial<WorkflowStateType>> {
  if (!state.document) {
    throw new Error('finalize 缺少 document')
  }

  const finalTree = state.finalTree
    ?? state.mergeInputs[0]
    ?? createEmptyMindmapNode(state.document)

  const yaml = serializeMindmapYaml(state.document, finalTree, runtime.now())
  await fs.mkdir(runtime.config.outputDir, { recursive: true })
  await fs.writeFile(runtime.artifacts.yamlPath, yaml, 'utf-8')
  await runtime.logger.info(`finalize: YAML 已写入 ${runtime.artifacts.yamlPath}`)

  return {
    artifacts: runtime.artifacts,
    finalTree,
  }
}

export const __test__ = {
  routeLeafBatch: (
    state: WorkflowStateType,
    leafChunkGroupSize = 1,
  ) => routeLeafBatch(state, leafChunkGroupSize),
  routeMergeBatch,
  sortLeafResults,
  sortMergeResults,
  groupTrees,
  fallbackLeafNode,
  fallbackMergeNode,
  derivePageRange,
}
