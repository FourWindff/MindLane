import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'

/**
 * AI 写工具集（固定 4 个，PRD 6.1）：insertXmlFragment / updateMindmapNode /
 * moveMindmapNode / deleteMindmapNode。工具集不随节点类型增长——类型知识走
 * 注册表校验 + 系统提示注入。
 *
 * 渲染层代理（ADR 0017 决策 1）：主进程工具不再做快照校验，而是把工具参数经
 * 反向 IPC 转发给渲染层落盘应答器（活编辑器原子校验 + 落图），渲染层应答
 * `{ok, action, data}` **原样**作为工具结果回给模型。渲染层无响应/超时按工具
 * 失败处理（错误结果回模型，流不中断），不新增重试。工具名/描述/schema 等
 * 模型可见契约不变。
 */

/** 写工具渲染层代理：转发参数，返回渲染层的落盘应答（原样）。 */
export type MindmapWriteProxy = (
  fileUuid: string,
  action: string,
  args: Record<string, unknown>,
) => Promise<unknown>

/** 统一错误包装：超时 / 渲染层 ok:false / 窗口不可用 → 工具失败结果。 */
function asToolError(err: unknown): { ok: false; error: string } {
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

// ========== insertXmlFragment（统一写入口） ==========

/**
 * 创建统一写入口工具：任意位置插入嵌套 XML 片段（含批量子树生成）。
 * position: root=挂到根节点 / child=挂到 parentId 之下 / after|before=成为 parentId 兄弟。
 * 校验与落图都在渲染层应答器内完成（活编辑器原子操作）。
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

// ========== updateMindmapNode（整体替换，参数改 XML） ==========

/**
 * 创建更新工具：XML 参数整体替换节点（含子树）。校验与落图在渲染层应答器内。
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

// ========== moveMindmapNode（摘除 + 重挂 + 重布局） ==========

/**
 * 创建移动工具：摘除子树 + 重挂 + 重布局（单条 batch 历史，原子）。
 * 校验（root 不可移、目标不得在被移子树内）在渲染层应答器内完成。
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

// ========== deleteMindmapNode（保留） ==========

/**
 * 创建删除工具：删除指定节点（连同子树）。动作名沿用 `deleteNode`（渲染层
 * 应答器按该动作名落图）。
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

/** 创建固定 4 写工具（渲染层代理）。 */
export function createMindmapActionTools(proxy: MindmapWriteProxy): MindmapWriteTools {
  return {
    insertXmlFragmentTool: createInsertXmlFragmentTool(proxy),
    updateNodeTool: createUpdateMindmapNodeTool(proxy),
    moveNodeTool: createMoveMindmapNodeTool(proxy),
    deleteNodeTool: createDeleteMindmapNodeTool(proxy),
  }
}
