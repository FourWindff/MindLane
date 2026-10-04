/**
 * Type and error contracts of the mindmapXml protocol module (PRD 5.x).
 *
 * XML is simultaneously the storage surface, the AI context surface and the
 * tool-argument surface; this module is the single boundary for
 * parse/serialize/validate. Error codes are in the PRD 5.4 table; tool results
 * go straight back to the AI and the prompt carries the recovery strategy.
 */

/** Parse/validation error codes (PRD 5.4). */
type MindmapXmlErrorCode =
  | 'xml_parse_error'
  | 'empty_xml'
  | 'block_not_found'
  | 'invalid_type'
  | 'text_unescaped'
  | 'tree_invalid'
  | 'asset_not_found'

export const MINDLANE_XML_VERSION = '1.0'

/** Root tag name (parsed case-insensitively). */
export const MINDLANE_ROOT_TAG = 'mindlane'

/** Tree node tag name (shared by AI fragments and the file's mindmap section). */
export const NODE_TAG = 'node'

/** Embedded image asset (base64 data, no data: prefix). */
export interface MindLaneAsset {
  id: string
  mime: string
  sha256: string
  /** base64-encoded image data */
  data: string
}

/**
 * Parse/validation failure exception. All malformed input maps to an error code
 * through this exception, never thrown bare.
 */
export class MindmapXmlError extends Error {
  readonly code: MindmapXmlErrorCode

  constructor(code: MindmapXmlErrorCode, message: string) {
    super(message)
    this.name = 'MindmapXmlError'
    this.code = code
  }
}

/**
 * Minimal parser-agnostic element view for the node registry's type-specific
 * readers (keeps the concrete DOM implementation out of the registry).
 */
export interface XmlElementLike {
  /** Tag name (lowercase) */
  tag: string
  attrs: Record<string, string>
  /** Direct text content (trimmed) */
  text: string
  /** Type-specific child elements (excluding <node> tree children) */
  elements: XmlElementLike[]
}

/**
 * Minimal node shape the XML layer reads and writes. ReactFlow's `Node` is
 * structurally assignable to it, so the renderer can hand its live nodes to the
 * serializer without an adapter; the contracts layer stays UI-free.
 */
export interface MindmapXmlNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: Record<string, unknown>
}

/** Minimal edge shape the XML layer reads (ReactFlow's `Edge` assigns to it). */
export interface MindmapXmlEdge {
  id: string
  source: string
  target: string
  type?: string
}
