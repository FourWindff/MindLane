import type { MindmapInputSource, MindmapSubgraphStateType } from '../../state.js'
import type { DocumentRef } from '../../state.js'
import { findLatestUserMessageText } from '../../utils.js'

interface MindmapInputResolution {
  /** Resolved input source */
  source: MindmapInputSource
  /** Default title used for generation */
  title: string
}

function resolveAttachedDocument(documentRef: DocumentRef): MindmapInputSource {
  switch (documentRef.type) {
    case 'pdf':
    case 'docx':
    case 'pptx':
    case 'xlsx':
    case 'markdown':
      return { type: documentRef.type, path: documentRef.source }
    case 'url':
      return { type: 'url', url: documentRef.source }
    case 'text':
      return { type: 'text', content: documentRef.source }
    default:
      // Exhaustive fallback; source type mismatch should be caught by analyzer
      return { type: 'text', content: documentRef.source }
  }
}

function resolveTitle(documentRef: DocumentRef | undefined, fileTitle: string | undefined): string {
  return documentRef?.title || documentRef?.filename || fileTitle || ''
}

/**
 * Resolve the input source and title a mindmap generation needs from the
 * subgraph state.
 *
 * Priority:
 * 1. Currently attached document (state.context.attachedDocument)
 * 2. Latest non-empty user message text
 */
export function resolveMindmapInput(
  state: MindmapSubgraphStateType,
): MindmapInputResolution | null {
  const attachedDocument = state.context?.attachedDocument
  const fileTitle = state.context?.fileTitle

  if (attachedDocument) {
    return {
      source: resolveAttachedDocument(attachedDocument),
      title: resolveTitle(attachedDocument, fileTitle),
    }
  }

  // With no new attachment, reuse the input source already in state (e.g. a subgraph retry).
  if (state.mindmapInputSource) {
    return {
      source: state.mindmapInputSource,
      title: state.mindmapInputTitle || fileTitle || '',
    }
  }

  const userText = findLatestUserMessageText(state.messages)
  if (userText) {
    return {
      source: { type: 'text', content: userText },
      title: fileTitle || '',
    }
  }

  return null
}
