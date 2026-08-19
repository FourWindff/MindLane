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

function makeDef(id: string, extra: Partial<McpServerDefinition> = {}): McpServerDefinition {
  return {
    id,
    displayName: id.toUpperCase(),
    description: `Mock server ${id}`,
    transport: 'http',
    connection: { url: `https://mcp.example.com/${id}` },
    ...extra,
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

  // ---- 非 OAuth header 认证（Obsidian 类 server） ----

  const obsidianDef = (extra: Partial<McpServerDefinition> = {}) =>
    makeDef('obsidian', {
      credentialFields: [{ id: 'apiKey', label: 'API Key', required: true, secret: true }],
      createAuthHeaders: async (store) => ({
        Authorization: `Bearer ${store.load().secrets?.apiKey ?? ''}`,
      }),
      ...extra,
    })

  it('表单凭据经 createAuthHeaders 解析为认证头，注入 client 工厂', async () => {
    let receivedHeaders: Record<string, string> | undefined
    const { manager } = createManager({
      servers: [obsidianDef()],
      createClient: (_def, _authProvider, headers) => {
        receivedHeaders = headers
        return makeClient(['read_file'])
      },
    })

    await manager.connect('obsidian', { apiKey: 'k-123' })

    expect(receivedHeaders).toEqual({ Authorization: 'Bearer k-123' })
    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'connected' }))
  })

  it('启动静默重连时从持久化 secrets 解析认证头，无需重新填表', async () => {
    let receivedHeaders: Record<string, string> | undefined
    const { manager } = createManager({
      credentialCrypto: testCrypto,
      servers: [obsidianDef()],
      createClient: (_def, _authProvider, headers) => {
        receivedHeaders = headers
        return makeClient(['read_file'])
      },
    })
    // 模拟上次连接写入的加密凭据文件
    const credPath = path.join(userDataPath, 'mcp-credentials', 'obsidian.json')
    fs.mkdirSync(path.dirname(credPath), { recursive: true })
    fs.writeFileSync(
      credPath,
      testCrypto.encrypt(JSON.stringify({ secrets: { apiKey: 'stored-key' } })),
    )

    await manager.start({ obsidian: { state: 'connected' } })

    expect(receivedHeaders).toEqual({ Authorization: 'Bearer stored-key' })
    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'connected' }))
  })

  it('allowlist 裁剪先于注册：16 个工具注册为 13 个，破坏性工具被剔除', async () => {
    const { manager } = createManager({
      servers: [obsidianDef({ excludeTools: ['vault_delete', 'command_execute', 'open_file'] })],
      createClient: () =>
        makeClient([
          'select',
          'append_content',
          'batch_create',
          'create',
          'delete',
          'search',
          'read_file',
          'write_file',
          'patch_content',
          'get_context',
          'list_files',
          'read_dir',
          'get_tags',
          'vault_delete',
          'command_execute',
          'open_file',
        ]),
    })

    await manager.start({ obsidian: { state: 'connected' } })

    const names = manager.getTools().map((t) => t.name)
    expect(names).toHaveLength(13)
    expect(names.every((n) => n.startsWith('obsidian__'))).toBe(true)
    for (const forbidden of ['vault_delete', 'command_execute', 'open_file']) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false)
    }
  })

  it('缺少必填表单字段时连接失败，错误信息含字段标签与指引文案', async () => {
    const { manager } = createManager({
      servers: [obsidianDef({ failureHint: '请打开 Obsidian 并启用 Local REST API 插件' })],
      createClient: () => makeClient(['read_file']),
    })

    const status = await manager.connect('obsidian', {})

    expect(status.state).toBe('failed')
    expect(status.error).toContain('API Key')
    expect(status.error).toContain('请打开 Obsidian 并启用 Local REST API 插件')
    expect(manager.getTools()).toEqual([])
  })

  it('连接失败时状态含指引文案', async () => {
    const { manager } = createManager({
      servers: [obsidianDef({ failureHint: '请打开 Obsidian 并启用 Local REST API 插件' })],
      createClient: () => makeFailingClient(new Error('连接被拒绝')),
    })

    await manager.connect('obsidian', { apiKey: 'k' })

    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'failed' }))
    expect(manager.getStatuses()[0].error).toContain('请打开 Obsidian 并启用 Local REST API 插件')
  })

  it('断开后 secrets 凭据文件删除，工具清空', async () => {
    const { manager } = createManager({
      credentialCrypto: testCrypto,
      servers: [obsidianDef()],
      createClient: () => makeClient(['read_file']),
    })
    await manager.connect('obsidian', { apiKey: 'k' })
    const credPath = path.join(userDataPath, 'mcp-credentials', 'obsidian.json')
    expect(manager.getTools().length).toBe(1)
    expect(fs.existsSync(credPath)).toBe(true)

    await manager.disconnect('obsidian')

    expect(manager.getTools()).toEqual([])
    expect(fs.existsSync(credPath)).toBe(false)
    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'disconnected' }))
  })

  it('状态信息携带表单字段元数据与失败指引', async () => {
    const { manager } = createManager({
      servers: [obsidianDef({ failureHint: '请打开 Obsidian' })],
      createClient: () => makeClient(['read_file']),
    })

    const [status] = manager.getStatuses()

    expect(status.credentialFields).toEqual([
      { id: 'apiKey', label: 'API Key', required: true, secret: true },
    ])
    expect(status.failureHint).toBe('请打开 Obsidian')
  })
})
