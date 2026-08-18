/**
 * mindmapXml 解析模块（PRD 5）：registry / serializer / deserializer / normalize / validate。
 * 解析/序列化/校验/迁移逻辑集中在解析模块，格式问题只在一处修复。
 */

export { MindmapXmlError, MINDLANE_XML_VERSION, NODE_TAG } from './types.js'
export type { MindmapXmlErrorCode, MindlaneAsset, XmlElementLike } from './types.js'
export { formatXmlError } from './errors.js'
export { escapeXml, unescapeXml } from './escape.js'
export { normalizeSelfClosingTags, findUnescapedInAttrValues } from './normalize.js'
export { parseXmlStrict, parseXmlTolerant, topLevelElements } from './parser.js'
export { xmlNodeTypeRegistry } from './registry.js'
export type { XmlNodeTypeDescriptor, XmlNodeReaderContext } from './registry.js'
export {
  serializeMindlaneFile,
  serializeTreeFragment,
  serializeMindmapSection,
  serializeNodeElement,
} from './serializer.js'
export type { MindmapSectionQuery } from './serializer.js'
export { parseXmlFragment, deserializeMindlaneFile } from './deserializer.js'
export type { ParsedFragment } from './deserializer.js'
export { validateFragmentForInsert, validateMove, buildValidationContext } from './validate.js'
export type { EditorValidationContext } from './validate.js'
