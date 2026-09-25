import { describe, it, expect, vi } from 'vitest'
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import type { BaseMessage } from '@langchain/core/messages'
import { AgentOrchestrator } from '../orchestrator.js'
import type { AgentServices } from '../service.js'
import { ProviderCapability, type LLMProvider } from '../providers/index.js'

const TREE_XML = '<node>读书笔记\n  <node>第一点</node>\n</node>'

/**
 * Scripted provider: the supervisor asks for the mindmap subgraph, the
 * subgraph's own model call returns a valid outline.
 */
function scriptedProvider(): LLMProvider {
  const invoke = vi.fn(async (messages: BaseMessage[]) => {
    const last = messages[messages.length - 1]
    if (last?.type === 'human') {
      return new AIMessage({
        content: '我来生成思维导图',
        tool_calls: [
          { name: 'generateMindmapFragment', args: {}, id: 'call-mm', type: 'tool_call' },
        ],
      })
    }
    return new AIMessage({ content: TREE_XML })
  })

  return {
    model: {
      invoke,
      bindTools: () => ({ invoke }),
      withStructuredOutput: () => ({ invoke }),
    },
    contextWindow: 32_768,
    capabilities: new Set([ProviderCapability.Chat]),
    models: [],
  } as unknown as LLMProvider
}

describe('主图运行中的子图回填', () => {
  it('子图私有键与标量通道跨图后仍到达收口：ToolMessage 按子图自己的调用信息生成', async () => {
    const orchestrator = new AgentOrchestrator(scriptedProvider(), {
      checkpointer: { getAdapter: () => undefined },
      // 会话侧装配不在本测试的关注面内：Consolidator 拿不到会话就跳过本轮压缩。
      sessionManager: { workspaceUuid: 'workspace-a' },
    } as unknown as AgentServices)

    const runtime = orchestrator.getStreamRuntime()
    const stream = await runtime.graph.stream(
      {
        messages: [new HumanMessage('把这段内容做成导图')],
        context: { fileUuid: 'file-a', filePath: '/a.mindlane', fileTitle: '笔记' },
        artworkStyle: 'vector',
      },
      { recursionLimit: 80, streamMode: ['messages', 'custom'] },
    )

    const toolMessages: Array<{
      name?: string
      toolCallId?: string
      content: string
      toolSteps?: unknown
    }> = []
    const steps: string[] = []
    for await (const [mode, payload] of stream) {
      if (mode === 'messages') {
        const [message] = payload as [
          {
            type?: string
            name?: string
            tool_call_id?: string
            content?: unknown
            additional_kwargs?: { toolSteps?: unknown }
          },
        ]
        if (message?.type === 'tool') {
          toolMessages.push({
            name: message.name,
            toolCallId: message.tool_call_id,
            content: String(message.content),
            toolSteps: message.additional_kwargs?.toolSteps,
          })
        }
      } else if (mode === 'custom') {
        steps.push((payload as { step: string }).step)
      }
    }

    // 收口用的是子图自己那份调用信息（而不是某个共享的 pending 键）
    expect(toolMessages).toHaveLength(1)
    expect(toolMessages[0]!.name).toBe('generateMindmapFragment')
    expect(toolMessages[0]!.toolCallId).toBe('call-mm')
    expect(JSON.parse(toolMessages[0]!.content)).toMatchObject({ ok: true, title: '读书笔记' })
    // 子图写入的 mindmapToolSteps 也活着走到了收口（阶段轨迹随 ToolMessage 持久化）
    expect(steps).toEqual(['reading-doc', 'extracting', 'extracting', 'finalizing'])
    expect(toolMessages[0]!.toolSteps).toEqual([
      { step: 'reading-doc' },
      { step: 'extracting' },
      { step: 'extracting', completed: 1, total: 1 },
      { step: 'finalizing' },
    ])
  })
})
