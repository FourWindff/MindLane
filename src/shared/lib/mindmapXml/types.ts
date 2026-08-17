/**
 * mindmapXml 协议模块的类型与错误契约（PRD 5.x）。
 *
 * XML 同时是存储面、AI 上下文面、工具参数面；本模块是解析/序列化/校验的唯一边界。
 * 错误码见 PRD 5.4 表格，工具结果直接回传给 AI，提示词附恢复策略。
 */

/** 解析/校验错误码（PRD 5.4）。 */
export type MindmapXmlErrorCode =
  | 'xml_parse_error'
  | 'empty_xml'
  | 'block_not_found'
  | 'invalid_type'
  | 'text_unescaped'
  | 'tree_invalid'
  | 'asset_not_found'

export const MINDLANE_XML_VERSION = '1.0'

/** 根标签名（大小写不敏感解析）。 */
export const MINDLANE_ROOT_TAG = 'mindlane'

/** 树节点标签名（AI 片段/文件 mindmap 节共用）。 */
export const NODE_TAG = 'node'

/** 内嵌图片资源（base64 数据，无 data: 前缀）。 */
export interface MindlaneAsset {
  id: string
  mime: string
  sha256: string
  /** base64 编码的图片数据 */
  data: string
}

/**
 * 解析/校验失败异常。所有畸形输入经此异常映射为错误码，绝不裸抛。
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
 * 解析器无关的最小元素视图，供节点注册表的类型专属 reader 使用
 * （避免把具体 DOM 实现泄漏进注册表）。
 */
export interface XmlElementLike {
  /** 标签名（小写） */
  tag: string
  attrs: Record<string, string>
  /** 直接文本内容（去空白） */
  text: string
  /** 类型专属子元素（不含 <node> 树子节点） */
  elements: XmlElementLike[]
}
