import { tool } from '@langchain/core/tools'
import { z } from 'zod/v3'

/**
 * 导图快照提供者：按 fileUuid 拉取实时导图结构文本。
 * 由装配方注入（主进程经反向 IPC 向渲染层请求），工具自身不接触 IPC——
 * 与 readFile 工具的 getter 注入同一模式，保持工具无状态、可单测。
 */
export type MindmapSnapshotProvider = (fileUuid: string) => Promise<string>

export type MindmapReadToolResult = { ok: true; summary: string } | { ok: false; error: string }

/**
 * 创建按需读导图工具。模型需要超出选中范围的导图结构时调用，
 * 经注入的 provider 拉取实时导图树（`getContextSummary` 形状）。
 *
 * 语义限制：写工具在流结束时前端落图，本轮 run 内读取不含正在添加的节点，
 * 模型应以自身工具结果为这些节点补全。
 */
export function createGetMindmapContextTool(provider: MindmapSnapshotProvider) {
  return tool(
    async ({ fileUuid }): Promise<MindmapReadToolResult> => {
      try {
        const summary = await provider(fileUuid ?? '')
        return { ok: true, summary }
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
    {
      name: 'getMindmapContext',
      description: `读取当前思维导图的实时结构与节点 id，用于回答「我的导图里有什么」、把节点移到其他节点下等需要整图结构的问题。fileUuid 可从当前用户消息末尾的 <EDITOR_STATE> 块中 file_uuid 属性获得（形如 <EDITOR_STATE file_uuid="...">）。注意：写工具（addTextNode / updateMindmapNode / deleteMindmapNode / batchAddMindmapNodes 等）在流结束时才落图，本轮 run 内读取的图**不含**你正在添加的节点——请以你自己的工具调用结果为准，不要用读图结果验证刚添加的节点。`,
      schema: z.object({
        fileUuid: z
          .string()
          .optional()
          .describe(
            '导图文件身份 fileUuid，可从用户消息末尾 <EDITOR_STATE file_uuid="..."> 中获得',
          ),
      }),
    },
  )
}
