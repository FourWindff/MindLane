/**
 * mindmapXml 解析模块（PRD 5）：registry / serializer / deserializer / normalize / validate。
 * 解析/序列化/校验/迁移逻辑集中在解析模块，格式问题只在一处修复。
 *
 * Only the symbols the barrel consumers actually import are re-exported here;
 * module-internal code and tests import siblings directly.
 */

export { MindmapXmlError, NODE_TAG } from './types.js'
export type { MindlaneAsset } from './types.js'
export { formatXmlError } from './errors.js'
export { escapeXml } from './escape.js'
export { normalizeSelfClosingTags } from './normalize.js'
export { parseXmlTolerant, topLevelElements } from './parser.js'
export { isValidSvgArtwork } from './svg.js'
export {
  serializeMindlaneFile,
  serializeTreeFragment,
  serializeMindmapSection,
  serializePalaceNodeXml,
} from './serializer.js'
export { parseXmlFragment, deserializeMindlaneFile } from './deserializer.js'
export { validateFragmentForInsert, validateMove, buildValidationContext } from './validate.js'
