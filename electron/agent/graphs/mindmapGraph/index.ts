import { StateGraph, START, END, Send, getWriter } from '@langchain/langgraph'
import type { LLMProvider } from '../../providers/index.js'
import { MindmapSubgraphState } from '../../state.js'
import { extractTextContent, formatAgentError } from '../../utils.js'
import {
  parseOutlineXml,
  serializeOutlineXml,
  serializeStorageFragment,
  type MindmapOutlineNode,
} from '../../utils/mindmapOutline.js'
import {
  createDefaultLoaders,
  computeBudgetChars,
  prepareDocument,
  type DocumentLoaderRegistry,
} from '../../document/index.js'
import { MindmapInputResolver } from './inputResolver.js'
import { logger } from '../../../shared/logger.js'
import { currentStreamId } from '../../../shared/runContext.js'
import { takeModelCallCount } from '../../providers/metering.js'
import type { StreamStep } from '../../../ipc.js'

const log = logger.withContext('mindmap')

// ===== 配置选项 =====

interface MindmapSubgraphOptions {
  provider: LLMProvider
  userDataPath?: string
  loaders?: DocumentLoaderRegistry
}

const MERGE_GROUP_SIZE = 8
const XML_GENERATION_ATTEMPTS = 3
/** Wave width: max parallel leaf/merge branches per super-step (ADR-0008). */
const EXTRACT_CONCURRENCY = 4

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

function countTreeNodes(node: MindmapOutlineNode): number {
  return 1 + node.children.reduce((sum: number, child) => sum + countTreeNodes(child), 0)
}

type PromptMessage = { role: string; content: string }

/** 导图进度词表是共享 StreamStep 的子集（不含 generating-map，它由工具事件触发）。 */
type MindmapProgressStep = Exclude<StreamStep, 'generating-map'>

function emitProgress(step: MindmapProgressStep): void {
  getWriter()?.({ type: 'mindmap-progress', step })
}

/**
 * Per-run, per-phase completion counters keyed by streamId. Parallel Send
 * branches can't see each other's results, so the "completed" count lives
 * here; increment order = actual completion order (single-threaded JS).
 * Reset at run start and at each merge round; consumed by build_output.
 */
const itemProgressCounts = new Map<string, number>()

function resetItemProgress(): void {
  itemProgressCounts.delete(runKey())
}

/** Count one finished branch item and emit its quantified progress event. */
function takeItemProgress(step: MindmapProgressStep, total: number): number {
  const key = runKey()
  const completed = (itemProgressCounts.get(key) ?? 0) + 1
  itemProgressCounts.set(key, completed)
  getWriter()?.({ type: 'mindmap-progress', step, completed, total })
  return completed
}

