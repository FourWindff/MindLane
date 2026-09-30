/**
 * Turn-state contract: one serialization/stripping implementation shared by the
 * main process (persistence, rolling summaries, memory extraction) and the
 * renderer (display, compaction), so the two sides cannot drift.
 */

import type { ChatContext } from './ipc.js'

// ---- 轮次状态（Turn State）契约 ----
// 序列化与剥离的单一实现：主进程持久化、UI 展示、滚动摘要、记忆提取
// 四个消费方共享同一份代码，避免各写一份导致漂移。

/** 轮次状态 XML 块的根标签名。 */
export const EDITOR_STATE_TAG = 'EDITOR_STATE'

/** XML 属性值转义：`<` `>` `&` `"` 不破坏结构。 */
export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 把 `ChatContext` 序列化为 `<EDITOR_STATE>` XML 块（轮次状态）。
 *
 * 结构约定：根标签携带文件身份属性（file_uuid / file_path / file_title）；
 * `<SELECTED_NODES count>` 恒发（空选 count="0" 且无子节点）；
 * `<ATTACHED_DOCUMENT>` / `<LINKED_DOCUMENTS>` 存在时才发。
 * 不含导图树摘要——模型需要完整结构时按需调用 `readMindmap` 读工具。
 */
export function serializeTurnState(context: ChatContext): string {
  let xml = `<${EDITOR_STATE_TAG} file_uuid="${xmlEscape(context.fileUuid)}" file_path="${xmlEscape(context.filePath ?? '')}" file_title="${xmlEscape(context.fileTitle ?? '')}">
`

  const selectedNodes = context.selectedNodes ?? []
  xml += `<SELECTED_NODES count="${selectedNodes.length}">
`
  for (const node of selectedNodes) {
    // 协议 XML 形状：id/type/content/collapsed；compact 模式带根节点链 + 直接子树
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
用户已附加文档「${xmlEscape(doc.filename)}」，请根据此文档内容生成思维导图。
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
 * 从消息文本末尾剥离 `<EDITOR_STATE>` 块（展示、滚动摘要、记忆提取共用）。
 *
 * 末尾锚定：只剥**末尾**的完整块（含其前的换行分隔），
 * 无块时 no-op，中间内容永不触碰。旧会话消息无块 → 原样返回。
 */
export function stripTurnState(text: string): string {
  const closeTag = `</${EDITOR_STATE_TAG}>`
  const closeIndex = text.lastIndexOf(closeTag)
  if (closeIndex < 0) return text
  // 块必须是文本末尾（允许尾随空白），否则视为普通内容。
  if (text.slice(closeIndex + closeTag.length).trim() !== '') return text

  const openTag = `<${EDITOR_STATE_TAG}`
  const openIndex = text.lastIndexOf(openTag, closeIndex)
  if (openIndex < 0) return text
  // 防止误剥 `<EDITOR_STATE_EXTRA>` 之类的前缀同名标签。
  const afterOpen = text[openIndex + openTag.length]
  if (afterOpen !== ' ' && afterOpen !== '>' && afterOpen !== '\n') return text

  // 剥掉开标签到末尾的整段，并去掉其前的换行分隔。
  return text.slice(0, openIndex).replace(/\r?\n+$/, '')
}

/**
 * 把"当前轮"切片语义收敛为跨进程共享的唯一实现。
 * 边界 = 最后一条 `type === 'human' || role === 'user'` 的消息；
 * `previous` 含边界消息，`current` 不含；无边界时 `previous` = 全部、`current` = 空。
 * 两种消息模型（`BaseMessage.type` 与 `ChatMessage.role`）共用同一份语义。
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
