import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import type { BaseMessage } from '@langchain/core/messages'
import type { Document } from '@langchain/core/documents'
import type { ChatToolCallStep, DocumentRef } from '@contracts/fileFormat'
import type { PalaceStationPayload } from '@contracts/palace'
import type { DocumentSource as MindmapInputSource } from './document/index.js'
import type { ChatContext, PalaceArtworkStyle } from '../ipc.js'
import type { MindmapOutlineNode } from './utils/mindmapOutline.js'

export type { DocumentRef }
export type { MindmapInputSource }

/**
 * Run entry: which edge the main graph takes out of START.
 *
 * `palace` is the entry of the manual-palace ephemeral run (straight to the
 * palace subgraph, skipping compaction and the supervisor); plain chat runs
 * are always `chat` (the channel default). ADR-0023 lands the conditional
 * edge that reads this marker.
 */
type RunEntry = 'chat' | 'palace'

/** Plain replace reducer: the new value overwrites the old one. */
function replaceReducer<T>(_prev: T, next: T): T {
  return next
}

/**
 * Fan-in reducer for parallel branches: branch results are appended to the end
 * of the list; writing `null` clears it (used before a new merge round starts
 * and when a run resets).
 */
function appendReducer<T>(current: T[], update: T[] | null): T[] {
  return update === null ? [] : [...current, ...update]
}

// ===== Base type definitions =====

export type SelectedNodeContent = {
  id: string
  label: string
}

export type MemoryItem = {
  order: number
  content: string
}

export type StationDesign = {
  order: number
  content: string
  anchorVisual: string
  mnemonicMethod: string
  association: string
  linkedNodeId?: string
}

type PalaceDesign = {
  theme: string
  sceneBrief?: string
  routeStyle?: string
  stations: StationDesign[]
}

/**
 * Station as the palace run carries it before the layout resolves the anchor visual
 * and the linked node id; `mnemonicMethod` is graph-side only (never landed).
 */
export type MemoryPalaceStation = Omit<PalaceStationPayload, 'anchorVisual' | 'linkedNodeId'> & {
  anchorVisual?: string
  linkedNodeId?: string
  mnemonicMethod?: string
}

type PendingSubgraph = 'mindmap' | 'palace'

// ===== State slice definitions (for composition and reuse) =====

/**
 * Turn channel: the input channel shared by the main graph and both subgraphs.
 *
 * Both subgraphs only **read** context; messages goes through an append
 * reducer, so neither access can overwrite the other.
 */
const TurnAnnotations = {
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  context: Annotation<ChatContext | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
}

