import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'
import type { MindmapReadQuery } from '../../ipc.js'

export type { MindmapReadQuery }

/**
 * 导图快照提供者：按 fileUuid + 查询参数拉取实时导图 XML。
 * 由装配方注入（主进程经反向 IPC 向渲染层请求），工具自身不接触 IPC——
 * 与 readFile 工具的 getter 注入同一模式，保持工具无状态、可单测。
 */
export type MindmapSnapshotProvider = (fileUuid: string, query: MindmapReadQuery) => Promise<string>

export type MindmapReadToolResult = { ok: true; summary: string } | { ok: false; error: string }

/**
 * 创建按需读导图工具（PRD 6.2，原 getMindmapContext 改造）。
 * 树查询：scope/subtreeId/type/textContains/maxDepth；数据源为编辑器活状态
 * （反向 IPC 实时拉取，不读磁盘）；输出只含 mindmap 节 XML（metadata/assets/
 * documents 不进 AI 上下文）。
 *
 * 语义限制：写工具在流结束时前端落图，本轮 run 内读取不含正在添加的节点，
 * 模型应以自身工具结果为这些节点补全。
 */
export function createReadMindmapTool(provider: MindmapSnapshotProvider) {
  return tool(
    async ({ fileUuid, scope, subtreeId, type, textContains, maxDepth }) => {
      try {
        const summary = await provider(fileUuid ?? '', {
          scope: scope ?? 'whole',
          ...(subtreeId && { subtreeId }),
          ...(type && { type }),
          ...(textContains && { textContains }),
          ...(typeof maxDepth === 'number' && Number.isFinite(maxDepth) && { maxDepth }),
        })
        return { ok: true, summary }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
    {
      name: 'readMindmap',
      description: `读取当前思维导图的实时结构（XML 片段，携带 id/type/content/collapsed），用于回答「我的导图里有什么」、定位要编辑的节点。数据源是编辑器活状态，不是磁盘文件。fileUuid 可从当前用户消息末尾的 <EDITOR_STATE> 块中 file_uuid 属性获得（形如 <EDITOR_STATE file_uuid="...">）。注意：写工具（insertXmlFragment / updateMindmapNode / moveMindmapNode / deleteMindmapNode 等）在流结束时才落图，本轮 run 内读取的图**不含**你正在添加的节点——请以你自己的工具调用结果为准，不要用读图结果验证刚添加的节点。`,
      schema: z.object({
        fileUuid: z
          .string()
          .optional()
          .describe(
            '导图文件身份 fileUuid，可从用户消息末尾 <EDITOR_STATE file_uuid="..."> 中获得',
          ),
        scope: z
          .enum(['whole', 'subtree'])
          .optional()
          .describe('查询范围：whole=整图（默认），subtree=以 subtreeId 为根的子树'),
        subtreeId: z
          .string()
          .optional()
          .describe('scope=subtree 时的子树根节点 id（必须来自上下文）'),
        type: z.string().optional().describe('按节点类型过滤（text/image/palace）'),
        textContains: z.string().optional().describe('按节点内容包含过滤（纯文本匹配）'),
        maxDepth: z.number().optional().describe('深度截断（0=只返回根）'),
      }),
    },
  )
}
