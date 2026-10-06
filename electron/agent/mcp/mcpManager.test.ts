import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { McpManager, type McpManagerOptions } from './mcpManager.js'
import type { McpClientLike, McpServerDefinition } from './types.js'
import type { McpCredentialCrypto } from './credentials.js'
import { createFeishuServer, FEISHU_ALLOWED_TOOLS } from './servers/feishu.js'

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

  it('connects authorized servers at startup and injects tools with the server prefix', async () => {
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

  it('hydrates the workspace name from persisted user state at startup', async () => {
    const { manager } = createManager()

    await manager.start({ notion: { state: 'disconnected', workspaceName: 'My Knowledge Base' } })

    // Not authorized so no reconnect, but the display info is hydrated
    expect(manager.getTools()).toEqual([])
    expect(manager.getStatuses()[0]).toEqual(
      expect.objectContaining({ state: 'disconnected', workspaceName: 'My Knowledge Base' }),
    )
  })

  it('isolates a single server failure: marks it failed without affecting other servers or throwing', async () => {
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

  it('silently skips unknown server ids without throwing', async () => {
    const { manager } = createManager()

    await expect(manager.start({ ghost: { state: 'connected' } })).resolves.toBeUndefined()
    expect(manager.getTools()).toEqual([])
  })

  it('removes tools, deletes OAuth credentials and returns to disconnected after disconnect', async () => {
    // OAuth server: disconnecting still deletes the stored token (the opposite of the keep rule for non-OAuth form config)
    const makeOAuthDef = (id: string) =>
      makeDef(id, {
        createAuthProvider: (() => ({
          authRedirected: false,
        })) as unknown as McpServerDefinition['createAuthProvider'],
      })
    const { manager } = createManager({
      credentialCrypto: testCrypto,
      servers: [makeOAuthDef('notion')],
    })
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

  it('connect takes the interactive path and returns the final status', async () => {
    const { manager } = createManager()

    const status = await manager.connect('notion')

    expect(status.state).toBe('connected')
    expect(manager.getTools().map((t) => t.name)).toEqual(['notion__API-post-search'])
  })

  it('does not re-inject tools from a late connect result after disconnecting mid-connect', async () => {
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

  // ---- Non-OAuth header auth (Obsidian-style servers) ----

  const obsidianDef = (extra: Partial<McpServerDefinition> = {}) =>
    makeDef('obsidian', {
      credentialFields: [{ id: 'apiKey', label: 'API Key', required: true, secret: true }],
      createAuthHeaders: async (store) => ({
        Authorization: `Bearer ${store.load().secrets?.apiKey ?? ''}`,
      }),
      ...extra,
    })

  it('resolves form credentials into auth headers via createAuthHeaders and injects them into the client factory', async () => {
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

  it('resolves auth headers from persisted secrets on silent reconnect at startup, without refilling the form', async () => {
    let receivedHeaders: Record<string, string> | undefined
    const { manager } = createManager({
      credentialCrypto: testCrypto,
      servers: [obsidianDef()],
      createClient: (_def, _authProvider, headers) => {
        receivedHeaders = headers
        return makeClient(['read_file'])
      },
    })
    // Simulate the encrypted credential file written by the previous connection
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

  it('trims the allowlist before registration: 16 tools register as 13, destructive tools removed', async () => {
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

  it('fails the connection when required form fields are missing, with the field label and hint copy in the error', async () => {
    const { manager } = createManager({
      servers: [obsidianDef({ failureHint: 'Open Obsidian and enable the Local REST API plugin' })],
      createClient: () => makeClient(['read_file']),
    })

    const status = await manager.connect('obsidian', {})

    expect(status.state).toBe('failed')
    expect(status.error).toContain('API Key')
    expect(status.error).toContain('Open Obsidian and enable the Local REST API plugin')
    expect(manager.getTools()).toEqual([])
  })

  it('includes the hint copy in the status when a connection fails', async () => {
    const { manager } = createManager({
      servers: [obsidianDef({ failureHint: 'Open Obsidian and enable the Local REST API plugin' })],
      createClient: () => makeFailingClient(new Error('Connection refused')),
    })

    await manager.connect('obsidian', { apiKey: 'k' })

    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'failed' }))
    expect(manager.getStatuses()[0].error).toContain(
      'Open Obsidian and enable the Local REST API plugin',
    )
  })

  it('removes tools but keeps the secrets config after disconnect (editable form config is reusable)', async () => {
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
    expect(fs.existsSync(credPath)).toBe(true)
    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'disconnected' }))
  })

  it('status info carries the form field metadata and the failure hint', async () => {
    const { manager } = createManager({
      servers: [obsidianDef({ failureHint: 'Open Obsidian' })],
      createClient: () => makeClient(['read_file']),
    })

    const [status] = manager.getStatuses()

    expect(status.credentialFields).toEqual([
      { id: 'apiKey', label: 'API Key', required: true, secret: true },
    ])
    expect(status.failureHint).toBe('Open Obsidian')
  })

  // ---- Feishu (developer remote mode) UAT/TAT header branches ----

  function makeFeishuManager(
    exchange?: (appId: string, appSecret: string) => Promise<string>,
    tools: string[] = ['fetch-doc', 'search-doc', 'list-docs'],
  ) {
    let receivedHeaders: Record<string, string> | undefined
    const manager = new McpManager({
      userDataPath,
      servers: [createFeishuServer({ exchangeTenantToken: exchange })],
      createClient: (_def, _auth, headers) => {
        receivedHeaders = headers
        return makeClient(tools)
      },
      onToolsChanged: vi.fn(),
    })
    return { manager, receivedHeaders: () => receivedHeaders }
  }

  it('sends the X-Lark-MCP-UAT and Allowed-Tools headers when a UAT is present, without exchanging for a TAT', async () => {
    const exchange = vi.fn(async () => 'app-token')
    const { manager, receivedHeaders } = makeFeishuManager(exchange)

    await manager.connect('feishu', { appId: 'a', appSecret: 's', uat: 'user-token' })

    expect(receivedHeaders()).toEqual({
      'X-Lark-MCP-UAT': 'user-token',
      'X-Lark-MCP-Allowed-Tools': FEISHU_ALLOWED_TOOLS,
    })
    expect(exchange).not.toHaveBeenCalled()
    expect(receivedHeaders()?.['X-Lark-MCP-TAT']).toBeUndefined()
  })

  it('exchanges app credentials for a TAT and sends the X-Lark-MCP-TAT header when no UAT is present', async () => {
    const exchange = vi.fn(async () => 'app-token')
    const { manager, receivedHeaders } = makeFeishuManager(exchange)

    await manager.connect('feishu', { appId: 'a', appSecret: 's' })

    expect(exchange).toHaveBeenCalledWith('a', 's')
    expect(receivedHeaders()).toEqual({
      'X-Lark-MCP-TAT': 'app-token',
      'X-Lark-MCP-Allowed-Tools': FEISHU_ALLOWED_TOOLS,
    })
    expect(receivedHeaders()?.['X-Lark-MCP-UAT']).toBeUndefined()
  })

  it('degrades to failed when the TAT exchange fails, with a hint to check the app credentials in the error', async () => {
    const exchange = vi.fn(async () => {
      throw new Error('app_secret invalid')
    })
    const { manager } = makeFeishuManager(exchange)

    const status = await manager.connect('feishu', { appId: 'a', appSecret: 'bad' })

    expect(status.state).toBe('failed')
    expect(status.error).toContain('app_secret invalid')
    expect(status.error).toContain('App Secret')
    expect(manager.getTools()).toEqual([])
  })

  it('client allowlist trims further: removes write operations/generic tools, keeps document tools', async () => {
    const { manager } = makeFeishuManager(
      async () => 'app-token',
      [
        'fetch-doc',
        'search-doc',
        'list-docs',
        'create-doc',
        'update-doc',
        'get-comments',
        'search-user',
      ],
    )

    await manager.start({ feishu: { state: 'connected' } })

    const names = manager.getTools().map((t) => t.name)
    expect(names).toEqual(['feishu__fetch-doc', 'feishu__search-doc', 'feishu__list-docs'])
    for (const forbidden of ['create-doc', 'update-doc', 'comment', 'search-user']) {
      expect(names.some((n) => n.includes(forbidden))).toBe(false)
    }
  })

  it('removes tools but keeps the config after disconnect, back to disconnected (editable form config is reusable)', async () => {
    const { manager } = makeFeishuManager()
    await manager.connect('feishu', { appId: 'a', appSecret: 's', uat: 'u' })
    expect(manager.getTools().length).toBe(3)
    expect(manager.getSecrets('feishu')).toEqual({ appId: 'a', appSecret: 's', uat: 'u' })

    await manager.disconnect('feishu')

    expect(manager.getTools()).toEqual([])
    expect(manager.getStatuses()[0]).toEqual(expect.objectContaining({ state: 'disconnected' }))
    // Form-configured servers keep credentials after disconnect, so they can be edited and reconnected
    expect(manager.getSecrets('feishu')).toEqual({ appId: 'a', appSecret: 's', uat: 'u' })
  })
})
