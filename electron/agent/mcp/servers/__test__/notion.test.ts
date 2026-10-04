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
  it('extracts the workspace name from the get-self tool JSON result', async () => {
    const tools = [
      fakeSelfTool(
        'notion__API-get-self',
        JSON.stringify({
          object: 'user',
          type: 'bot',
          bot: { workspace_name: 'My Knowledge Base' },
        }),
      ),
    ]

    await expect(notionServer.fetchWorkspaceName!(tools)).resolves.toBe('My Knowledge Base')
  })

  it('handles non-JSON text results (regex fallback)', async () => {
    const tools = [fakeSelfTool('notion-get-self', 'user info: {"workspace_name":"Acme"} trailing')]

    await expect(notionServer.fetchWorkspaceName!(tools)).resolves.toBe('Acme')
  })

  it('returns undefined when there is no get-self tool or no workspace name in the result', async () => {
    await expect(notionServer.fetchWorkspaceName!([])).resolves.toBeUndefined()
    await expect(
      notionServer.fetchWorkspaceName!([fakeSelfTool('API-get-self', '{"bot":{}}')]),
    ).resolves.toBeUndefined()
  })
})