/** Main graph only: the supervisor's own reply/error, the rolling summary and the routing key. */
const SupervisorAnnotations = {
  /**
   * Subgraph calls declared this round and still awaiting execution, in
   * declaration order. The supervisor writes it, the conditional edge reads it,
   * subgraph nodes never write it — a leftover value would route the graph back
   * into a subgraph that already ran. A list rather than a single value because
   * one round can declare several.
   */
  pendingSubgraphs: Annotation<PendingSubgraph[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  response: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  error: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  /**
   * Rolling summary: read by the contextCompact node from the session meta's
   * `_lastSummary`; when the supervisor builds the system prompt,
   * `ContextBuilder.withLastSummary` injects it into the `## History Summary`
   * section. Empty string on the non-compaction path (I/O failure fallback).
   */
  summary: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
}

/**
 * Subgraph-owned scalar channels: one set per subgraph, keys prefixed with the
 * subgraph name.
 *
 * These channels must be split by subgraph: they all use replace reducers, and
 * two subgraphs writing the same key in one super-step would **silently**
 * overwrite each other (only channels without a reducer error out loudly).
 * Call info (call id, tool name) is likewise per-graph so close-out never has
 * to guess which subgraph issued it.
 *
 * Both virtual tools have an empty-object schema, so there is no "call input"
 * to keep; add one once a schema grows arguments.
 */
const MindmapScalarAnnotations = {
  mindmapError: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  mindmapResponse: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  mindmapToolCallId: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  mindmapToolName: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
}

const PalaceScalarAnnotations = {
  /** Subgraph phase trace (same source as the step stream events), closed out by the subgraph and returned to the main graph with the subgraph state. */
  palaceToolSteps: Annotation<ChatToolCallStep[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  palaceError: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceResponse: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  /**
   * Result of the landing responder (empty = success): when palace generation
   * succeeded but the write action failed, the subgraph close-out writes it into
   * the ToolMessage and the run's `end` payload, and the renderer marks the
   * placeholder node as pending.
   */
  palaceLandingError: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceToolCallId: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceToolName: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
}

/**
 * Run-level entry channel: main graph only (subgraphs never read the entry).
 * The START conditional edge consumes it; until that edge lands, every run
 * still traverses compaction and the supervisor.
 */
const RunAnnotations = {
  runEntry: Annotation<RunEntry>({
    reducer: replaceReducer,
    default: () => 'chat',
  }),
}

/**
 * Memory palace state slice (private keys: only this graph writes them; the main
 * graph still merges them like any other)
 */
const PalaceStateAnnotations = {
  artworkStyle: Annotation<PalaceArtworkStyle>({
    reducer: replaceReducer,
    default: () => 'vector',
  }),
  palaceInputText: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  palaceInputNodes: Annotation<SelectedNodeContent[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  palace: Annotation<PalaceDesign | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  imageUrls: Annotation<string[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  imageError: Annotation<string | undefined>({
    reducer: replaceReducer,
    default: () => undefined,
  }),
  memoryRoute: Annotation<MemoryPalaceStation[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
}

/**
 * Mindmap state slice
 *
 * Wave concurrency (ADR-0008):
 * - `batchIndex` / `mergeGroup` are the Send branch inputs; each branch reads only its own.
 * - `leafResults` / `mergeResults` fan parallel branch results in with an append reducer;
 *   writing `null` clears them (before a new merge round starts and when a run resets).
 * - `mergeInputs` narrows to "the input tree list of the current merge round", written by the
 *   start_merge_round node so wave routing can read it stably across super-steps.
 */
const MindmapStateAnnotations = {
  mindmapInputSource: Annotation<MindmapInputSource | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  mindmapInputTitle: Annotation<string>({
    reducer: replaceReducer,
    default: () => '',
  }),
  documentBatches: Annotation<Document[][]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  batchIndex: Annotation<number>({
    reducer: replaceReducer,
    default: () => -1,
  }),
  leafResults: Annotation<
    Array<{ batchIndex: number; batchId: string; tree: MindmapOutlineNode }>,
    Array<{ batchIndex: number; batchId: string; tree: MindmapOutlineNode }> | null
  >({
    reducer: appendReducer,
    default: () => [],
  }),
  mergeInputs: Annotation<MindmapOutlineNode[]>({
    reducer: replaceReducer,
    default: () => [],
  }),
  mergeGroup: Annotation<{
    groupIndex: number
    groupCount: number
    trees: MindmapOutlineNode[]
  } | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  mergeResults: Annotation<
    Array<{ groupIndex: number; tree: MindmapOutlineNode }>,
    Array<{ groupIndex: number; tree: MindmapOutlineNode }> | null
  >({
    reducer: appendReducer,
    default: () => [],
  }),
  finalTree: Annotation<MindmapOutlineNode | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
  documentRef: Annotation<DocumentRef | null>({
    reducer: replaceReducer,
    default: () => null,
  }),
}

// ===== Composed state definitions =====

/**
 * Main graph state - used by MindLaneAgent
 *
 * Spreading every slice in (rather than picking a few keys) is deliberate: keys
 * a subgraph writes but the main graph does not declare are **silently
 * dropped**, so this must be the union of both subgraph channels; new subgraph
 * keys are added here and nowhere else.
 */
export const MainGraphState = Annotation.Root({
  ...RunAnnotations,
  ...TurnAnnotations,
  ...SupervisorAnnotations,
  ...MindmapScalarAnnotations,
  ...PalaceScalarAnnotations,
  ...MindmapStateAnnotations,
  ...PalaceStateAnnotations,
})

/**
 * State dedicated to the palace subgraph
 * Contains: turn channel + palace scalar channels + full palace state
 */
export const PalaceSubgraphState = Annotation.Root({
  ...TurnAnnotations,
  ...PalaceScalarAnnotations,
  ...PalaceStateAnnotations,
})

/**
 * State dedicated to the mindmap subgraph
 * Contains: turn channel + mindmap scalar channels + mindmap state
 */
export const MindmapSubgraphState = Annotation.Root({
  ...TurnAnnotations,
  ...MindmapScalarAnnotations,
  ...MindmapStateAnnotations,
})

// ===== Type exports =====

export type MainGraphStateType = typeof MainGraphState.State
export type PalaceSubgraphStateType = typeof PalaceSubgraphState.State
export type MindmapSubgraphStateType = typeof MindmapSubgraphState.State
