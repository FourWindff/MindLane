import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { McpManager, type McpManagerOptions } from '../mcpManager.js'
import type { McpClientLike, McpServerDefinition } from '../types.js'
import type { McpCredentialCrypto } from '../credentials.js'

function createMockTool(name: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name,
    description: `Mock tool ${name}`,
    schema: z.object({ value: z.string() }),
    func: async (input) => JSON.stringify(input),
  })
}

function makeDef(id: string): McpServerDefinition {
  return {
    id,
    displayName: id.toUpperCase(),
    description: `Mock server ${id}`,
    transport: 'http',
    connection: { url: `https://mcp.example.com/${id}` },
  }
}

function makeClient(toolNames: string[]): McpClientLike {
  return {
    getTools: vi.fn(async () => toolNames.map(createMockTool)),
    close: vi.fn(async () => {}),
  }
}

function makeFailingClient(error: Error): McpClientLike {
  return {
    getTools: vi.fn(async () => {
      throw error
    }),
    close: vi.fn(async () => {}),
  }
}

const testCrypto: McpCredentialCrypto = {
  encrypt: (plain) => Buffer.from(plain, 'utf-8').toString('base64'),
  decrypt: (cipher) => Buffer.from(cipher, 'base64').toString('utf-8'),
}

describe('McpManager', () => {
  let userDataPath: string

  beforeEach(() => {
    userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-manager-test-'))
  })

  afterEach(() => {
    fs.rmSync(userDataPath, { recursive: true, force: true })
  })

  function createManager(overrides: Partial<McpManagerOptions> = {}) {
    const onToolsChanged = vi.fn()
    const manager = new McpManager({
      userDataPath,
      servers: [makeDef('notion')],
      createClient: () => makeClient(['API-post-search']),
      onToolsChanged,
      ...overrides,
    })
    return { manager, onToolsChanged }
  }

  it('启动时连接已授权 server，工具加 server 前缀后注入', async () => {
    const { manager, onToolsChanged } = createManager({
      createClient: () => makeClient(['API-post-search', 'API-retrieve-page']),
    })

    await manager.start({ notion: { state: 'connected' } })

    expect(manager.getTools().map((t) => t.name)).toEqual([
      'notion__API-post-search',
      'notion__API-retrieve-page',
    ])
    expect(manager.getStatuses()).toEqual([
      expect.objectContaining({ id: 'notion', state: 'connected' }),
    ])
    const lastCall = onToolsChanged.mock.calls.at(-1)?.[0]
    expect(lastCall.map((t: { name: string }) => t.name)).toEqual([
      'notion__API-post-search',
      'notion__API-retrieve-page',
    ])
  })

  it('启动时从持久化用户态水合 workspace 名', async () => {
    const { manager } = createManager()

    await manager.start({ notion: { state: 'disconnected', workspaceName: '我的知识库' } })

    // 未授权不重连，但展示信息已水合
    expect(manager.getTools()).toEqual([])
    expect(manager.getStatuses()[0]).toEqual(
      expect.objectContaining({ state: 'disconnected', workspaceName: '我的知识库' }),
    )
  })

  it('单个 server 连接失败被隔离：标记 failed，不影响其他 server，也不抛错', async () => {
    const { manager } = createManager({
      servers: [makeDef('notion'), makeDef('other')],
      createClient: (def) =>
        def.id === 'notion' ? makeFailingClient(new Error('notion down')) : makeClient(['ping']),
    })

    await expect(
      manager.start({ notion: { state: 'connected' }, other: { state: 'connected' } }),
    ).resolves.toBeUndefined()

    const statuses = manager.getStatuses()
    expect(statuses.find((s) => s.id === 'notion')).toEqual(
      expect.objectContaining({ state: 'failed', error: 'notion down' }),
    )
    expect(statuses.find((s) => s.id === 'other')).toEqual(
      expect.objectContaining({ state: 'connected' }),
    )
    expect(manager.getTools().map((t) => t.name)).toEqual(['other__ping'])
  })

  it('未知的 server id 静默跳过，不抛错', async () => {
    const { manager } = createManager()

    await expect(manager.start({ ghost: { state: 'connected' } })).resolves.toBeUndefined()
    expect(manager.getTools()).toEqual([])
  })

  it('disconnect 后工具移除、凭据删除、状态回到 disconnected', async () => {
    const { manager } = createManager({ credentialCrypto: testCrypto })
    const credPath = path.join(userDataPath, 'mcp-credentials', 'notion.json')
    fs.mkdirSync(path.dirname(credPath), { recursive: true })
    fs.writeFileSync(
      credPath,
      testCrypto.encrypt(
        JSON.stringify({ tokens: { access_token: 'secret', token_type: 'bearer' } }),
      ),
    )

    await manager.start({ notion: { state: 'connected' } })
    expect(manager.getTools().length).toBe(1)
    expect(fs.existsSync(credPath)).toBe(true)

    await manager.disconnect('notion')

    expect(manager.getTools()).toEqual([])
    expect(fs.existsSync(credPath)).toBe(false)
    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'disconnected' }))
  })

  it('connect 走交互式路径并返回最终状态', async () => {
    const { manager } = createManager()

    const status = await manager.connect('notion')

    expect(status.state).toBe('connected')
    expect(manager.getTools().map((t) => t.name)).toEqual(['notion__API-post-search'])
  })

  it('连接中触发 disconnect 后，迟到的连接结果不会重新注入工具', async () => {
    let releaseTools: (tools: DynamicStructuredTool[]) => void = () => {}
    const pendingClient: McpClientLike = {
      getTools: vi.fn(
        () =>
          new Promise<DynamicStructuredTool[]>((resolve) => {
            releaseTools = resolve
          }),
      ),
      close: vi.fn(async () => {}),
    }
    const { manager } = createManager({ createClient: () => pendingClient })

    const connecting = manager.connect('notion')
    await manager.disconnect('notion')
    releaseTools([createMockTool('late-tool')])
    await connecting

    expect(manager.getTools()).toEqual([])
    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'disconnected' }))
  })
})
