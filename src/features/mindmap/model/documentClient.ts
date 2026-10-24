/**
 * Renderer half of the document bridge.
 *
 * The renderer never writes the document: it sends intents through this client
 * and applies the versioned states that come back. Every intent is counted so
 * callers that must observe their own write (the AI write responder) can await
 * `whenSettled` instead of racing the round-trip.
 */

import type {
  MindmapDocumentCommandResult,
  MindmapDocumentIntent,
  MindmapDocumentState,
  MindmapNodeSizeUpdate,
} from '@contracts/mindmapDocument/state'
import type { MindmapDocument, MindmapStructureType } from '@contracts/mindmapDocument/types'
import type { MindmapWireCommand } from '@contracts/mindmapDocument/wire'

/** Transport used by the bridge in production and by an in-memory loopback in tests. */
export interface MindmapDocumentTransport {
  send(intent: MindmapDocumentIntent): unknown
  subscribe(listener: (state: MindmapDocumentState) => void): () => void
}

/**
 * Test seam: the loopback transport replaces the bridge transport. Production
 * never calls this, and the fallback is always the real bridge.
 */
let transportOverride: MindmapDocumentTransport | null = null

export function setDocumentTransport(next: MindmapDocumentTransport | null): void {
  transportOverride = next
}

function noopTransport(): MindmapDocumentTransport {
  return {
    send: () => undefined,
    subscribe: () => () => {},
  }
}

export function resolveDocumentTransport(): MindmapDocumentTransport {
  if (transportOverride) return transportOverride
  if (typeof window === 'undefined') return noopTransport()
  const api = window.mindlane?.mindmap
  if (!api) return noopTransport()
  return {
    send: (intent) => api.command(intent),
    subscribe: (listener) => api.onDocumentState(listener),
  }
}

interface PendingWaiter {
  expectedVersion: number
  resolve: () => void
}

export class MindmapDocumentClient {
  private lastVersion = new Map<string, number>()
  private expectedVersion = new Map<string, number>()
  private failures = new Set<string>()
  private waiters = new Map<string, PendingWaiter[]>()
  private unsubscribe: (() => void) | null = null

  constructor(private transport: MindmapDocumentTransport) {}

  /** Subscribe to document states; `onState` sees every state, the store filters by file. */
  subscribe(onState: (state: MindmapDocumentState) => void): () => void {
    this.unsubscribe?.()
    this.unsubscribe = this.transport.subscribe((state) => {
      const previous = this.lastVersion.get(state.fileUuid)
      if (previous === undefined || state.version > previous) {
        this.lastVersion.set(state.fileUuid, state.version)
      }
      onState(state)
      this.settleIfObserved(state.fileUuid)
    })
    return () => {
      this.unsubscribe?.()
      this.unsubscribe = null
    }
  }

  open(fileUuid: string, document: MindmapDocument, structureType: MindmapStructureType): void {
    this.sendPrepared(
      {
        type: 'open',
        fileUuid,
        document,
        structureType,
      },
      false,
    )
  }

  apply(fileUuid: string, commands: MindmapWireCommand[]): void {
    this.sendPrepared({ type: 'apply', fileUuid, commands }, true)
  }

  undo(fileUuid: string): void {
    this.sendPrepared({ type: 'undo', fileUuid }, true)
  }

  redo(fileUuid: string): void {
    this.sendPrepared({ type: 'redo', fileUuid }, true)
  }

  layout(
    fileUuid: string,
    structureType: MindmapStructureType | undefined,
    sizes?: MindmapNodeSizeUpdate[],
  ): void {
    this.sendPrepared({ type: 'layout', fileUuid, structureType, sizes }, false)
  }

  markSaved(fileUuid: string, version: number): void {
    this.sendPrepared({ type: 'markSaved', fileUuid, version }, false)
  }

  reset(fileUuid: string): void {
    this.sendPrepared({ type: 'reset', fileUuid }, true)
  }

  close(fileUuid: string): void {
    this.sendPrepared({ type: 'close', fileUuid }, false)
  }

  /**
   * Resolve once every previously sent intent has been observed (or failed).
   * Used by the write path so a tool's ack never races its own landing.
   */
  whenSettled(fileUuid: string): Promise<void> {
    const expected = this.expectedVersion.get(fileUuid)
    const observed = this.lastVersion.get(fileUuid) ?? -1
    if (expected === undefined || this.failures.has(fileUuid) || observed >= expected) {
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      const list = this.waiters.get(fileUuid) ?? []
      list.push({ expectedVersion: expected, resolve })
      this.waiters.set(fileUuid, list)
    })
  }

  private sendPrepared(intent: MindmapDocumentIntent, expectsVersion: boolean): void {
    if (expectsVersion) {
      const base = Math.max(
        this.expectedVersion.get(intent.fileUuid) ?? -1,
        this.lastVersion.get(intent.fileUuid) ?? -1,
      )
      this.expectedVersion.set(intent.fileUuid, base + 1)
      this.failures.delete(intent.fileUuid)
    }
    let result: unknown
    try {
      result = this.transport.send(intent)
    } catch (error) {
      this.fail(intent.fileUuid, error)
      return
    }
    if (result instanceof Promise) {
      result.then(
        (response) => {
          const failure = readFailure(response)
          if (failure) this.fail(intent.fileUuid, failure)
          else this.settleIfObserved(intent.fileUuid)
        },
        (error: unknown) => this.fail(intent.fileUuid, error),
      )
    }
  }

  private fail(fileUuid: string, error: unknown): void {
    this.failures.add(fileUuid)
    console.warn(
      `[MindLane] mindmap document command failed for ${fileUuid}:`,
      error instanceof Error ? error.message : error,
    )
    this.flushWaiters(fileUuid)
  }

  private settleIfObserved(fileUuid: string): void {
    const expected = this.expectedVersion.get(fileUuid)
    if (expected === undefined) return
    const observed = this.lastVersion.get(fileUuid) ?? -1
    if (observed >= expected) this.flushWaiters(fileUuid)
  }

  private flushWaiters(fileUuid: string): void {
    const list = this.waiters.get(fileUuid)
    if (!list) return
    this.waiters.delete(fileUuid)
    for (const waiter of list) waiter.resolve()
  }
}

/** A failed command coming back over the bridge (result envelope is not a state). */
function readFailure(response: unknown): string | null {
  if (!response || typeof response !== 'object') return null
  const candidate = response as MindmapDocumentCommandResult
  if (candidate.ok === false) return `${candidate.code}: ${candidate.message}`
  return null
}
