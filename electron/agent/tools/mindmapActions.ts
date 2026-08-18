import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'

/**
 * AI write tool set (fixed 4, PRD 6.1): insertXmlFragment / updateMindmapNode /
 * moveMindmapNode / deleteMindmapNode. The set does not grow with node types —
 * type knowledge lives in the registry validation + system-prompt injection.
 *
 * Renderer proxy (ADR 0017 decision 1): the main-process tools no longer do
 * snapshot validation; they forward the tool args over reverse IPC to the
 * renderer write responder (live-editor atomic validation + apply) and return
 * the renderer ack `{ok, action, data}` **as-is** as the tool result. No
 * renderer response / timeout is treated as tool failure (error goes back to
 * the model, the stream continues), with no added retry. Model-visible
 * contracts (tool name/description/schema) stay unchanged.
 */

/** Write-tool renderer proxy: forwards args and returns the renderer's write ack (as-is). */
export type MindmapWriteProxy = (
  fileUuid: string,
  action: string,
  args: Record<string, unknown>,
) => Promise<unknown>

/** Unified error wrapping: timeout / renderer ok:false / unavailable window → tool failure result. */
function asToolError(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

// ========== insertXmlFragment (unified write entry) ==========

/**
 * Creates the unified write-entry tool: inserts a nested XML fragment at any
 * position (including batched subtree generation).
 * position: root=attach under the root / child=attach under parentId /
 * after|before=become a sibling of parentId.
 * Validation and apply both happen inside the renderer responder (atomic live-editor op).
 */
export function createInsertXmlFragmentTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, xml, parentId, position }) => {
      try {
        return await proxy(fileUuid ?? '', 'insertXmlFragment', { xml, parentId, position })
      } catch (err) {
        return asToolError(err)
      }
    },
    {
      name: 'insertXmlFragment',
      description: `在思维导图中插入一个 XML 片段（嵌套子树，支持批量）。position 定位：child=挂到 parentId 之下（默认）；after/before=插入到 parentId 这个兄弟节点的后面/前面；root=挂到根节点。parentId 省略时按 选中节点 → 根节点 回退。规则：新节点禁止编写 id（系统 mint）；type 必填（text/image/palace）；content 是纯文本属性，特殊字符需转义；图片节点必须引用上下文中的 asset。fileUuid 可从用户消息末尾 <EDITOR_STATE file_uuid="..."> 获得。`,
      schema: z.object({
        fileUuid: z.string().optional().describe('导图文件身份 fileUuid'),
        xml: z.string().describe('要插入的 XML 片段（顶层多个 <node> = 批量插入）'),
        parentId: z
          .string()
          .optional()
          .describe('position=child 时为父节点 id；position=after/before 时为兄弟节点 id'),
        position: z
          .enum(['root', 'child', 'after', 'before'])
          .optional()
          .describe('插入位置（缺省 child）'),
      }),
    },
  )
}

// ========== updateMindmapNode (whole replacement, args switched to XML) ==========

/**
 * Creates the update tool: replaces the node wholesale (with subtree) from an
 * XML arg. Validation and apply happen inside the renderer responder.
 */
export function createUpdateMindmapNodeTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, xml }) => {
      try {
        return await proxy(fileUuid ?? '', 'updateMindmapNode', { xml })
      } catch (err) {
        return asToolError(err)
      }
    },
    {
      name: 'updateMindmapNode',
      description: `整体替换一个导图节点（内容/类型/子树）。xml 参数是单个根 <node>，其 id 必须是 readMindmap 提供的现有节点 id；节点本身被替换为新 XML 的形状，原子树被新子树整体替换。root 不可替换。fileUuid 可从用户消息末尾 <EDITOR_STATE file_uuid="..."> 获得。`,
      schema: z.object({
        fileUuid: z.string().optional().describe('导图文件身份 fileUuid'),
        xml: z.string().describe('单个根 <node> 的 XML（id 引用现有节点）'),
      }),
    },
  )
}

// ========== moveMindmapNode (detach + re-attach + re-layout) ==========

/**
 * Creates the move tool: detaches the subtree, re-attaches it and re-layouts
 * (single batch history entry, atomic). Validation (root immovable; target
 * must not live inside the moved subtree) happens in the renderer responder.
 */
export function createMoveMindmapNodeTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, nodeId, targetId, position }) => {
      try {
        return await proxy(fileUuid ?? '', 'moveMindmapNode', { nodeId, targetId, position })
      } catch (err) {
        return asToolError(err)
      }
    },
    {
      name: 'moveMindmapNode',
      description: `移动一个节点（连同其整棵子树）到新位置，原子操作（一次撤销还原）。position：child=成为 targetId 的子节点（默认）；after/before=成为 targetId 的兄弟。root 不可移动；不能移动到自己的子树内。fileUuid 可从用户消息末尾 <EDITOR_STATE file_uuid="..."> 获得。`,
      schema: z.object({
        fileUuid: z.string().optional().describe('导图文件身份 fileUuid'),
        nodeId: z.string().describe('要移动的节点 id（含其子树）'),
        targetId: z.string().optional().describe('目标节点 id（缺省 root）'),
        position: z
          .enum(['child', 'after', 'before'])
          .optional()
          .describe('相对目标的插入位置（缺省 child）'),
      }),
    },
  )
}

// ========== deleteMindmapNode (kept) ==========

/**
 * Creates the delete tool: deletes the node (with its subtree). The action
 * name stays `deleteNode` (the renderer responder applies by that name).
 */
export function createDeleteMindmapNodeTool(proxy: MindmapWriteProxy) {
  return tool(
    async ({ fileUuid, nodeId, confirmDeleteSubtree }) => {
      try {
        return await proxy(fileUuid ?? '', 'deleteNode', { nodeId, confirmDeleteSubtree })
      } catch (err) {
        return asToolError(err)
      }
    },
    {
      name: 'deleteMindmapNode',
      description:
        '删除指定的思维导图节点（连同其整棵子树）。nodeId 必须来自 readMindmap 提供的 id；root 不可删除。fileUuid 可从用户消息末尾 <EDITOR_STATE file_uuid="..."> 获得。',
      schema: z.object({
        fileUuid: z.string().optional().describe('导图文件身份 fileUuid'),
        nodeId: z.string().describe('要删除的节点ID（含子树）'),
        confirmDeleteSubtree: z.boolean().optional().describe('是否确认删除子树，默认为true'),
      }),
    },
  )
}

export interface MindmapWriteTools {
  insertXmlFragmentTool: ReturnType<typeof createInsertXmlFragmentTool>
  updateNodeTool: ReturnType<typeof createUpdateMindmapNodeTool>
  moveNodeTool: ReturnType<typeof createMoveMindmapNodeTool>
  deleteNodeTool: ReturnType<typeof createDeleteMindmapNodeTool>
}

/** Creates the fixed 4 write tools (renderer proxies). */
export function createMindmapActionTools(proxy: MindmapWriteProxy): MindmapWriteTools {
  return {
    insertXmlFragmentTool: createInsertXmlFragmentTool(proxy),
    updateNodeTool: createUpdateMindmapNodeTool(proxy),
    moveNodeTool: createMoveMindmapNodeTool(proxy),
    deleteNodeTool: createDeleteMindmapNodeTool(proxy),
  }
}
