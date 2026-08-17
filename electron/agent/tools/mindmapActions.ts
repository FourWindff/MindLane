import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import {
  MindmapXmlError,
  buildValidationContext,
  parseXmlFragment,
  validateFragmentForInsert,
} from '../../../src/shared/lib/mindmapXml/index.js'
import type { MindmapEditorSnapshot } from '../../ipc.js'

/**
 * AI 写工具集（固定 4 个，PRD 6.1）：insertXmlFragment / updateMindmapNode /
 * moveMindmapNode / deleteMindmapNode。工具集不随节点类型增长——类型知识走
 * 注册表校验 + 系统提示注入。
 *
 * 校验职责：主进程工具对 XML 做语法/类型/转义/纯树/存在性校验（错误码回传给 AI），
 * 返回 action 指令；渲染层执行器把校验通过的片段落图（编辑器是唯一写文件方）。
 * 快照提供者经反向 IPC 拉编辑器活状态（nodeIds/assetIds/parents）。
 */

/** 写工具校验用编辑器快照提供者（主进程装配时注入）。 */
export type EditorSnapshotProvider = (fileUuid: string) => Promise<MindmapEditorSnapshot>

/** 错误码 + 恢复策略（PRD 5.4：工具结果返回给 AI，提示词含恢复策略）。 */
function xmlErrorResult(err: unknown): { ok: false; error: string } {
  if (err instanceof MindmapXmlError) {
    const recovery: Record<string, string> = {
      xml_parse_error: '重写 XML 后重试',
      empty_xml: '补充节点内容',
      block_not_found: '先调用 readMindmap 重新定位后再操作',
      invalid_type: '改用注册表中的节点类型',
      text_unescaped: '把 & < > " \' 转义为实体后重试',
      tree_invalid: '修正为纯树（去重 id、避开 root、目标不得在被移子树内）',
      asset_not_found: '修正或去掉 asset 属性（asset 必须来自上下文）',
    }
    return {
      ok: false,
      error: `[${err.code}] ${err.message}。恢复策略：${recovery[err.code] ?? '重试'}`,
    }
  }
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

function hasNode(nodes: Set<string>, id: string | undefined): boolean {
  return id !== undefined && nodes.has(id)
}

// ========== insertXmlFragment（统一写入口） ==========

/**
 * 创建统一写入口工具：任意位置插入嵌套 XML 片段（含批量子树生成）。
 * position: root=挂到根节点 / child=挂到 parentId 之下 / after|before=成为 parentId 兄弟。
 * parentId 省略时回退链：选中节点 → 根节点 root → 报错。
 */
export function createInsertXmlFragmentTool(provider: EditorSnapshotProvider) {
  return tool(
    async ({ fileUuid, xml, parentId, position }) => {
      try {
        const parsed = await parseXmlFragment(xml)
        const snapshot = await provider(fileUuid ?? '')

        const { ctx } = buildValidationContext(
          snapshot.nodeIds.map((id) => ({ id })),
          [],
          snapshot.assetIds.map((id) => ({ id })),
        )
        validateFragmentForInsert(parsed, ctx)

        const pos = position ?? 'child'
        if (pos === 'child' || pos === 'after' || pos === 'before') {
          if (parentId && !hasNode(ctx.nodeIds, parentId)) {
            return {
              ok: false,
              error: `[block_not_found] 定位节点「${parentId}」不存在。恢复策略：先调用 readMindmap 重新定位后再操作`,
            }
          }
        }

        return {
          ok: true,
          action: 'insertXmlFragment',
          data: { xml, parentId, position: pos, nodeCount: parsed.nodes.length },
        }
      } catch (err) {
        return xmlErrorResult(err)
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
 * 创建更新工具：XML 参数整体替换节点（含子树）。片段根节点 id 必须存在
 * （block_not_found）；根节点不允许替换（tree_invalid）。
 */
export function createUpdateMindmapNodeTool(provider: EditorSnapshotProvider) {
  return tool(
    async ({ fileUuid, xml }) => {
      try {
        const parsed = await parseXmlFragment(xml)
        const snapshot = await provider(fileUuid ?? '')
        const existing = new Set(snapshot.nodeIds)

        if (parsed.rootIds.length !== 1) {
          return {
            ok: false,
            error:
              '[tree_invalid] updateMindmapNode 必须提供恰好一个根 <node>（含子树）。恢复策略：用单个根节点重写',
          }
        }
        const nodeId = parsed.rootIds[0]!
        if (nodeId === 'root') {
          return {
            ok: false,
            error: '[tree_invalid] root 是导图锚点，不可被替换。恢复策略：不要触碰 root',
          }
        }
        if (!existing.has(nodeId)) {
          return {
            ok: false,
            error: `[block_not_found] 节点「${nodeId}」不存在。恢复策略：先调用 readMindmap 重新定位后再操作`,
          }
        }

        // 子树内的新 id 不得与编辑器其它节点冲突（被替换节点自身除外）
        const { ctx } = buildValidationContext(
          snapshot.nodeIds.map((id) => ({ id })),
          [],
          snapshot.assetIds.map((id) => ({ id })),
        )
        validateFragmentForInsert(parsed, ctx, new Set([nodeId]))

        return {
          ok: true,
          action: 'updateMindmapNode',
          data: { xml, nodeId, nodeCount: parsed.nodes.length },
        }
      } catch (err) {
        return xmlErrorResult(err)
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
 * root 不可移动；目标不得位于被移子树内（环 → tree_invalid）。
 */
export function createMoveMindmapNodeTool(provider: EditorSnapshotProvider) {
  return tool(
    async ({ fileUuid, nodeId, targetId, position }) => {
      try {
        const snapshot = await provider(fileUuid ?? '')
        const existing = new Set(snapshot.nodeIds)

        if (nodeId === 'root') {
          return {
            ok: false,
            error: '[tree_invalid] root 是导图锚点，不可移动。恢复策略：不要触碰 root',
          }
        }
        if (!existing.has(nodeId)) {
          return {
            ok: false,
            error: `[block_not_found] 节点「${nodeId}」不存在。恢复策略：先调用 readMindmap 重新定位后再操作`,
          }
        }
        const target = targetId ?? 'root'
        if (target === nodeId) {
          return {
            ok: false,
            error: '[tree_invalid] 目标节点不能是自身。恢复策略：改用其它目标',
          }
        }
        if (!existing.has(target)) {
          return {
            ok: false,
            error: `[block_not_found] 目标节点「${target}」不存在。恢复策略：先调用 readMindmap 重新定位后再操作`,
          }
        }

        // 环检测：沿 parents 链从 target 向上走到根，命中 nodeId 即环
        let current: string | undefined = snapshot.parents[target]
        while (current) {
          if (current === nodeId) {
            return {
              ok: false,
              error:
                '[tree_invalid] 不能把节点移动到它自己的子树内（会产生环）。恢复策略：改用其它目标',
            }
          }
          current = snapshot.parents[current]
        }

        return {
          ok: true,
          action: 'moveMindmapNode',
          data: { nodeId, targetId: target, position: position ?? 'child' },
        }
      } catch (err) {
        return xmlErrorResult(err)
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

const deleteNodeTool = tool(
  async ({ fileUuid, nodeId, confirmDeleteSubtree }) => {
    if (!nodeId.trim()) {
      return { ok: false, error: '节点ID不能为空' }
    }
    if (nodeId === 'root') {
      return {
        ok: false,
        error: '[tree_invalid] root 是导图锚点，不可删除。恢复策略：不要触碰 root',
      }
    }
    return {
      ok: true,
      action: 'deleteNode',
      data: {
        fileUuid,
        nodeId,
        confirmDeleteSubtree: confirmDeleteSubtree ?? true,
      },
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

export interface MindmapWriteTools {
  insertXmlFragmentTool: ReturnType<typeof createInsertXmlFragmentTool>
  updateNodeTool: ReturnType<typeof createUpdateMindmapNodeTool>
  moveNodeTool: ReturnType<typeof createMoveMindmapNodeTool>
  deleteNodeTool: typeof deleteNodeTool
}

/** 创建固定 4 写工具。 */
export function createMindmapActionTools(provider: EditorSnapshotProvider): MindmapWriteTools {
  return {
    insertXmlFragmentTool: createInsertXmlFragmentTool(provider),
    updateNodeTool: createUpdateMindmapNodeTool(provider),
    moveNodeTool: createMoveMindmapNodeTool(provider),
    deleteNodeTool,
  }
}
