/**
 * The write-action vocabulary: the four AI write tools, plus the palace's
 * deterministic landing.
 *
 * Kept in the contracts layer (types only) because the tool layer and the
 * document write service both speak it; the arguments stay `Record<string,
 * unknown>` at the call boundary and each action parses its own shape.
 */

export interface WriteActionArgs {
  insertXmlFragment: {
    xml: string
    /** Anchor node: the parent when position=child, the sibling when position=after/before. */
    targetId?: string
    position?: 'root' | 'child' | 'after' | 'before'
  }
  updateMindmapNode: { xml: string }
  moveMindmapNode: { nodeId: string; targetId?: string; position?: 'child' | 'after' | 'before' }
  deleteMindmapNode: { nodeId: string; confirmDeleteSubtree?: boolean }
  /**
   * Palace landing (CONTEXT.md "deterministic landing"): code serializes the
   * subgraph payload to a palace XML fragment and both trigger surfaces land
   * through this one action — the model never repeats the image data URL.
   */
  landPalace: {
    xml: string
    /** The manual run's placeholder palace: land into it instead of creating a node. */
    placeholderNodeId?: string
  }
}

/** Write action name = key of the argument-shape map (the action list and the shapes live in one place). */
export type WriteAction = keyof WriteActionArgs

/** The result shape every write returns to the model (unchanged across the renderer-proxy era). */
export type MindmapWriteAck =
  { ok: true; action: WriteAction; data: unknown } | { ok: false; error: string }

/**
 * One write executor. The tools and the palace subgraph call it locally: the
 * main-process document write service is the only implementation, so no channel
 * sits between a tool and the document.
 */
export type MindmapWrite = (
  fileUuid: string,
  action: WriteAction,
  args: Record<string, unknown>,
) => Promise<MindmapWriteAck>
