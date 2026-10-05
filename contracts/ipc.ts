/**
 * IPC payload shapes: the boundary DTOs both processes use, plus the stream
 * event vocabulary. The bridge declaration (`MindLaneBridge`) stays in
 * `electron/ipc.ts`; this module is the leaf the renderer can import without
 * reaching into the main process.
 */

import type { ChatToolCall, DocumentRef } from './fileFormat.js'
import type { PalaceRunPayload } from './palace.js'

export interface ContextNodeInfo {
  id: string
  type: 'text' | 'palace'
  label: string
  /** Root chain (root → … → this node; used by compact turn state) */
  chain?: string[]
  /** Direct children (compact subtree, depth 1) */
  children?: ContextNodeInfo[]
  extra?: Record<string, unknown>
}

export interface WorkspaceFileInfo {
  name: string
  filePath: string
}

export interface ChatContext {
  fileUuid: string
  selectedNodes?: ContextNodeInfo[]
  filePath?: string
  fileTitle?: string
  hasDocumentOpen?: boolean
  workspacePath?: string
  workspaceFiles?: WorkspaceFileInfo[]
  attachedDocument?: DocumentRef
  linkedDocuments?: DocumentRef[]
}

/** Mindmap read query parameters (PRD 6.2: tree query, not row addressing). */
export interface MindmapReadQuery {
  scope?: 'whole' | 'subtree'
  subtreeId?: string
  type?: string
  textContains?: string
  maxDepth?: number
}

/** Main process → renderer: on-demand mindmap read request (requestId correlates concurrent runners). */
export interface MindmapReadRequest {
  requestId: string
  fileUuid: string
  query?: MindmapReadQuery
}

/** Renderer → main process: mindmap read response. */
export type MindmapReadResponse =
  { requestId: string; ok: true; summary: string } | { requestId: string; ok: false; error: string }

/** Argument shape of each write action (the IPC boundary stays Record<string,unknown>; the renderer parses per this shape). */
export interface WriteActionArgs {
  insertXmlFragment: {
    xml: string
    parentId?: string
    position?: 'root' | 'child' | 'after' | 'before'
  }
  updateMindmapNode: { xml: string }
  moveMindmapNode: { nodeId: string; targetId?: string; position?: 'child' | 'after' | 'before' }
  deleteNode: { nodeId: string; confirmDeleteSubtree?: boolean }
  /**
   * Palace landing (CONTEXT.md "deterministic landing"): code serializes the subgraph
   * payload to a palace XML fragment and both trigger surfaces land through
   * this one action — the model never repeats the image data URL.
   */
  landPalace: { xml: string }
}

/** Write action name = key of the argument-shape map (the action list and argument shapes are declared in one place, no hand-copied vocabulary). */
export type WriteAction = keyof WriteActionArgs

/** Main process → renderer: persist request (requestId-correlated, reusing the mindmap-read channel pattern). */
export interface MindmapWriteRequest {
  requestId: string
  fileUuid: string
  action: WriteAction
  args: Record<string, unknown>
}

/** Renderer → main process: persist response ({ok, action, data} or error; an unknown requestId is a no-op). */
export type MindmapWriteResponse =
  | { requestId: string; ok: true; action: string; data: unknown }
  | { requestId: string; ok: false; error: string }
/** Steps the main process may emit as `step` events: mindmap subgraph + palace subgraph. */
const STREAM_STEPS = [
  'generating-map',
  'reading-doc',
  'extracting',
  'merging',
  'finalizing',
  'planning-stations',
  'generating-image',
  'locating-stations',
] as const
export type StreamStep = (typeof STREAM_STEPS)[number]

/**
 * Steps a subgraph node may emit: `generating-map` is triggered by tool events
 * (insertXmlFragment / generateMindmapFragment on_tool_start), never by a node.
 * Shared by the mindmap and palace subgraphs so both speak one stage vocabulary.
 */
export type SubgraphProgressStep = Exclude<StreamStep, 'generating-map'>

/**
 * Custom progress event a subgraph writes via `getWriter()`; streamManager
 * forwards it as a `step` stream event. One channel, shared by both subgraphs.
 */
export const SUBGRAPH_PROGRESS_EVENT = 'subgraph-progress'

export function isStreamStep(value: unknown): value is StreamStep {
  return typeof value === 'string' && STREAM_STEPS.some((step) => step === value)
}

export interface StreamResponse {
  content: string
  messages?: Array<{ role: 'assistant'; content: string; toolCalls?: ChatToolCall[] }>
  toolCalls?: ChatToolCall[]
  /** Palace run outcome: a manual run's node settles on it (the landing itself happened already). */
  palaceData?: PalaceRunPayload
}

/**
 * `step` event payload: the stage name, the id of the subgraph call that emitted
 * it (two subgraphs can run in parallel, so the card is attributed by this id),
 * and optional progress counts (streamManager must pass the counts through).
 */
export interface StreamStepPayload {
  step: StreamStep
  callId?: string
  completed?: number
  total?: number
}

export type ChatStreamEvent =
  | { streamId: string; sessionId: string; type: 'message-start'; payload: null }
  | { streamId: string; sessionId: string; type: 'token'; payload: string }
  | { streamId: string; sessionId: string; type: 'step'; payload: StreamStepPayload }
  | {
      streamId: string
      sessionId: string
      type: 'tool-start'
      payload: { id: string; name: string; input: Record<string, unknown> }
    }
  | {
      streamId: string
      sessionId: string
      type: 'tool-end'
      payload: { id: string; name: string; status: 'success' | 'error'; output: string }
    }
  | { streamId: string; sessionId: string; type: 'end'; payload: StreamResponse }
  | { streamId: string; sessionId: string; type: 'error'; payload: string }

/**
 * Ephemeral run marker (CONTEXT.md "ephemeral run"): the manual palace generation.
 * The run lives on a private checkpoint thread, writes no session record and
 * still emits stream events; `runEntry` picks the graph's edge out of START.
 */
export interface EphemeralRunRequest {
  /** Resume by re-running with the same id and empty input; never a session id. */
  privateThreadId: string
  runEntry: 'palace'
  /**
   * Continue the private thread instead of starting it: when the thread still
   * has a pending super-step (a stopped run), the graph is driven with no new
   * input, so completed super-steps are not re-run. Without a pending task (a
   * finished run, e.g. one that ended in an error payload) the run falls back
   * to a normal start on the same thread.
   */
  resume?: boolean
}