function createMindmapRunReset(): typeof MindmapSubgraphState.Update {
  return {
    response: '',
    error: '',
    mindmapXml: '',
    mindmapTitle: '',
    documentBatches: [],
    batchIndex: -1,
    leafResults: null,
    mergeInputs: [],
    mergeGroup: null,
    mergeResults: null,
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
Output only XML. Do not include JSON, YAML, Markdown, or explanations.
Use nested <node> elements: element text carries the label, zero attributes, no ids.
Keep 2-3 levels deep, max 8 children per node.

Example output format:
<node>Root Topic
  <node>Section A
    <node>Point 1</node>
    <node>Point 2</node>
  </node>
  <node>Section B
    <node>Point 3</node>
  </node>
</node>`,
    },
    {
      role: 'user',
      content: `Extract a mindmap outline from the following text:\n\n${chunksText}`,
    },
  ]
}

function buildMergePrompt(treesXml: string): PromptMessage[] {
  return [
    {
      role: 'system',
      content: `You are a knowledge structure merging assistant.
Merge multiple XML mindmap trees into one coherent, unified tree.
Output only XML. Do not include JSON, YAML, Markdown, or explanations.
Use nested <node> elements: element text carries the label, zero attributes, no ids.
Keep 2-3 levels deep, max 8 children per node.
Remove duplicates and combine related topics.`,
    },
    {
      role: 'user',
      content: `Merge the following XML trees into one unified tree:\n\n${treesXml}`,
    },
  ]
}

async function generateValidMindmapXml(
  provider: LLMProvider,
  initialMessages: PromptMessage[],
  fallbackTitle: string,
): Promise<{ tree: MindmapOutlineNode; attempts: number }> {
  let messages = initialMessages
  let lastReason = 'XML 校验失败'

  for (let attempt = 1; attempt <= XML_GENERATION_ATTEMPTS; attempt += 1) {
    const response = await provider.model.invoke(messages)
    const content = extractTextContent(response.content)
    const validation = parseOutlineXml(content, fallbackTitle)

    if (validation.ok) {
      return { tree: validation.tree, attempts: attempt }
    }

    lastReason = validation.reason
    log.warn(
      'XML 校验失败（attempt %d/%d，%s）：%s',
      attempt,
      XML_GENERATION_ATTEMPTS,
      fallbackTitle,
      lastReason,
    )
    messages = buildXmlRepairPrompt(initialMessages, content, lastReason)
  }

  log.error('XML 校验连续 %d 次失败（%s）：%s', XML_GENERATION_ATTEMPTS, fallbackTitle, lastReason)
  throw new Error(`XML 校验失败：${lastReason}`)
}

function buildXmlRepairPrompt(
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
      content: `上一次输出的 XML 无效，原因：${reason}

请根据原始任务重新生成完整的 outline XML。
只输出 XML，不要 JSON，不要 YAML，不要 Markdown 解释，不要额外前后缀。
使用 <node> 嵌套表达层级：<node>节点内容</node>，子节点嵌套在父节点内部。
所有 <node> 标签必须配对闭合；文本中的 & < > 需转义为 &amp; &lt; &gt;；标签上不要写任何属性。`,
    },
  ]
}

// ===== Node implementations =====

async function resolveInputNode(
  state: typeof MindmapSubgraphState.State,
): Promise<typeof MindmapSubgraphState.Update> {
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
  resetItemProgress()
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
): Promise<typeof MindmapSubgraphState.Update> {
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
    // Document ingestion pipeline: load → split → batch + DocumentRef assembly
    const budgetChars = computeBudgetChars(options.provider.contextWindow)
    const { batches, documentRef } = await prepareDocument({
      source,
      loaders: { ...createDefaultLoaders(), ...options.loaders },
      budgetChars,
      userDataPath: options.userDataPath,
      existingRef: state.documentRef ?? undefined,
    })

    if (batches.length === 0) {
      return {
        ...reset,
        error: '文档未能提取出任何文本内容。',
        response: '文档未能提取出任何文本内容。',
      }
    }

    log.info(
      '文档管线： source=%s, batches=%d, budget=%d 字符',
      source.type,
      batches.length,
      budgetChars,
    )

    // Phase-start event so the first (possibly long) extraction doesn't look
    // like the run is still stuck reading the document.
    emitProgress('extracting')
    return {
      ...reset,
      documentBatches: batches,
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

/**
 * Leaf branch: invoked via Send with `batchIndex` as its input carrier.
 * Appends its tree to `leafResults`; completion order does not matter —
 * start_merge_round sorts by batchIndex before merging.
 */
async function leafExtractNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<typeof MindmapSubgraphState.Update> {
  const batchIndex = state.batchIndex
  const batch = state.documentBatches[batchIndex]
  if (!batch) {
    return {}
  }

  const total = state.documentBatches.length
  const chunksText = batch.map((doc) => doc.pageContent).join('\n\n---\n\n')
  const batchStart = Date.now()

  try {
    const { tree, attempts } = await generateValidMindmapXml(
      options.provider,
      buildLeafExtractPrompt(chunksText),
      `Batch ${batchIndex + 1}`,
    )

    const completed = takeItemProgress('extracting', total)
    const branches = (tree as { children?: unknown[] }).children?.length ?? 0
    log.info(
      'batch-%d 完成，第 %d/%d 个, 提取 %d 分支, %ss, 重试 %d 次',
      batchIndex + 1,
      completed,
      total,
      branches,
      ((Date.now() - batchStart) / 1000).toFixed(1),
      attempts - 1,
    )

    return {
      leafResults: [
        {
          batchIndex,
          batchId: `batch-${batchIndex + 1}`,
          tree,
        },
      ],
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    log.error('batch-%d 提取失败： %s', batchIndex + 1, formatted.split('\n')[0])
    return {
      error: formatted,
      response: `提取结构失败：${formatted.split('\n')[0]}`,
    }
  }
}

/** Barrier node: runs once per leaf wave after all branches of the wave land. */
async function leafGateNode(): Promise<typeof MindmapSubgraphState.Update> {
  return {}
}

/** Single-leaf shortcut: the only tree becomes finalTree, skipping merge. */
async function finalizeSingleLeafNode(
  state: typeof MindmapSubgraphState.State,
): Promise<typeof MindmapSubgraphState.Update> {
  return { finalTree: state.leafResults[0]?.tree ?? null }
}

/**
 * Start one merge round: snapshot the round's input trees (document order for
 * round 1, group order for later rounds) into `mergeInputs` and clear
 * `mergeResults` so this round's branches append into a fresh list.
 */
async function startMergeRoundNode(
  state: typeof MindmapSubgraphState.State,
): Promise<typeof MindmapSubgraphState.Update> {
  const trees =
    state.mergeInputs.length === 0
      ? [...state.leafResults].sort((a, b) => a.batchIndex - b.batchIndex).map((r) => r.tree)
      : [...state.mergeResults].sort((a, b) => a.groupIndex - b.groupIndex).map((r) => r.tree)

  resetItemProgress()
  emitProgress('merging')
  return {
    mergeInputs: trees,
    mergeResults: null,
  }
}

/**
 * Merge branch: invoked via Send with `mergeGroup` (one group of trees) as its
 * input carrier. Appends the merged tree to `mergeResults`.
 */
async function mergeTreesNode(
  state: typeof MindmapSubgraphState.State,
  options: MindmapSubgraphOptions,
): Promise<typeof MindmapSubgraphState.Update> {
  const group = state.mergeGroup
  if (!group || group.trees.length === 0) {
    return {}
  }

  const totalGroups = group.groupCount
  const treesXml = group.trees
    .map((tree, i) => `--- Tree ${i + 1} ---\n${serializeOutlineXml(tree)}`)
    .join('\n\n')

  try {
    const groupStart = Date.now()
    const { tree, attempts } = await generateValidMindmapXml(
      options.provider,
      buildMergePrompt(treesXml),
      `Merged Tree ${group.groupIndex + 1}`,
    )

    const completed = takeItemProgress('merging', totalGroups)
    log.info(
      'merge group-%d 完成，第 %d/%d 个, 合并 %d 棵树, %ss, 重试 %d 次',
      group.groupIndex + 1,
      completed,
      totalGroups,
      group.trees.length,
      ((Date.now() - groupStart) / 1000).toFixed(1),
      attempts - 1,
    )

    return {
      mergeResults: [{ groupIndex: group.groupIndex, tree }],
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    log.error('merge group-%d 合并失败： %s', group.groupIndex + 1, formatted.split('\n')[0])
    return {
      error: formatted,
      response: `合并结构失败：${formatted.split('\n')[0]}`,
    }
  }
}

/** Barrier node: runs once per merge wave after all branches of the wave land. */
async function mergeGateNode(): Promise<typeof MindmapSubgraphState.Update> {
  return {}
}

/** A converged merge round (exactly one result) yields the final tree. */
async function finalizeMergeNode(
  state: typeof MindmapSubgraphState.State,
): Promise<typeof MindmapSubgraphState.Update> {
  return { finalTree: state.mergeResults[0]?.tree ?? null }
}

async function buildOutputNode(
  state: typeof MindmapSubgraphState.State,
): Promise<typeof MindmapSubgraphState.Update> {
  emitProgress('finalizing')
  // build_output always terminates a run — consume the run start and the item
  // progress counter here so failed runs don't leak entries in either map.
  const runStart = takeRunStart()
  resetItemProgress()
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

  const finalTitle = tree.label.trim() || title

  if (tree.children.length === 0) {
    return {
      error: '未提取到任何要点',
      response: '生成思维导图失败：未提取到任何要点',
    }
  }

  log.info(
    '完成： 总耗时 %ss, 产出 %d 节点, 模型调用 %d 次, title=%s',
    runStart ? ((Date.now() - runStart) / 1000).toFixed(1) : '0',
    countTreeNodes(tree),
    takeModelCallCount(currentStreamId() ?? ''),
    finalTitle,
  )

  return {
    pendingSubgraph: null,
    mindmapXml: serializeStorageFragment(tree),
    mindmapTitle: finalTitle,
    response: `已生成思维导图「${finalTitle}」。`,
  }
}

// ===== Edge routing functions =====

function routeAfterResolveInput(state: typeof MindmapSubgraphState.State): string {
  if (state.error) return 'build_output'
  return 'load_document'
}

/** One wave of leaf Sends: at most EXTRACT_CONCURRENCY branches from `fromIndex`. */
function leafWaveSends(state: typeof MindmapSubgraphState.State, fromIndex: number): Send[] {
  const end = Math.min(fromIndex + EXTRACT_CONCURRENCY, state.documentBatches.length)
  const sends: Send[] = []
  for (let i = fromIndex; i < end; i += 1) {
    // A Send branch sees only its payload (Pregel PUSH input = packet args),
    // so the batches it needs must ride along with the batchIndex carrier.
    sends.push(new Send('leaf_extract', { batchIndex: i, documentBatches: state.documentBatches }))
  }
  return sends
}

/** One wave of merge Sends: at most EXTRACT_CONCURRENCY groups from `fromGroup`. */
function mergeWaveSends(state: typeof MindmapSubgraphState.State, fromGroup: number): Send[] {
  const totalGroups = Math.ceil(state.mergeInputs.length / MERGE_GROUP_SIZE)
  const end = Math.min(fromGroup + EXTRACT_CONCURRENCY, totalGroups)
  const sends: Send[] = []
  for (let groupIndex = fromGroup; groupIndex < end; groupIndex += 1) {
    sends.push(
      new Send('merge_trees', {
        mergeGroup: {
          groupIndex,
          groupCount: totalGroups,
          trees: state.mergeInputs.slice(
            groupIndex * MERGE_GROUP_SIZE,
            (groupIndex + 1) * MERGE_GROUP_SIZE,
          ),
        },
      }),
    )
  }
  return sends
}

function routeAfterLoadDocument(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.error) return 'build_output'
  return leafWaveSends(state, 0)
}

/**
 * Leaf wave barrier routing. Fail-fast: any branch error kills the run and no
 * further waves are dispatched. The next wave starts where the results end —
 * fail-fast guarantees no holes, so leafResults.length is the next index.
 */
function routeAfterLeafGate(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.error) return 'build_output'
  const done = state.leafResults.length
  if (done < state.documentBatches.length) return leafWaveSends(state, done)
  if (done === 1) return 'finalize_single_leaf'
  return 'start_merge_round'
}

function routeAfterStartMergeRound(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.error) return 'build_output'
  return mergeWaveSends(state, 0)
}

/**
 * Merge wave barrier routing: keep waving until the round's groups are done;
 * one result means convergence, more means another round at reduced width.
 */
function routeAfterMergeGate(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.error) return 'build_output'
  const done = state.mergeResults.length
  const totalGroups = Math.ceil(state.mergeInputs.length / MERGE_GROUP_SIZE)
  if (done < totalGroups) return mergeWaveSends(state, done)
  if (done === 1) return 'finalize_merge'
  return 'start_merge_round'
}

// ===== Subgraph 构建器 =====

/**
 * Build the Mindmap Subgraph
 *
 * Flow:
 * START -> resolve_input -> load_document (load → split → batch, precomputed once)
 *   -> [wave of ≤ EXTRACT_CONCURRENCY leaf_extract Sends] -> leaf_gate -> (next wave, or merge)
 *   -> start_merge_round -> [wave of ≤ EXTRACT_CONCURRENCY merge_trees Sends] -> merge_gate
 *   -> (next wave, next round at reduced width, or finalize_merge)
 *   -> build_output -> END
 * A single leaf result skips merge and goes straight to finalize_single_leaf.
 */
export function buildMindmapSubgraph(options: MindmapSubgraphOptions) {
  const graph = new StateGraph(MindmapSubgraphState)
    .addNode('resolve_input', (state) => resolveInputNode(state))
    .addNode('load_document', (state) => loadDocumentNode(state, options))
    .addNode('leaf_extract', (state) => leafExtractNode(state, options))
    .addNode('leaf_gate', () => leafGateNode())
    .addNode('finalize_single_leaf', (state) => finalizeSingleLeafNode(state))
    .addNode('start_merge_round', (state) => startMergeRoundNode(state))
    .addNode('merge_trees', (state) => mergeTreesNode(state, options))
    .addNode('merge_gate', () => mergeGateNode())
    .addNode('finalize_merge', (state) => finalizeMergeNode(state))
    .addNode('build_output', (state) => buildOutputNode(state))

  // START -> resolve_input -> load_document
  graph.addEdge(START, 'resolve_input')
  graph.addConditionalEdges('resolve_input', routeAfterResolveInput, [
    'load_document',
    'build_output',
  ])

  // load_document precomputes batches, then dispatches the first leaf wave
  graph.addConditionalEdges('load_document', routeAfterLoadDocument, [
    'leaf_extract',
    'build_output',
  ])

  graph.addEdge('leaf_extract', 'leaf_gate')
  graph.addConditionalEdges('leaf_gate', routeAfterLeafGate, [
    'leaf_extract',
    'finalize_single_leaf',
    'start_merge_round',
    'build_output',
  ])
  graph.addEdge('finalize_single_leaf', 'build_output')

  graph.addConditionalEdges('start_merge_round', routeAfterStartMergeRound, [
    'merge_trees',
    'build_output',
  ])
  graph.addEdge('merge_trees', 'merge_gate')
  graph.addConditionalEdges('merge_gate', routeAfterMergeGate, [
    'merge_trees',
    'start_merge_round',
    'finalize_merge',
    'build_output',
  ])
  graph.addEdge('finalize_merge', 'build_output')

  // Final output
  graph.addEdge('build_output', END)

  return graph
}
