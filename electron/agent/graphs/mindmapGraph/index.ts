import { StateGraph, START, END, Send, getWriter } from '@langchain/langgraph'
import { ToolMessage } from '@langchain/core/messages'
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
import { currentStreamId, requireStreamId } from '../../../shared/runContext.js'
import { takeModelCallCount } from '../../providers/metering.js'
import type { ChatToolCallStep } from '../../../../contracts/fileFormat.js'
import { SUBGRAPH_PROGRESS_EVENT, type SubgraphProgressStep } from '../../../ipc.js'
import { buildSubgraphToolMessage } from '../../subgraphRouter.js'

const log = logger.withContext('mindmap')

// ===== Configuration options =====

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

/** Run key for the per-stream bookkeeping maps (see `requireStreamId`). */
function runKey(): string {
  return requireStreamId('mindmap subgraph')
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

/**
 * Subgraph stage trace (same source as step stream events), collected per
 * streamId and closed out by build_output. Same lifecycle as
 * itemProgressCounts: reset at run start, consumed by build_output.
 */
const stepTraces = new Map<string, ChatToolCallStep[]>()

function pushStep(step: ChatToolCallStep): void {
  const key = runKey()
  const trace = stepTraces.get(key) ?? []
  trace.push(step)
  stepTraces.set(key, trace)
}

function takeStepTrace(): ChatToolCallStep[] | undefined {
  const key = runKey()
  const trace = stepTraces.get(key)
  stepTraces.delete(key)
  return trace
}

/**
 * Emit one stage. `callId` is the virtual tool call this run answers: two
 * subgraphs can run in the same super-step, so the stream event (and with it the
 * card the renderer attributes it to) has to name its own call.
 */
function emitProgress(callId: string, step: SubgraphProgressStep): void {
  getWriter()?.({ type: SUBGRAPH_PROGRESS_EVENT, step, callId })
  pushStep({ step })
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
function takeItemProgress(callId: string, step: SubgraphProgressStep, total: number): number {
  const key = runKey()
  const completed = (itemProgressCounts.get(key) ?? 0) + 1
  itemProgressCounts.set(key, completed)
  getWriter()?.({ type: SUBGRAPH_PROGRESS_EVENT, step, callId, completed, total })
  pushStep({ step, completed, total })
  return completed
}

function createMindmapRunReset(): typeof MindmapSubgraphState.Update {
  return {
    mindmapResponse: '',
    mindmapError: '',
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
  let lastReason = 'XML validation failed'

  for (let attempt = 1; attempt <= XML_GENERATION_ATTEMPTS; attempt += 1) {
    const response = await provider.model.invoke(messages)
    const content = extractTextContent(response.content)
    const validation = parseOutlineXml(content, fallbackTitle)

    if (validation.ok) {
      return { tree: validation.tree, attempts: attempt }
    }

    lastReason = validation.reason
    log.warn(
      'XML validation failed (attempt %d/%d, %s): %s',
      attempt,
      XML_GENERATION_ATTEMPTS,
      fallbackTitle,
      lastReason,
    )
    messages = buildXmlRepairPrompt(initialMessages, content, lastReason)
  }

  log.error(
    'XML validation failed %d times in a row (%s): %s',
    XML_GENERATION_ATTEMPTS,
    fallbackTitle,
    lastReason,
  )
  throw new Error(`XML validation failed: ${lastReason}`)
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
      content: `The previous XML output was invalid. Reason: ${reason}

Regenerate the full outline XML for the original task.
Output only XML: no JSON, no YAML, no Markdown explanation, no extra prefix or suffix.
Express hierarchy with nested <node> elements: <node>node content</node>, with child nodes nested inside their parent.
Every <node> tag must be closed; escape & < > in text as &amp; &lt; &gt;; write no attributes on any tag.`,
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
      mindmapError: 'Provide a document or text to generate a mindmap from.',
      mindmapResponse: 'Provide a document or text to generate a mindmap from.',
    }
  }

  runStarts.set(runKey(), Date.now())
  resetItemProgress()
  // A new run starts: clear the previous leftover trace (build_output already
  // consumed it; this is a leak safety net).
  stepTraces.delete(runKey())
  log.info('input: source=%s, title=%s', resolution.source.type, resolution.title)
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
  emitProgress(state.mindmapToolCallId, 'reading-doc')
  const source = state.mindmapInputSource
  const reset = createMindmapRunReset()

  if (!source) {
    return {
      ...reset,
      mindmapError: 'Provide an input source.',
      mindmapResponse: 'Provide an input source.',
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
        mindmapError: 'No text content could be extracted from the document.',
        mindmapResponse: 'No text content could be extracted from the document.',
      }
    }

    log.info(
      'document pipeline: source=%s, batches=%d, budget=%d chars',
      source.type,
      batches.length,
      budgetChars,
    )

    // Phase-start event so the first (possibly long) extraction doesn't look
    // like the run is still stuck reading the document.
    emitProgress(state.mindmapToolCallId, 'extracting')
    return {
      ...reset,
      documentBatches: batches,
      documentRef,
    }
  } catch (error) {
    const formatted = formatAgentError(error)
    log.error('loading the document failed: %s', formatted.split('\n')[0])
    return {
      ...reset,
      mindmapError: formatted,
      mindmapResponse: `Failed to load the document: ${formatted.split('\n')[0]}`,
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

    const completed = takeItemProgress(state.mindmapToolCallId, 'extracting', total)
    const branches = (tree as { children?: unknown[] }).children?.length ?? 0
    log.info(
      'batch-%d finished, %d/%d, %d branches extracted, %ss, %d retries',
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
    log.error('batch-%d extraction failed: %s', batchIndex + 1, formatted.split('\n')[0])
    return {
      mindmapError: formatted,
      mindmapResponse: `Failed to extract the structure: ${formatted.split('\n')[0]}`,
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
  emitProgress(state.mindmapToolCallId, 'merging')
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

    const completed = takeItemProgress(state.mindmapToolCallId, 'merging', totalGroups)
    log.info(
      'merge group-%d finished, %d/%d, %d trees merged, %ss, %d retries',
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
    log.error('merge group-%d failed: %s', group.groupIndex + 1, formatted.split('\n')[0])
    return {
      mindmapError: formatted,
      mindmapResponse: `Failed to merge the structure: ${formatted.split('\n')[0]}`,
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

/**
 * Close out the run: this node owns the subgraph's ToolMessage (call id, tool
 * name, stage trace) — the mindmap side of the graph boundary. No separate
 * collection node in the main graph reads this subgraph's channels anymore.
 */
async function buildOutputNode(
  state: typeof MindmapSubgraphState.State,
): Promise<typeof MindmapSubgraphState.Update> {
  emitProgress(state.mindmapToolCallId, 'finalizing')
  // build_output always terminates a run — consume the run start and the item
  // progress counter here so failed runs don't leak entries in either map.
  const runStart = takeRunStart()
  const toolSteps = takeStepTrace() ?? []
  resetItemProgress()

  const closeOut = (payload: Record<string, unknown>): ToolMessage =>
    buildSubgraphToolMessage({
      subgraph: 'mindmap',
      toolCallId: state.mindmapToolCallId,
      toolName: state.mindmapToolName,
      payload,
      toolSteps,
    })

  // Preserve the error written by an earlier stage of this run.
  if (state.mindmapError) {
    const error = state.mindmapResponse || state.mindmapError
    return { messages: [closeOut({ ok: false, error })] }
  }

  const tree = state.finalTree
  const title = state.mindmapInputTitle || 'Mindmap'

  if (!tree) {
    const response = 'Mindmap generation failed: no valid structure was generated'
    return {
      mindmapError: 'Failed to generate a valid mindmap structure',
      mindmapResponse: response,
      messages: [closeOut({ ok: false, error: response })],
    }
  }

  const finalTitle = tree.label.trim() || title

  if (tree.children.length === 0) {
    const response = 'Mindmap generation failed: no key points were extracted'
    return {
      mindmapError: 'No key points were extracted',
      mindmapResponse: response,
      messages: [closeOut({ ok: false, error: response })],
    }
  }

  log.info(
    'done: %ss total, %d nodes produced, %d model calls, title=%s',
    runStart ? ((Date.now() - runStart) / 1000).toFixed(1) : '0',
    countTreeNodes(tree),
    takeModelCallCount(currentStreamId() ?? ''),
    finalTitle,
  )

  const mindmapXml = serializeStorageFragment(tree)
  return {
    mindmapResponse: `Generated the mindmap "${finalTitle}".`,
    messages: [
      closeOut({
        ok: true,
        title: finalTitle,
        xmlFragment: mindmapXml,
        documentRef: state.documentRef,
      }),
    ],
  }
}

// ===== Edge routing functions =====

function routeAfterResolveInput(state: typeof MindmapSubgraphState.State): string {
  if (state.mindmapError) return 'build_output'
  return 'load_document'
}

/** One wave of leaf Sends: at most EXTRACT_CONCURRENCY branches from `fromIndex`. */
function leafWaveSends(state: typeof MindmapSubgraphState.State, fromIndex: number): Send[] {
  const end = Math.min(fromIndex + EXTRACT_CONCURRENCY, state.documentBatches.length)
  const sends: Send[] = []
  for (let i = fromIndex; i < end; i += 1) {
    // A Send branch sees only its payload (Pregel PUSH input = packet args),
    // so the batches it needs must ride along with the batchIndex carrier —
    // and so must the answering call id, which the branch reports progress on.
    sends.push(
      new Send('leaf_extract', {
        batchIndex: i,
        documentBatches: state.documentBatches,
        mindmapToolCallId: state.mindmapToolCallId,
      }),
    )
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
        mindmapToolCallId: state.mindmapToolCallId,
      }),
    )
  }
  return sends
}

function routeAfterLoadDocument(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.mindmapError) return 'build_output'
  return leafWaveSends(state, 0)
}

/**
 * Leaf wave barrier routing. Fail-fast: any branch error kills the run and no
 * further waves are dispatched. The next wave starts where the results end —
 * fail-fast guarantees no holes, so leafResults.length is the next index.
 */
function routeAfterLeafGate(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.mindmapError) return 'build_output'
  const done = state.leafResults.length
  if (done < state.documentBatches.length) return leafWaveSends(state, done)
  if (done === 1) return 'finalize_single_leaf'
  return 'start_merge_round'
}

function routeAfterStartMergeRound(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.mindmapError) return 'build_output'
  return mergeWaveSends(state, 0)
}

/**
 * Merge wave barrier routing: keep waving until the round's groups are done;
 * one result means convergence, more means another round at reduced width.
 */
function routeAfterMergeGate(state: typeof MindmapSubgraphState.State): string | Send[] {
  if (state.mindmapError) return 'build_output'
  const done = state.mergeResults.length
  const totalGroups = Math.ceil(state.mergeInputs.length / MERGE_GROUP_SIZE)
  if (done < totalGroups) return mergeWaveSends(state, done)
  if (done === 1) return 'finalize_merge'
  return 'start_merge_round'
}

// ===== Subgraph builder =====

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
 *
 * The graph is compiled without a checkpointer and mounted as a node of the
 * main graph: persistence, the recursion budget and the run context all come
 * from the host graph, and build_output writes the ToolMessage the supervisor
 * reads back.
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
    .addNode('build_output', buildOutputNode)

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
