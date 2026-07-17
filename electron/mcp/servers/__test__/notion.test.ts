import { describe, it, expect } from 'vitest'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { notionServer } from '../notion.js'

function fakeSelfTool(name: string, result: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name,
    description: 'fake get-self',
    schema: z.object({}),
    func: async () => result,
  })
}

describe('notionServer.fetchWorkspaceName', () => {
  it('从 get-self 工具的 JSON 结果中提取 workspace 名', async () => {
    const tools = [
      fakeSelfTool(
        'notion__API-get-self',
        JSON.stringify({ object: 'user', type: 'bot', bot: { workspace_name: '我的知识库' } }),
      ),
    ]

    await expect(notionServer.fetchWorkspaceName!(tools)).resolves.toBe('我的知识库')
  })

  it('兼容非 JSON 文本结果（正则兜底）', async () => {
    const tools = [fakeSelfTool('notion-get-self', 'user info: {"workspace_name":"Acme"} trailing')]

    await expect(notionServer.fetchWorkspaceName!(tools)).resolves.toBe('Acme')
  })

  it('没有 get-self 工具或结果中没有 workspace 名时返回 undefined', async () => {
    await expect(notionServer.fetchWorkspaceName!([])).resolves.toBeUndefined()
    await expect(
      notionServer.fetchWorkspaceName!([fakeSelfTool('API-get-self', '{"bot":{}}')]),
    ).resolves.toBeUndefined()
  })
})
