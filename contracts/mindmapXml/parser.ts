/**
 * Parsing core (not home-grown): browser DOMParser, main-process linkedom.
 *
 * Two strictness levels are kept apart (PRD 1.3-2):
 * - Files (produced by the editor) → strict XML mode; malformed input maps to
 *   `xml_parse_error`;
 * - AI interaction fragments (tool arguments/context) → tolerant HTML mode.
 *
 * The parser is assembled per process (design doc: browser DOMParser,
 * main-process linkedom):
 * - Renderer: `globalThis.DOMParser` is always available and this module does
 *   not import linkedom (linkedom's optional canvas dependency cannot be
 *   statically resolved by Vite/Rollup, so it must stay out of the renderer graph);
 * - Main process: injected at startup via `registerXmlDomParser(linkedom.DOMParser)`;
 * - Test environment (Electron-as-Node): injected by the vitest setup.
 */

import { MindmapXmlError } from './types.js'
import { checkXmlWellFormed } from './normalize.js'
import type { DomElementLike, DomNodeLike, ParsedDocumentLike } from './dom.js'

export type { DomElementLike, DomNodeLike, ParsedDocumentLike } from './dom.js'

type DomParserCtor = new () => {
  parseFromString(xml: string, contentType: string): ParsedDocumentLike
}

let injectedParser: DomParserCtor | undefined

/** Main-process assembly entry: inject the in-process XML/HTML parser (linkedom.DOMParser on Node).
 * The parameter is typed unknown because linkedom's DOM types are structurally incompatible
 * with the browser's lib.dom; the assembly site narrows it. */
export function registerXmlDomParser(ctor: unknown): void {
  injectedParser = ctor as DomParserCtor
}

function getDomParser(): DomParserCtor {
  const global = globalThis as { DOMParser?: DomParserCtor }
  if (typeof global.DOMParser === 'function') return global.DOMParser
  if (injectedParser) return injectedParser
  throw new MindmapXmlError(
    'xml_parse_error',
    'No XML parser is available in this environment: the renderer needs DOMParser, and the main process/test environment needs linkedom injected',
  )
}

/**
 * Strictly parse XML (file surface). Malformed input throws `xml_parse_error`,
 * never bare.
 */
export function parseXmlStrict(xml: string): ParsedDocumentLike {
  const structureError = checkXmlWellFormed(xml)
  if (structureError) {
    throw new MindmapXmlError('xml_parse_error', `XML structure is incomplete: ${structureError}`)
  }
  const Parser = getDomParser()
  try {
    const doc = new Parser().parseFromString(xml, 'application/xml')
    const parserError = doc.querySelector?.('parsererror')
    if (parserError) {
      const detail = parserError.textContent?.trim().slice(0, 200) ?? ''
      throw new MindmapXmlError('xml_parse_error', `XML parse failed: ${detail}`)
    }
    if (!doc.documentElement) {
      throw new MindmapXmlError('xml_parse_error', 'XML is empty or has no root element')
    }
    return doc
  } catch (err) {
    if (err instanceof MindmapXmlError) throw err
    throw new MindmapXmlError(
      'xml_parse_error',
      `XML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/**
 * Tolerant parsing (AI fragment surface): the HTML parser tolerates irregular
 * AI output. The caller must preprocess with normalizeSelfClosingTags first.
 */
export function parseXmlTolerant(xml: string): ParsedDocumentLike {
  const structureError = checkXmlWellFormed(xml)
  if (structureError) {
    // The tolerant mode's floor: tag pairing must still hold, otherwise the AI gets a broken structure
    throw new MindmapXmlError('xml_parse_error', `XML structure is incomplete: ${structureError}`)
  }
  const Parser = getDomParser()
  try {
    return new Parser().parseFromString(xml, 'text/html')
  } catch (err) {
    throw new MindmapXmlError(
      'xml_parse_error',
      `XML parse failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

/** Top-level element list from a parse result. */
export function topLevelElements(doc: ParsedDocumentLike): DomElementLike[] {
  const root = doc.documentElement
  if (!root) return []
  if (root.tagName.toLowerCase() === 'html') {
    const body = doc.body ?? root
    const children: DomElementLike[] = []
    for (const child of Array.from(body.childNodes)) {
      if (child.nodeType === 1) children.push(child as DomElementLike)
    }
    return children
  }
  const result: DomElementLike[] = []
  let el: DomElementLike | null = root
  while (el) {
    if (el.nodeType === 1) result.push(el)
    let next: DomNodeLike | null = el.nextSibling
    while (next && next.nodeType !== 1) next = next.nextSibling
    el = next as DomElementLike | null
  }
  return result
}
