import { MindmapXmlError, type MindmapXmlErrorCode } from './types.js'

/**
 * Error code → recovery-strategy copy (PRD 5.4: tool results are returned to
 * the model and the prompt carries the recovery strategy). Shared by the main
 * process tool layer and the renderer live-apply responder so both speak the
 * same vocabulary.
 */
const RECOVERY_STRATEGIES: Record<MindmapXmlErrorCode, string> = {
  xml_parse_error: '重写 XML 后重试',
  empty_xml: '补充节点内容',
  block_not_found: '先调用 readMindmap 重新定位后再操作',
  invalid_type: '改用注册表中的节点类型',
  text_unescaped: '把 & < > " \' 转义为实体后重试',
  tree_invalid: '修正为纯树（去重 id、避开 root、目标不得在被移子树内）',
  asset_not_found: '修正或去掉 asset 属性（asset 必须来自上下文）',
}

/** Format any error into a model-readable message; MindmapXmlError gets `[code] message。恢复策略：…`. */
export function formatXmlError(err: unknown): string {
  if (err instanceof MindmapXmlError) {
    return `[${err.code}] ${err.message}。恢复策略：${RECOVERY_STRATEGIES[err.code] ?? '重试'}`
  }
  return err instanceof Error ? err.message : String(err)
}
