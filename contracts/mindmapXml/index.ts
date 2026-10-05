/**
 * mindmapXml parsing module (PRD 5): registry / serializer / deserializer / normalize / validate.
 * Parse/serialize/validate/migrate logic lives in this parsing module, so a
 * format issue is fixed in exactly one place.
 *
 * Only the symbols the barrel consumers actually import are re-exported here;
 * module-internal code and tests import siblings directly.
 */

export { MindmapXmlError, NODE_TAG } from './types.js'
export type { MindLaneAsset } from './types.js'
export type { DomElementLike, DomNodeLike, ParsedDocumentLike } from './dom.js'
export { formatXmlError } from './errors.js'
export { escapeXml } from './escape.js'
export { normalizeSelfClosingTags } from './normalize.js'
export { parseXmlTolerant, topLevelElements } from './parser.js'
export { isValidSvgArtwork } from './svg.js'
export {
  serializeMindLaneFile,
  serializeMindmapSection,
  serializePalaceNodeXml,
} from './serializer.js'
export { parseXmlFragment, deserializeMindLaneFile } from './deserializer.js'
export { validateFragmentForInsert, validateMove, buildValidationContext } from './validate.js'
