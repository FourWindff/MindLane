/**
 * Turn-state contract: one serialization/stripping implementation shared by the
 * main process (persistence, rolling summaries, memory extraction) and the
 * renderer (display, compaction), so the two sides cannot drift.
 */

import type { ChatContext } from './ipc.js'

// ---- Turn state contract ----
// Single serialization and stripping implementation: persistence in the main
// process, UI display, rolling summaries and memory extraction share one copy of
// the code, so the four consumers cannot drift.

/** Root tag name of the turn-state XML block. */
export const EDITOR_STATE_TAG = 'EDITOR_STATE'

/** XML attribute-value escaping: `<` `>` `&` `"` cannot break the structure. */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Serialize `ChatContext` into an `<EDITOR_STATE>` XML block (turn state).
 *
 * Structure: the root tag carries file identity attributes (file_uuid /
 * file_path / file_title); `<SELECTED_NODES count>` is always emitted (empty
 * selection → count="0" and no children); `<ATTACHED_DOCUMENT>` /
 * `<LINKED_DOCUMENTS>` are emitted only when present. No mindmap tree summary is
 * included — the model calls the `readMindmap` tool when it needs the full tree.
 */
export function serializeTurnState(context: ChatContext): string {
  let xml = `<${EDITOR_STATE_TAG} file_uuid="${xmlEscape(context.fileUuid)}" file_path="${xmlEscape(context.filePath ?? '')}" file_title="${xmlEscape(context.fileTitle ?? '')}">
`

  const selectedNodes = context.selectedNodes ?? []
  xml += `<SELECTED_NODES count="${selectedNodes.length}">
`
  for (const node of selectedNodes) {
    // Protocol XML shape: id/type/content/collapsed; compact mode adds the root chain + direct subtree
    const collapsed =
      (node as { collapsed?: boolean }).collapsed === true ? ' collapsed="true"' : ''
    const chain =
      node.chain && node.chain.length > 1 ? ` chain="${node.chain.map(xmlEscape).join(',')}"` : ''
    const children =
      (node as { children?: Array<{ id: string; type: string; label?: string }> }).children ?? []
    if (children.length === 0) {
      xml += `  <node id="${xmlEscape(node.id)}" type="${xmlEscape(node.type)}" content="${xmlEscape(node.label || '')}"${collapsed}${chain}/>
`
    } else {
      xml += `  <node id="${xmlEscape(node.id)}" type="${xmlEscape(node.type)}" content="${xmlEscape(node.label || '')}"${collapsed}${chain}>
`
      for (const child of children) {
        xml += `    <node id="${xmlEscape(child.id)}" type="${xmlEscape(child.type)}" content="${xmlEscape(child.label || '')}"/>
`
      }
      xml += `  </node>
`
    }
  }
  xml += `</SELECTED_NODES>
`

  if (context.attachedDocument) {
    const doc = context.attachedDocument
    xml += `<ATTACHED_DOCUMENT type="${xmlEscape(doc.type)}" filename="${xmlEscape(doc.filename)}" path="${xmlEscape(doc.source)}">
The user attached the document "${xmlEscape(doc.filename)}"; generate a mindmap based on this document.
</ATTACHED_DOCUMENT>
`
  }

  if (context.linkedDocuments && context.linkedDocuments.length > 0) {
    xml += `<LINKED_DOCUMENTS count="${context.linkedDocuments.length}">
`
    for (const doc of context.linkedDocuments) {
      xml += `  <document id="${xmlEscape(doc.id)}" type="${xmlEscape(doc.type)}" filename="${xmlEscape(doc.filename)}" text_cache_key="${xmlEscape(doc.id)}"/>
`
    }
    xml += `</LINKED_DOCUMENTS>
`
  }

  xml += `</${EDITOR_STATE_TAG}>`
  return xml
}

/**
 * Strip the trailing `<EDITOR_STATE>` block from message text (shared by
 * display, rolling summaries and memory extraction).
 *
 * End-anchored: only a complete **trailing** block is stripped (including the
 * newline separator before it); with no block it is a no-op and content in the
 * middle is never touched. Old session messages have no block → returned as-is.
 */
export function stripTurnState(text: string): string {
  const closeTag = `</${EDITOR_STATE_TAG}>`
  const closeIndex = text.lastIndexOf(closeTag)
  if (closeIndex < 0) return text
  // The block must end the text (trailing whitespace allowed); otherwise it is ordinary content.
  if (text.slice(closeIndex + closeTag.length).trim() !== '') return text

  const openTag = `<${EDITOR_STATE_TAG}`
  const openIndex = text.lastIndexOf(openTag, closeIndex)
  if (openIndex < 0) return text
  // Guard against stripping a tag that merely shares the prefix, e.g. `<EDITOR_STATE_EXTRA>`.
  const afterOpen = text[openIndex + openTag.length]
  if (afterOpen !== ' ' && afterOpen !== '>' && afterOpen !== '\n') return text

  // Strip everything from the open tag to the end, and drop the newline separator before it.
  return text.slice(0, openIndex).replace(/\r?\n+$/, '')
}

/**
 * One implementation of "current turn" slicing, shared across processes.
 * Boundary = the last message with `type === 'human' || role === 'user'`;
 * `previous` includes the boundary message, `current` does not; with no
 * boundary, `previous` = all and `current` = empty. Both message models
 * (`BaseMessage.type` and `ChatMessage.role`) share this one semantic.
 */
export function splitCurrentTurn<T extends { type?: string; role?: string }>(
  messages: readonly T[],
): { previous: T[]; current: T[] } {
  const boundaryIndex = messages.findLastIndex(
    (message) => message.type === 'human' || message.role === 'user',
  )
  if (boundaryIndex < 0) return { previous: [...messages], current: [] }
  return {
    previous: messages.slice(0, boundaryIndex + 1),
    current: messages.slice(boundaryIndex + 1),
  }
}
